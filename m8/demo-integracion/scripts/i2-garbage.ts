// I2, complemento: ¿qué filas inválidas habría aceptado la base en src/antes/? (confiar en las restricciones)
// Toma las filas que src/despues/importer.ts rechazó (con su motivo) y prueba insertarlas UNA POR UNA, con la
// misma conversión ingenua de src/antes/importer.ts (split(',')), en customers_naive. Cuenta cuántas de cada
// motivo acepta Postgres: esas habrían entrado como basura si la carga no hubiera abortado antes.
import { readFileSync } from 'node:fs';
import { makePool, SCHEMA_I2 } from '../src/lib/db.ts';
import { runToEnd, writeResult, today } from './lib/harness.ts';

const SIZE = Number(process.env.SIZE ?? 50000);
const pool = makePool(1);
await pool.query(SCHEMA_I2);
const rejectsFile = `out/rechazados-${SIZE}-basura.csv`;
await runToEnd('src/despues/importer.ts', {}, [`data/clientes-${SIZE}.csv`, rejectsFile]);
await pool.query(SCHEMA_I2);

// El archivo de rechazados tiene line,reason,raw con comillas CSV en reason/raw.
function parseCsvLine(l: string) {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

const byReason: Record<string, { total: number; accepted: number; error?: string }> = {};
for (const l of readFileSync(rejectsFile, 'utf8').split('\n').slice(1)) {
  if (!l) continue;
  const [, reasonFull, raw] = parseCsvLine(l);
  const reason = reasonFull.split(':')[0];
  const e = (byReason[reason] ??= { total: 0, accepted: 0 });
  e.total++;
  const [external_id, email, full_name, country, amount_cents, signup_date] = raw.split(',');
  try {
    await pool.query('INSERT INTO customers_naive (external_id, email, full_name, country, amount_cents, signup_date) VALUES ($1,$2,$3,$4,$5,$6)',
      [external_id, email, full_name, country, amount_cents, signup_date]);
    e.accepted++;
  } catch (err) { e.error ??= (err as Error).message; }
}
await pool.end();

let md = `# I2, complemento: qué inválidas habría aceptado la base en «antes»

Medido el ${today()}. Las ${Object.values(byReason).reduce((a, b) => a + b.total, 0)} filas que [\`src/despues/importer.ts\`](../src/despues/importer.ts) rechazó en \`clientes-${SIZE}.csv\`, insertadas una por una en \`customers_naive\` con la conversión de [\`src/antes/importer.ts\`](../src/antes/importer.ts) (\`split(',')\`, sin validar). Es lo que pasa cuando «la base ya valida»: solo rechaza lo que sus tipos y restricciones \`NOT NULL\` detectan.

| Motivo de rechazo en despues | Filas | Aceptadas por Postgres (basura) | Error de Postgres en las demás |
|---|---:|---:|---|
`;
for (const [k, v] of Object.entries(byReason).sort())
  md += `| ${k} | ${v.total} | **${v.accepted}** | ${v.error ? '`' + v.error.slice(0, 80) + '`' : '—'} |\n`;
writeResult('I2_BASURA.md', md);
