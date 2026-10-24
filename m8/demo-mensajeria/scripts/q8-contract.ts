// Q8: AsyncAPI 3.1 como contrato verificable (no como documentación).
// 1) La CLI valida el documento (lo que correría un paso de CI).
// 2) Un documento roto (referencia a un canal que no existe) hace fallar la validación.
// 3) `asyncapi diff` compara dos versiones y clasifica cada cambio (breaking / non-breaking /
//    unclassified). Se mide cómo clasifica renombrar un campo obligatorio del payload.
// 4) Mensajes REALES (API con outbox -> relay -> RabbitMQ) se validan contra los esquemas del
//    documento con Ajv; y los mismos mensajes con un campo renombrado (lo que pasaría si alguien
//    cambia el productor sin cambiar el contrato) fallan.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse } from 'yaml';
import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { Supervised, resetAll, waitHttp, drainQueue, environment, writeResult, makePool, sleep } from './lib/harness.ts';
import { Q_AUDIT } from '../src/lib/amqp.ts';
import { newTraceparent } from '../src/lib/trace.ts';

const addFormats = addFormatsModule as unknown as (a: Ajv) => Ajv;
const N = 200;
const cliVersion = JSON.parse(readFileSync('node_modules/@asyncapi/cli/package.json', 'utf8')).version;

function cli(args: string[]) {
  const t0 = Date.now();
  const r = spawnSync('npx', ['--no-install', 'asyncapi', ...args], {
    encoding: 'utf8', shell: true, env: { ...process.env, SUPPRESS_NO_CONFIG_WARNING: '1', NO_UPDATE_NOTIFIER: '1' },
  });
  const out = (r.stdout + r.stderr).split('\n').filter((l) => l.trim() && !/npm notice|WARNING/.test(l));
  return { code: r.status, out, ms: Date.now() - t0 };
}

const spec = readFileSync('asyncapi.yaml', 'utf8');
mkdirSync('contract', { recursive: true });
// Variante inválida: la operación apunta a un canal inexistente.
writeFileSync('contract/asyncapi-invalido.yaml', spec.replace("$ref: '#/channels/summaryRequested'\n", "$ref: '#/channels/summaryCancelled'\n"));
// Variante incompatible: amountCents pasa a llamarse amount.
writeFileSync('contract/asyncapi-rompe.yaml', spec.replaceAll('amountCents', 'amount'));
// Variante compatible: se añade un campo opcional.
writeFileSync('contract/asyncapi-compatible.yaml', spec.replace(
  "        occurredAt:\n          type: string\n          format: date-time\n",
  "        occurredAt:\n          type: string\n          format: date-time\n        currency:\n          type: string\n          description: Opcional; los consumidores viejos lo ignoran.\n"));

const vOk = cli(['validate', 'asyncapi.yaml']);
const vBad = cli(['validate', 'contract/asyncapi-invalido.yaml']);
const dBreak = cli(['diff', 'asyncapi.yaml', 'contract/asyncapi-rompe.yaml', '-f', 'json', '-t', 'all']);
const dCompat = cli(['diff', 'asyncapi.yaml', 'contract/asyncapi-compatible.yaml', '-f', 'json', '-t', 'all']);
// Cuenta los cambios por clasificación (breaking / non-breaking / unclassified).
const byType = (lines: string[]) => {
  const txt = lines.join('\n'); const i = txt.indexOf('{');
  try {
    const changes = JSON.parse(txt.slice(i)).changes as { type: string }[];
    const c: Record<string, number> = { breaking: 0, 'non-breaking': 0, unclassified: 0 };
    for (const ch of changes) c[ch.type] = (c[ch.type] ?? 0) + 1;
    return `${c.breaking} breaking, ${c['non-breaking']} non-breaking, ${c.unclassified} unclassified`;
  } catch { return '?'; }
};
for (const [k, v] of Object.entries({ vOk, vBad, dBreak, dCompat })) console.log(k, v.code, v.ms, v.out.slice(0, 6).join(' | '));

// --- mensajes reales contra el contrato ---
const doc = parse(spec);
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validatePayload = ajv.compile(doc.components.schemas.OrderCreatedPayload);
const validateHeaders = ajv.compile(doc.components.schemas.TraceHeaders);

const pool = makePool(2);
const env = await environment(pool);
await resetAll(pool);
const api = new Supervised('src/despues/api.ts', { PORT: '18312' }, 'api').start();
const relay = new Supervised('src/despues/relay.ts', { RELAY_ID: 'relay-q8' }, 'relay').start();
await waitHttp('http://127.0.0.1:18312/health');
for (let seq = 1; seq <= N; seq++) {
  await fetch('http://127.0.0.1:18312/orders', {
    method: 'POST', headers: { 'content-type': 'application/json', traceparent: newTraceparent() },
    body: JSON.stringify({ seq, customer: `c-${seq % 37}`, amountCents: 1000 + seq }),
  });
}
while ((await pool.query('SELECT count(*)::int n FROM outbox WHERE published_at IS NULL')).rows[0].n > 0) await sleep(200);
await api.stop(); await relay.stop();
const msgs = await drainQueue(Q_AUDIT);
await pool.end();
const okReal = msgs.filter((m) => validatePayload(m.body) && validateHeaders(m.headers)).length;
const drifted = msgs.map((m) => { const { amountCents, ...rest } = m.body; return { ...rest, amount: amountCents }; });
const okDrift = drifted.filter((b) => validatePayload(b)).length;
validatePayload(drifted[0]);
const driftError = ajv.errorsText(validatePayload.errors);

const md = `# Q8. AsyncAPI 3.1 como contrato verificable

Medido el ${new Date().toISOString().slice(0, 10)}. ${env} AsyncAPI CLI ${cliVersion} (\`npx asyncapi\`, fijada en \`package.json\`), Ajv 8.20.0 + ajv-formats 3.0.1.

| Comprobación | Resultado | Código de salida | Tiempo (ms) |
|---|---|---:|---:|
| \`asyncapi validate asyncapi.yaml\` | ${vOk.out.find((l) => /valid/i.test(l)) ?? vOk.out.join(' ')} | ${vOk.code} | ${vOk.ms} |
| \`asyncapi validate contract/asyncapi-invalido.yaml\` (operación que apunta a un canal inexistente) | ${vBad.out.filter((l) => /\serror\s/.test(l)).map((l) => l.trim().replace(/\s{2,}/g, ' ').replaceAll('|', '\\|')).join('<br>')} | ${vBad.code} | ${vBad.ms} |
| \`asyncapi diff\` original → \`amountCents\` renombrado a \`amount\` (\`-t all\`) | ${byType(dBreak.out)} | ${dBreak.code} | ${dBreak.ms} |
| \`asyncapi diff\` original → campo opcional \`currency\` añadido (\`-t all\`) | ${byType(dCompat.out)} | ${dCompat.code} | ${dCompat.ms} |

**Mensajes reales.** ${N} pedidos por la API con outbox → relay → RabbitMQ; se leen los ${msgs.length} mensajes de la cola de auditoría y se validan contra \`components.schemas\` del mismo \`asyncapi.yaml\`:

| Mensajes | Válidos (payload + cabecera \`traceparent\`) |
|---|---:|
| Tal como los publicó el relay | **${okReal} / ${msgs.length}** |
| Los mismos con \`amountCents\` renombrado a \`amount\` (simula cambiar el productor sin cambiar el contrato) | **${okDrift} / ${drifted.length}** |

Error que da Ajv en el segundo caso: \`${driftError}\`.

Lectura: ver la sección Q8 de [ESCENARIOS.md](ESCENARIOS.md).
`;
writeResult('Q8_ASYNCAPI.md', md);
console.log({ okReal, total: msgs.length, okDrift, driftError });
process.exit(0);
