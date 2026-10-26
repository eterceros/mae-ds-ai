// OB y OC: la traza a través de la outbox y la cola, y los logs con trace id.
//  - antes  = src/antes/ CON la auto-instrumentación encendida (mismo código de la S08)
//  - despues = src/despues/
// Por corrida y variante: N pedidos con un traceparent propio (se conoce el trace-id de cada uno),
// se espera a que el worker los confirme y se mira en Tempo si la traza llega al worker, y en los
// logs (docker y Loki) qué trace id quedó escrito.
// Al final, una vez: la API de despues SIN el gancho ESM (--experimental-loader), para ver qué se pierde.
// Escribe results/OB-OC_COLA_Y_LOGS.md (o results/raw/smoke-... con SMOKE=1).
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { antes, compose, entorno, f0, f1, LOKI, median, ROOT, RUNS, save, saveRaw, SMOKE, sleep } from './lib/util.ts';
import { getTrace, tree, waitTrace, type Span } from './lib/tempo.ts';

const N = Number(process.env.N ?? (SMOKE ? 20 : 100));
const PUERTO = { antes: 18550, despues: 18555 } as const;

type Envio = { traceId: string; pedido: string };

async function enviar(url: string, n: number, conc = 5): Promise<Envio[]> {
  const out: Envio[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < n) {
      i++;
      const traceId = randomBytes(16).toString('hex');
      const r = await fetch(`${url}/pedidos`, {
        method: 'POST', body: JSON.stringify({ sku: `sku-${i % 50}`, cantidad: 1 }),
        headers: { 'content-type': 'application/json', traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` },
      });
      if (r.status !== 201) throw new Error(`HTTP ${r.status}`);
      out.push({ traceId, pedido: ((await r.json()) as { id: string }).id });
    }
  }));
  return out;
}

const logs = (svc: string, since: string) => compose(['logs', '--no-log-prefix', '--since', since, svc]).split('\n');

// trace id escrito en el log de cada pedido (texto de la S08 o JSON de pino)
function traceEnLogs(lines: string[], frase: string): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const l of lines) {
    if (l.startsWith('{')) {
      try {
        const j = JSON.parse(l);
        if (j.msg === frase && j.pedido) m.set(j.pedido, j.trace_id ?? null);
      } catch { /* línea que no es JSON */ }
    } else {
      const x = /pedido ([0-9a-f-]{36}) .*\(trace ([0-9a-f]{32}|null)\)/.exec(l);
      if (x && l.includes(frase.split(' ')[1])) m.set(x[1], x[2] === 'null' ? null : x[2]);
    }
  }
  return m;
}

async function lokiTiene(traceId: string, ns: string, svc: string): Promise<boolean> {
  const u = new URL(`${LOKI}/loki/api/v1/query_range`);
  u.searchParams.set('query', `{service_namespace="${ns}", service_name="${svc}"} | trace_id="${traceId}"`);
  u.searchParams.set('since', '1h');
  const j: any = await (await fetch(u)).json();
  return (j.data?.result ?? []).some((s: any) => s.values?.length);
}
async function lokiLineas(ns: string): Promise<number> {
  const u = new URL(`${LOKI}/loki/api/v1/query`);
  u.searchParams.set('query', `sum(count_over_time({service_namespace="${ns}"}[1h]))`);
  const j: any = await (await fetch(u)).json();
  return Number(j.data?.result?.[0]?.value?.[1] ?? 0);
}

const filasOB: Record<string, string | number>[] = [];
const filasOC: Record<string, string | number>[] = [];
const capturas: Record<string, string> = {};

antes(true);
await sleep(3000);
for (let run = 1; run <= RUNS; run++) {
  for (const variante of ['antes', 'despues'] as const) {
    const since = new Date(Date.now() - 2000).toISOString();
    console.log(`[ob-${variante}-${run}] ${N} pedidos`);
    const envios = await enviar(`http://127.0.0.1:${PUERTO[variante]}`, N);
    // esperar a que el worker confirme todos
    let wlog = new Map<string, string | null>();
    for (const t = Date.now(); Date.now() - t < 60000; await sleep(1000)) {
      wlog = traceEnLogs(logs(`worker-${variante}`, since), 'pedido confirmado');
      if (envios.every((e) => wlog.has(e.pedido))) break;
    }
    const alog = traceEnLogs(logs(`api-${variante}`, since), 'pedido creado');
    // esperar a que Tempo tenga la API de cada traza, y unos segundos más para el resto
    for (const e of envios) await waitTrace(e.traceId, (s) => s.some((x) => x.service === 'api' && x.kind === 'SERVER'), 60000);
    await sleep(8000);

    let completas = 0, conRelay = 0, huerfanas = 0, workerEnOtra = 0;
    const nSpans: number[] = [];
    let ejemplo: Envio | null = null;
    for (const e of envios) {
      const s = (await getTrace(e.traceId)) ?? [];
      nSpans.push(s.length);
      const tieneWorker = s.some((x) => x.service === 'worker' && x.kind === 'CONSUMER');
      if (s.some((x) => x.service === 'relay')) conRelay++;
      if (tieneWorker) completas++;
      else {
        ejemplo ??= e;
        // ¿dónde quedó el span del worker? en la traza cuyo id escribió el worker en su log
        const otra = wlog.get(e.pedido);
        if (otra && otra !== e.traceId) {
          const so = await waitTrace(otra, (x) => x.some((y) => y.service === 'worker'), 20000);
          if (so?.some((y) => y.service === 'worker')) workerEnOtra++;
          if (so && !so.some((y) => y.service === 'api')) huerfanas++;
        }
      }
    }
    filasOB.push({
      variante, corrida: run, pedidos: N, 'confirmados por el worker': envios.filter((e) => wlog.has(e.pedido)).length,
      'trazas API → relay → worker completas': `${completas} de ${N}`,
      'con el span del relay': conRelay, 'worker en OTRA traza': workerEnOtra,
      'trazas nuevas que empiezan en el relay': huerfanas, 'spans por traza (mediana)': f0(median(nSpans)),
    });

    // OC: ¿qué trace id quedó escrito en los logs?
    const igual = (m: Map<string, string | null>) => envios.filter((e) => m.get(e.pedido) === e.traceId).length;
    const conId = (m: Map<string, string | null>) => envios.filter((e) => !!m.get(e.pedido)).length;
    let lokiApi = 0, lokiWorker = 0;
    if (variante === 'despues') {
      await sleep(5000);
      for (const e of envios) {
        if (await lokiTiene(e.traceId, 'despues', 'api')) lokiApi++;
        if (await lokiTiene(e.traceId, 'despues', 'worker')) lokiWorker++;
      }
    }
    filasOC.push({
      variante, corrida: run,
      'log de la API con trace id': `${conId(alog)} de ${N}`, 'log API = traza real': `${igual(alog)} de ${N}`,
      'log del worker con trace id': `${conId(wlog)} de ${N}`, 'log worker = traza de la API': `${igual(wlog)} de ${N}`,
      'en Loki (API / worker), buscando por trace id': variante === 'despues' ? `${lokiApi} / ${lokiWorker} de ${N}` : `0 / 0 (${await lokiLineas('antes')} líneas de "antes" en Loki)`,
    });

    if (run === 1) {
      const e = ejemplo ?? envios[0];
      const s = (await getTrace(e.traceId)) ?? [];
      const otra = wlog.get(e.pedido);
      const so = otra && otra !== e.traceId ? await getTrace(otra) : null;
      const al = logs(`api-${variante}`, since).find((l) => l.includes(e.pedido)) ?? '';
      const wl = logs(`worker-${variante}`, since).find((l) => l.includes(e.pedido)) ?? '';
      capturas[variante] = [
        `Pedido \`${e.pedido}\`, enviado con trace-id \`${e.traceId}\`.`, '',
        `Traza \`${e.traceId}\` (${s.length} spans):`, '', '```', tree(s), '```', '',
        so ? `El span del worker quedó en OTRA traza, \`${otra}\` (${so.length} spans), que empieza en el relay:\n\n\`\`\`\n${tree(so)}\n\`\`\`\n` : '',
        'Logs de ese pedido:', '', '```', al, wl, '```', '',
      ].join('\n');
      saveRaw(`ob-${variante}-traza.json`, JSON.stringify({ traza: s, otra: so }, null, 1));
    }
  }
}

// --- Sin el gancho ESM: la misma API de despues, solo con --import (lo que dice el README del paquete) ---
console.log('[sin-gancho] api de despues sin --experimental-loader');
const nombre = 's11-otel-api-sin-gancho';
spawnSync('docker', ['rm', '-f', nombre], { encoding: 'utf8' });
compose(['run', '-d', '--name', nombre, '-p', '127.0.0.1:18557:3000', '-e', 'NODE_OPTIONS=--import @opentelemetry/auto-instrumentations-node/register',
  '-e', 'OTEL_RESOURCE_ATTRIBUTES=service.namespace=sin-gancho', 'api-despues']);
let sinGancho = '';
try {
  for (const t = Date.now(); Date.now() - t < 60000; await sleep(1000)) {
    try { if ((await fetch('http://127.0.0.1:18557/salud')).ok) break; } catch { /* arrancando */ }
  }
  const since = new Date(Date.now() - 2000).toISOString();
  const envios = await enviar('http://127.0.0.1:18557', 20, 2);
  for (const e of envios) await waitTrace(e.traceId, (s) => s.some((x) => x.service === 'worker'), 60000);
  const porScope = new Map<string, number>();
  const nombresServer = new Set<string>();
  for (const e of envios) {
    for (const s of ((await getTrace(e.traceId)) ?? []).filter((x: Span) => x.service === 'api')) {
      porScope.set(s.scope, (porScope.get(s.scope) ?? 0) + 1);
      if (s.kind === 'SERVER') nombresServer.add(s.name);
    }
  }
  const pl = spawnSync('docker', ['logs', '--since', since, nombre], { encoding: 'utf8' }).stdout.split('\n');
  const m = traceEnLogs(pl, 'pedido creado');
  sinGancho = [
    `20 pedidos a la API de despues arrancada con \`NODE_OPTIONS=--import @opentelemetry/auto-instrumentations-node/register\` (sin \`--experimental-loader\`).`, '',
    '| instrumentación (scope) | spans de la API en las 20 trazas |', '|---|---|',
    ...[...porScope.entries()].sort().map(([k, v]) => `| \`${k}\` | ${v} |`), '',
    `Nombre del span SERVER: ${[...nombresServer].map((x) => `\`${x}\``).join(', ')}. Logs de pino con trace_id: ${envios.filter((e) => m.get(e.pedido)).length} de 20.`,
  ].join('\n');
} finally {
  spawnSync('docker', ['rm', '-f', nombre], { encoding: 'utf8' });
}
antes(false);

const tabla = (rows: Record<string, string | number>[]) => {
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
};

save('OB-OC_COLA_Y_LOGS.md', `# OB y OC: la traza a través de la outbox y la cola, y los logs con trace id

Generado por \`scripts/ob-oc.ts\` el ${new Date().toISOString()}. ${entorno()}.
${N} pedidos por corrida y variante (5 a la vez), cada uno con un traceparent propio; ${RUNS} corrida(s), alternadas.
**antes** = \`src/antes/\` con la auto-instrumentación encendida (\`ANTES_NODE_OPTIONS\`); **despues** = \`src/despues/\`.

## OB: ¿llega la traza al worker?

${tabla(filasOB)}

## OC: ¿qué trace id queda en los logs?

${tabla(filasOC)}

«= traza real» / «= traza de la API»: el trace id del log es el mismo con que se envió el pedido (el de la traza de la API en Tempo).

## Capturas (corrida 1)

### antes

${capturas.antes ?? ''}

### despues

${capturas.despues ?? ''}

## Sin el gancho ESM

${sinGancho}
`);
void ROOT; void f1;
