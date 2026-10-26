// I2. Carga por lotes: todo en memoria + INSERT fila por fila en una transacción (antes) frente a
// streaming + validación + rechazados + tabla intermedia + upsert idempotente (despues).
// Requiere los CSV de data/ (npm run gen-csv -- 50000 && npm run gen-csv -- 500000; el script los genera si faltan).
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makePool, SCHEMA_I2 } from '../src/lib/db.ts';
import { runToEnd, median, range, environment, writeResult, today } from './lib/harness.ts';

const SIZES = (process.env.SIZES ?? '50000,500000').split(',').map(Number);
const RUNS = Number(process.env.RUNS ?? 3);
const pool = makePool(2);

function ensureCsv(n: number) {
  if (!existsSync(`data/clientes-${n}.csv`)) execFileSync(process.execPath, ['--no-warnings', 'scripts/gen-csv.ts', String(n), '42'], { stdio: 'inherit' });
  return JSON.parse(readFileSync(`data/clientes-${n}.manifest.json`, 'utf8'));
}

async function run(variant: 'antes' | 'despues', csv: string, rejects = 'out/rechazados.csv') {
  const r = await runToEnd(`src/${variant}/importer.ts`, {}, variant === 'despues' ? [csv, rejects] : [csv]);
  if (!r.result) throw new Error(`${variant} ${csv} sin RESULT:\n${r.log.join('\n')}`);
  return r.result as any;
}

const naiveStats = async () => (await pool.query(`
  SELECT count(*)::int total, count(DISTINCT external_id)::int distinct_ids,
         count(*) FILTER (WHERE email = '' OR email NOT LIKE '%@%' OR amount_cents < 0
                           OR country NOT IN ('AR','BO','BR','CL','CO','EC','MX','PE','PY','UY','VE','US','ES'))::int garbage
    FROM customers_naive`)).rows[0];
const rejectReasons = (file: string) => {
  const counts: Record<string, number> = {};
  for (const l of readFileSync(file, 'utf8').split('\n').slice(1)) {
    if (!l) continue;
    const reason = l.split(',')[1].replace(/^"/, '').split(':')[0];
    counts[reason] = (counts[reason] ?? 0) + 1;
  }
  return counts;
};

const env = await environment(pool);
type R = Record<string, any>;
const results: { size: number; manifest: any; antesDirty: R[]; antesValid: R[]; despues: R[] }[] = [];

for (const size of SIZES) {
  const manifest = ensureCsv(size);
  const dirty = `data/clientes-${size}.csv`, valid = `data/clientes-${size}-validas.csv`;
  const entry = { size, manifest, antesDirty: [] as R[], antesValid: [] as R[], despues: [] as R[] };
  for (let i = 1; i <= RUNS; i++) {
    await pool.query(SCHEMA_I2);
    const a = await run('antes', dirty);
    a.dbRows = (await naiveStats()).total;
    entry.antesDirty.push(a); console.log('antes sucio', size, i, JSON.stringify(a));
  }
  for (let i = 1; i <= RUNS; i++) {
    await pool.query(SCHEMA_I2);
    const a1 = await run('antes', valid);
    const s1 = await naiveStats();
    // La segunda ejecución solo con el archivo chico: con el grande tarda lo mismo que la primera y el resultado es igual (duplica).
    let s2: any = null, a2: any = null;
    if (size <= 50_000) { a2 = await run('antes', valid); s2 = await naiveStats(); }
    const a = { ...a1, rows1: s1.total, distinct1: s1.distinct_ids, garbage1: s1.garbage, second: a2, rows2: s2?.total ?? null, distinct2: s2?.distinct_ids ?? null };
    entry.antesValid.push(a); console.log('antes validas', size, i, JSON.stringify(a));
  }
  for (let i = 1; i <= RUNS; i++) {
    await pool.query(SCHEMA_I2);
    const d1 = await run('despues', dirty, `out/rechazados-${size}.csv`);
    const rows1 = Number((await pool.query('SELECT count(*) n FROM customers')).rows[0].n);
    const maxUpd1 = (await pool.query('SELECT max(updated_at) m FROM customers')).rows[0].m;
    const d2 = await run('despues', dirty, `out/rechazados-${size}-2.csv`);
    const rows2 = Number((await pool.query('SELECT count(*) n FROM customers')).rows[0].n);
    const maxUpd2 = (await pool.query('SELECT max(updated_at) m FROM customers')).rows[0].m;
    const d = { ...d1, rows1, second: d2, rows2, updatedAtTouched: String(maxUpd1) !== String(maxUpd2), reasons: rejectReasons(`out/rechazados-${size}.csv`) };
    entry.despues.push(d); console.log('despues', size, i, JSON.stringify(d));
  }
  results.push(entry);
}
await pool.end();

const f1 = (x: number) => x.toFixed(1);
const med = (xs: R[], k: string) => median(xs.map((x) => Number(x[k])));
let md = `# I2. Carga por lotes: todo en memoria y fila por fila frente a streaming + validación + upsert idempotente

Medido el ${today()}. ${env}

Archivos generados con [\`scripts/gen-csv.ts\`](../scripts/gen-csv.ts), semilla 42 (columnas \`external_id,email,full_name,country,amount_cents,signup_date\`). El «sucio» tiene ~3 % de filas inválidas de 7 tipos y ~1 % de filas duplicadas (copia exacta de una fila válida anterior); el de «válidas» son las mismas filas sin las inválidas (con las duplicadas). ${RUNS} corridas por caso; cada corrida empieza con las tablas vacías. Memoria: pico de RSS del proceso de Node (incluye ~50 MB de Node y del driver) y pico del heap de JavaScript.

- **antes** = [\`src/antes/importer.ts\`](../src/antes/importer.ts): \`readFileSync\` + \`split\` + un \`INSERT\` por fila, todo en una transacción, tabla sin clave natural.
- **despues** = [\`src/despues/importer.ts\`](../src/despues/importer.ts): lectura por partes, validación por fila, rechazados a CSV con motivo, lotes de 1000 a \`customers_staging\` y \`INSERT … ON CONFLICT (external_id) DO UPDATE … WHERE … IS DISTINCT FROM\` a \`customers\`, una transacción por lote.

`;
for (const e of results) {
  const m = e.manifest;
  md += `## ${e.size.toLocaleString('es')} filas

Contenido del archivo sucio (\`clientes-${e.size}.manifest.json\`): ${m.invalid} inválidas (${Object.entries(m.invalidByKind).map(([k, v]) => `${k} ${v}`).join(', ')}), ${m.duplicates} duplicadas, ${m.distinctValidIds} clientes distintos válidos. Archivo de válidas: ${m.validRows} filas.

### antes, archivo sucio

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Filas leídas | Falló en la línea | Error | Filas cargadas |
|---:|---:|---:|---:|---:|---:|---|---:|
`;
  e.antesDirty.forEach((a, i) => { md += `| ${i + 1} | ${a.seconds.toFixed(2)} | ${a.peakRssMB} | ${a.peakHeapMB} | ${a.rowsRead} | ${a.failedAt ?? '—'} | \`${(a.error || '—').slice(0, 70)}\` | **${a.dbRows}** |\n`; });
  md += `
### antes, archivo de válidas

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Filas cargadas | Clientes distintos | 2.ª ejecución: tiempo (s) | 2.ª ejecución: filas en la tabla | 2.ª: clientes distintos |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
`;
  e.antesValid.forEach((a, i) => { md += `| ${i + 1} | ${f1(a.seconds)} | ${a.peakRssMB} | ${a.peakHeapMB} | ${a.rows1} | ${a.distinct1} | ${a.second ? f1(a.second.seconds) : 'no se corrió'} | ${a.rows2 ?? '—'} | ${a.distinct2 ?? '—'} |\n`; });
  md += `
### despues, archivo sucio (dos ejecuciones seguidas con el mismo archivo)

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Leídas | Rechazadas | Insertadas | Actualizadas | Sin cambios | Filas en \`customers\` | 2.ª: tiempo (s) | 2.ª: insertadas / actualizadas / sin cambios | 2.ª: filas | ¿2.ª tocó \`updated_at\`? |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
`;
  e.despues.forEach((d, i) => { md += `| ${i + 1} | ${f1(d.seconds)} | ${d.peakRssMB} | ${d.peakHeapMB} | ${d.rowsRead} | ${d.rejected} | ${d.inserted} | ${d.updated} | ${d.unchanged} | ${d.rows1} | ${f1(d.second.seconds)} | **${d.second.inserted} / ${d.second.updated}** / ${d.second.unchanged} | ${d.rows2} | ${d.updatedAtTouched ? 'sí' : 'no'} |\n`; });
  md += `
Motivos de rechazo (corrida 1): ${Object.entries(e.despues[0].reasons).map(([k, v]) => `${k}: ${v}`).join('; ')}.

### Medianas

| Caso | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Resultado |
|---|---:|---:|---:|---|
| antes, sucio | ${med(e.antesDirty, 'seconds').toFixed(2)} | ${med(e.antesDirty, 'peakRssMB')} | ${med(e.antesDirty, 'peakHeapMB')} | aborta en la línea ${range(e.antesDirty.map((a) => a.failedAt ?? NaN))}: **0 filas cargadas** |
| antes, válidas | ${f1(med(e.antesValid, 'seconds'))} | ${med(e.antesValid, 'peakRssMB')} | ${med(e.antesValid, 'peakHeapMB')} | ${med(e.antesValid, 'rows1')} filas para ${med(e.antesValid, 'distinct1')} clientes${e.antesValid[0].rows2 ? `; la 2.ª ejecución deja ${med(e.antesValid, 'rows2')}` : ''} |
| despues, sucio | ${f1(med(e.despues, 'seconds'))} | ${med(e.despues, 'peakRssMB')} | ${med(e.despues, 'peakHeapMB')} | ${med(e.despues, 'inserted')} insertadas, ${med(e.despues, 'rejected')} rechazadas; 2.ª ejecución: **${median(e.despues.map((d) => d.second.inserted + d.second.updated))} cambios** (${f1(median(e.despues.map((d) => d.second.seconds)))} s) |

`;
}
writeResult('I2_IMPORTACION.md', md);
