// DESPUÉS (práctica corregida) — Importar un CSV de clientes por lotes (I2). Comparar con src/antes/importer.ts.
//   node src/despues/importer.ts data/clientes-50000.csv [out/rechazados.csv]
// Lee el archivo por partes, valida cada fila, separa las rechazadas con su motivo, escribe las válidas
// en una tabla intermedia en lotes de BATCH filas y desde ahí hace un upsert idempotente al destino.
// Ejecutarlo dos veces con el mismo archivo deja la base igual (0 cambios en la segunda).
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { once } from 'node:events';
import { dirname } from 'node:path';
import pg from 'pg';
import { DATABASE_URL } from '../lib/config.ts';
import { startMemorySampler, printResult } from '../lib/memory.ts';

const file = process.argv[2];
const rejectsFile = process.argv[3] ?? 'out/rechazados.csv';
const BATCH = Number(process.env.BATCH ?? 1000);
const HEADER = ['external_id', 'email', 'full_name', 'country', 'amount_cents', 'signup_date'];
const COUNTRIES = new Set(['AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'MX', 'PE', 'PY', 'UY', 'VE', 'US', 'ES']);

const stopMem = startMemorySampler();
const t0 = performance.now();

// CORRECCIÓN: leer por partes (streaming). El for-await pide el siguiente trozo de 64 KB solo cuando
// terminó con el anterior, y mientras se escribe un lote en la base no se lee nada más: la memoria
// depende del tamaño del lote, no del archivo.
async function* lines(path: string) {
  let rest = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop()!;
    for (const p of parts) yield p.replace(/\r$/, '');
  }
  if (rest) yield rest.replace(/\r$/, '');
}

type Row = { line: number; external_id: string; email: string; full_name: string; country: string; amount_cents: number; signup_date: string };

// CORRECCIÓN: validar cada fila antes de tocar la base, con un motivo legible para quien corrige el archivo.
// Este CSV no tiene comillas ni comas dentro de los campos; con un CSV general hay que usar un parser
// de verdad (p. ej. csv-parse en Node o el módulo csv en Python), no split(',').
function validate(fields: string[], line: number): { row?: Row; reason?: string } {
  if (fields.length !== HEADER.length) return { reason: `se esperaban ${HEADER.length} columnas y hay ${fields.length}` };
  const [external_id, email, full_name, country, amount, date] = fields.map((f) => f.trim());
  if (!/^C\d{7}$/.test(external_id)) return { reason: 'external_id con formato inválido' };
  if (email === '') return { reason: 'email vacío' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { reason: 'email con formato inválido' };
  if (full_name === '') return { reason: 'full_name vacío' };
  if (!COUNTRIES.has(country)) return { reason: `country desconocido: ${country}` };
  if (!/^-?\d+$/.test(amount)) return { reason: `amount_cents no es un entero: ${amount}` };
  const amount_cents = Number(amount);
  if (amount_cents < 0) return { reason: 'amount_cents negativo' };
  if (amount_cents > 2_147_483_647) return { reason: 'amount_cents fuera de rango' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return { reason: `signup_date no es una fecha válida (AAAA-MM-DD): ${date}` };
  return { row: { line, external_id, email, full_name, country, amount_cents, signup_date: date } };
}

const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
const runId: number = (await db.query('INSERT INTO import_runs (file) VALUES ($1) RETURNING id', [file])).rows[0].id;

mkdirSync(dirname(rejectsFile), { recursive: true });
const rejects = createWriteStream(rejectsFile);
rejects.write('line,reason,raw\n');

let read = 0, rejected = 0, inserted = 0, updated = 0, unchanged = 0, batchNo = 0;
let batch: Row[] = [];

// CORRECCIÓN: un lote = una transacción. Primero a la tabla intermedia (un INSERT con BATCH filas, no
// BATCH idas y vueltas), después la fusión con el destino:
//  - DISTINCT ON (external_id): si el mismo id aparece dos veces en el lote, gana la última línea
//    (ON CONFLICT DO UPDATE no puede tocar la misma fila dos veces en una sentencia).
//  - ON CONFLICT (external_id) DO UPDATE: si ya existía, se actualiza; volver a cargar no duplica.
//  - WHERE ... IS DISTINCT FROM: si los datos son iguales no se escribe nada (0 cambios en la segunda
//    ejecución, y updated_at solo cambia cuando cambió algo).
//  - RETURNING (xmax = 0): distingue filas insertadas de actualizadas.
async function flush() {
  if (batch.length === 0) return;
  batchNo++;
  const cols = 9, values: unknown[] = [], tuples: string[] = [];
  batch.forEach((r, i) => {
    tuples.push(`(${Array.from({ length: cols }, (_, j) => `$${i * cols + j + 1}`).join(',')})`);
    values.push(runId, batchNo, r.line, r.external_id, r.email, r.full_name, r.country, r.amount_cents, r.signup_date);
  });
  await db.query('BEGIN');
  try {
    await db.query(`INSERT INTO customers_staging (run_id, batch_no, line_no, external_id, email, full_name, country, amount_cents, signup_date)
                    VALUES ${tuples.join(',')}`, values);
    const r = await db.query(`
      WITH src AS (
        SELECT DISTINCT ON (external_id) external_id, email, full_name, country, amount_cents, signup_date
          FROM customers_staging WHERE run_id = $1 AND batch_no = $2
         ORDER BY external_id, line_no DESC
      ), up AS (
        INSERT INTO customers AS c (external_id, email, full_name, country, amount_cents, signup_date)
        SELECT * FROM src
        ON CONFLICT (external_id) DO UPDATE
           SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, country = EXCLUDED.country,
               amount_cents = EXCLUDED.amount_cents, signup_date = EXCLUDED.signup_date, updated_at = now()
         WHERE (c.email, c.full_name, c.country, c.amount_cents, c.signup_date)
               IS DISTINCT FROM (EXCLUDED.email, EXCLUDED.full_name, EXCLUDED.country, EXCLUDED.amount_cents, EXCLUDED.signup_date)
        RETURNING (xmax = 0) AS ins
      )
      SELECT count(*) FILTER (WHERE ins) AS inserted, count(*) FILTER (WHERE NOT ins) AS updated FROM up`, [runId, batchNo]);
    await db.query('COMMIT');
    const { inserted: i, updated: u } = r.rows[0];
    inserted += Number(i); updated += Number(u);
    // Las filas repetidas (en el lote o ya existentes con los mismos datos) cuentan como "sin cambios".
    unchanged += batch.length - Number(i) - Number(u);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;   // un lote que falla aquí es un error de programa, no de datos (ya se validó); re-ejecutar es seguro
  }
  batch = [];
}

let lineNo = 0;
for await (const text of lines(file)) {
  lineNo++;
  if (lineNo === 1) {
    // CORRECCIÓN: comprobar la cabecera: si el origen cambió el orden de columnas, parar antes de cargar nada.
    if (text.trim() !== HEADER.join(',')) throw new Error(`cabecera inesperada: ${text}`);
    continue;
  }
  if (text.trim() === '') continue;
  read++;
  const v = validate(text.split(','), lineNo);
  if (v.reason) {
    // CORRECCIÓN: las filas malas no abortan la carga: se apartan con número de línea y motivo.
    rejected++;
    if (!rejects.write(`${lineNo},${csvField(v.reason)},${csvField(text)}\n`)) await once(rejects, 'drain');
    continue;
  }
  batch.push(v.row!);
  if (batch.length >= BATCH) await flush();
}
await flush();
rejects.end();
await once(rejects, 'finish');

// La tabla intermedia ya cumplió: se vacía la parte de esta ejecución (el registro queda en import_runs).
await db.query('DELETE FROM customers_staging WHERE run_id = $1', [runId]);
await db.query(`UPDATE import_runs SET finished_at = clock_timestamp(), rows_read = $2, rows_rejected = $3,
                inserted = $4, updated = $5, unchanged = $6 WHERE id = $1`, [runId, read, rejected, inserted, updated, unchanged]);
await db.end();
const mem = stopMem();
printResult({ runId, rowsRead: read, rejected, inserted, updated, unchanged, batches: batchNo, seconds: (performance.now() - t0) / 1000, ...mem });
