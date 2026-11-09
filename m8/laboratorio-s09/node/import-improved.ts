// IMPORTADOR MEJORADO (solución del docente del laboratorio S09). Compárenlo con import-naive.ts:
// cada «CORRECCIÓN:» de este archivo responde a un «PROBLEMA:» de la ingenua.
//
//   node import-improved.ts                                   -> ../data/enrollments.csv
//   node import-improved.ts ../data/enrollments-500k.csv
//   node import-improved.ts <csv> <archivo-de-rechazados.csv>
//   DATABASE_URL=postgres://... node import-improved.ts
//
// Cómo trabaja, en tres fases:
//   1. Lee el CSV por partes, valida cada fila y escribe las válidas en la tabla intermedia
//      (enrollments_staging) en lotes de BATCH filas; las inválidas van al archivo de rechazados.
//   2. Pasa de la intermedia a la final (enrollments) en lotes de BATCH external_id, con un upsert
//      idempotente; cada lote es una transacción.
//   3. Borra la intermedia de esta corrida, anota las cuentas en import_runs e imprime el resumen.
//
// Regla de repetidas: si un external_id aparece varias veces en el archivo, GANA LA ÚLTIMA APARICIÓN
// (la línea más alta), porque en este archivo la repetición con otro monto es una «corrección».
// Frente a lo que ya está en la base: si los datos son iguales no se toca la fila; si cambiaron, se actualiza.
//
// Dependencias: solo `pg` (la que ya declara package.json). El lector de CSV es propio (ver readCsv).
import { createReadStream, createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(process.argv[2] ?? resolve(here, '..', 'data', 'enrollments.csv'));
const REJECTS = resolve(process.argv[3] ?? resolve(here, '..', 'results', `rechazados-${basename(FILE, extname(FILE))}-node.csv`));
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:lab@127.0.0.1:18450/lab';
const BATCH = Number(process.env.BATCH ?? 1000);
if (!Number.isInteger(BATCH) || BATCH <= 0) {
  console.error(`BATCH debe ser un entero mayor que 0 (vino: ${process.env.BATCH})`);
  process.exit(1);
}
const HEADER = ['external_id', 'student_name', 'email', 'course_code', 'enrolled_on', 'amount'];
// Una comilla sin cerrar no puede tragarse el resto del archivo: si la fila sigue abierta tras
// MAX_RECORD_LINES líneas (o MAX_RECORD_CHARS caracteres), se rechaza SOLO su primera línea y las
// siguientes se vuelven a leer como filas normales.
const MAX_RECORD_LINES = 20;
const MAX_RECORD_CHARS = 64 * 1024;

const t0 = performance.now();

// ---------------------------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------------------------

// CORRECCIÓN (lee el archivo ENTERO / tres copias): se lee por partes, de a 64 KB. El for await pide
// el trozo siguiente solo cuando el código terminó con el anterior, y mientras se escribe un lote en la
// base no se lee nada más (contrapresión). En memoria hay un trozo y un lote, no el archivo.
async function* physicalLines(path: string): AsyncGenerator<string> {
  let rest = '';
  for await (const chunk of createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop()!;
    for (const p of parts) yield p.endsWith('\r') ? p.slice(0, -1) : p;
  }
  if (rest !== '') yield rest.endsWith('\r') ? rest.slice(0, -1) : rest;
}

// Separa una fila con comillas según el RFC 4180: "Rojas, Ana" es UN campo y "" dentro de comillas es
// una comilla. Devuelve null si la fila termina con una comilla abierta (el campo sigue en la línea siguiente).
function splitQuoted(text: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === ',') { fields.push(field); field = ''; }
    else field += c;
  }
  if (inQuotes) return null;
  fields.push(field);
  return fields;
}

type CsvRecord = { line: number; raw: string; fields: string[] | null };

// CORRECCIÓN (split(',') no es un lector de CSV): lector propio sobre las líneas del stream. Alcanza
// para este archivo porque cubre lo que el RFC 4180 permite: comas y comillas dobladas dentro de
// comillas, y saltos de línea dentro de un campo (la fila se arma con las líneas siguientes). Una fila
// sin comillas, que es casi todo el archivo, va por el camino rápido (split). No intenta adivinar
// columnas: entrega los campos tal como vienen y la validación cuenta cuántos son.
// `line` es la línea del archivo donde EMPIEZA la fila (la que verá quien abra el CSV).
// Si una comilla no se cierra en MAX_RECORD_LINES líneas (o hasta el final del archivo), se entrega
// la primera línea con fields === null (se rechazará por «comilla sin cerrar») y las demás se
// vuelven a leer desde cero: así una comilla suelta no se lleva filas válidas.
async function* readCsv(path: string): AsyncGenerator<CsvRecord> {
  let pending: string[] = [];   // líneas de la fila que sigue abierta
  let startLine = 0;

  function* feed(text: string, lineNo: number): Generator<CsvRecord> {
    if (pending.length === 0 && !text.includes('"')) {   // camino rápido: fila sin comillas
      if (text !== '') yield { line: lineNo, raw: text, fields: text.split(',') };
      return;
    }
    if (pending.length === 0) startLine = lineNo;
    pending.push(text);
    const raw = pending.join('\n');
    const fields = splitQuoted(raw);
    if (fields !== null) { pending = []; yield { line: startLine, raw, fields }; return; }
    if (pending.length >= MAX_RECORD_LINES || raw.length >= MAX_RECORD_CHARS) yield* giveUp();
  }

  function* giveUp(): Generator<CsvRecord> {
    const [first, ...rest] = pending;
    const firstLine = startLine;
    pending = [];
    yield { line: firstLine, raw: first, fields: null };
    for (let i = 0; i < rest.length; i++) yield* feed(rest[i], firstLine + 1 + i);
  }

  let lineNo = 0;
  for await (const text of physicalLines(path)) yield* feed(text, ++lineNo);
  while (pending.length > 0) yield* giveUp();   // el archivo terminó con una comilla abierta
}

// ---------------------------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------------------------

type Row = { line: number; external_id: string; student_name: string; email: string; course_code: string; enrolled_on: string; amount: string };
type Check = { ok: true; row: Row } | { ok: false; reason: string; detail: string };

const RE_ID = /^INS-\d{7}$/;
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;   // la misma forma que el CHECK de la tabla
const RE_COURSE = /^[A-Z]{2,4}-\d{3}$/;           // el mismo formato que el CHECK de la tabla
const RE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_AMOUNT = /^-?\d+(\.\d{1,2})?$/;

// AAAA-MM-DD y una fecha que exista (2026-02-30 y 2026-13-08 no existen).
function isIsoDate(s: string): boolean {
  const m = RE_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // setUTCFullYear y no Date.UTC: Date.UTC(99, ...) entiende 1999, y el año 0099 dejaría de coincidir.
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// CORRECCIÓN (no valida nada; la base lo descubre con un error genérico y sin línea): cada fila se
// valida aquí, antes de tocar la base, y la que no pasa devuelve un motivo corto y estable (para
// contar) y un detalle legible (para quien corrige el archivo). No se valida con la base porque
// Postgres acepta 2026/03/05 y lee 05/03/2026 como 3 de mayo (DateStyle = ISO, MDY).
// CORRECCIÓN (slice(0, 6) descarta columnas de más en silencio): una fila con otro número de
// columnas se rechaza entera; no se intenta adivinar qué campo se corrió.
function validate(rec: CsvRecord): Check {
  const no = (reason: string, detail: string): Check => ({ ok: false, reason, detail });
  if (rec.fields === null) return no('comilla_sin_cerrar', 'comilla sin cerrar: se rechaza esta línea y las siguientes se leen como filas nuevas');
  if (rec.fields.length !== HEADER.length) return no('numero_de_columnas', `se esperaban ${HEADER.length} columnas y hay ${rec.fields.length}`);
  const [external_id, student_name, email, course_code, enrolled_on, amount] = rec.fields.map((f) => f.trim());
  const values = [external_id, student_name, email, course_code, enrolled_on, amount];
  const empty = values.findIndex((v) => v === '');
  if (empty >= 0) return no('campo_vacio', `${HEADER[empty]} vacío`);
  if (!RE_ID.test(external_id)) return no('external_id_invalido', `external_id con formato inválido: ${external_id}`);
  if (!RE_EMAIL.test(email)) return no('correo_invalido', `correo con formato inválido: ${email}`);
  if (!RE_COURSE.test(course_code)) return no('curso_invalido', `código de curso inválido: ${course_code}`);
  if (!isIsoDate(enrolled_on)) return no('fecha_invalida', `fecha inválida (se espera AAAA-MM-DD existente): ${enrolled_on}`);
  if (!RE_AMOUNT.test(amount)) return no('monto_invalido', `monto no numérico: ${amount}`);
  if (amount.startsWith('-')) return no('monto_negativo', `monto negativo: ${amount}`);
  if (Number(amount) >= 1e8) return no('monto_fuera_de_rango', `monto mayor que numeric(10,2): ${amount}`);
  return { ok: true, row: { line: rec.line, external_id, student_name, email, course_code, enrolled_on, amount } };
}

const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

// ---------------------------------------------------------------------------------------------
// Base de datos
// ---------------------------------------------------------------------------------------------

// CORRECCIÓN (supone el encabezado sin comprobarlo): se lee la primera fila ANTES de conectarse y de
// anotar la corrida en import_runs. Si las columnas no son las esperadas o vienen en otro orden, se
// detiene sin tocar la base, en vez de rechazar 50 000 filas una por una.
const records = readCsv(FILE);
{
  const { value: first } = await records.next();
  const got = (first?.fields ?? []).map((f, i) => (i === 0 ? f.replace(/^﻿/, '') : f).trim());
  if (got.join(',') !== HEADER.join(',')) {
    console.error(`encabezado inesperado en la línea ${first?.line ?? 1}: ${first?.raw ?? '(archivo vacío)'}`);
    process.exit(1);
  }
}

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
await db.query(readFileSync(resolve(here, '..', 'sql', 'staging.sql'), 'utf8'));

// Una sola carga a la vez: con dos cargas simultáneas no se duplicarían filas (lo impide la clave
// única), pero se esperarían entre ellas y se mezclarían sus cuentas. El candado dura lo que la conexión.
const { rows: [lock] } = await db.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext('s09-enrollments-import')) AS ok");
if (!lock.ok) {
  console.error('Hay otra carga en curso (candado tomado). Esperen a que termine.');
  await db.end();
  process.exit(1);
}
// Con el candado tomado nadie más está cargando: lo que haya en la intermedia es de una corrida que se
// cayó o se cortó, y se descarta (la tabla final no depende de eso; ver la fase 2).
await db.query('TRUNCATE enrollments_staging');
const { rows: [run] } = await db.query<{ id: string }>("INSERT INTO import_runs (file, tool) VALUES ($1, 'node') RETURNING id", [FILE]);
const runId = run.id;

// CORRECCIÓN (un INSERT por fila = 50 000 idas y vueltas): un solo INSERT por lote de BATCH filas,
// que recibe siete arreglos y los convierte en filas con unnest. Cada INSERT es su propia transacción
// (autocommit): si el proceso muere aquí, la tabla final no cambió y la intermedia se descarta al relanzar.
async function stageBatch(rows: Row[]): Promise<void> {
  await db.query(
    `INSERT INTO enrollments_staging (run_id, line, external_id, student_name, email, course_code, enrolled_on, amount)
     SELECT $1, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[], $7::date[], $8::numeric[])`,
    [runId, rows.map((r) => r.line), rows.map((r) => r.external_id), rows.map((r) => r.student_name),
     rows.map((r) => r.email), rows.map((r) => r.course_code), rows.map((r) => r.enrolled_on), rows.map((r) => r.amount)],
  );
}

// CORRECCIÓN (INSERT sin ON CONFLICT: repetir el import falla o duplica): upsert idempotente desde la
// intermedia, de a BATCH external_id por transacción, recorridos en orden (keyset: «los siguientes
// después del último que procesé»).
//  - DISTINCT ON (external_id) ... ORDER BY external_id, line DESC: una fila por id, la última del
//    archivo (la regla de repetidas). Como se deduplica sobre TODA la corrida y no por lote de lectura,
//    una repetida que cae en otro lote no hace que la segunda ejecución «corrija» y «descorrija».
//    Además evita «ON CONFLICT DO UPDATE command cannot affect row a second time».
//  - ON CONFLICT (external_id) DO UPDATE: si ya existe, se actualiza; nunca se duplica.
//  - WHERE ... IS DISTINCT FROM ...: si los datos son iguales no se escribe nada (ni updated_at), así
//    la segunda ejecución da 0 insertadas y 0 actualizadas.
//  - RETURNING (xmax = 0): true = insertada, false = actualizada (truco conocido de Postgres, no
//    documentado como contrato; alternativa: contar antes y después).
const MERGE = `
WITH src AS (
  SELECT DISTINCT ON (external_id) external_id, student_name, email, course_code, enrolled_on, amount
    FROM enrollments_staging
   WHERE run_id = $1 AND external_id > $2
   ORDER BY external_id, line DESC
   LIMIT $3
), up AS (
  INSERT INTO enrollments AS e (external_id, student_name, email, course_code, enrolled_on, amount)
  SELECT external_id, student_name, email, course_code, enrolled_on, amount FROM src
  ON CONFLICT (external_id) DO UPDATE
     SET student_name = EXCLUDED.student_name, email = EXCLUDED.email, course_code = EXCLUDED.course_code,
         enrolled_on = EXCLUDED.enrolled_on, amount = EXCLUDED.amount, updated_at = now()
   WHERE (e.student_name, e.email, e.course_code, e.enrolled_on, e.amount)
         IS DISTINCT FROM (EXCLUDED.student_name, EXCLUDED.email, EXCLUDED.course_code, EXCLUDED.enrolled_on, EXCLUDED.amount)
  RETURNING (xmax = 0) AS ins
)
SELECT (SELECT count(*) FROM src)::int            AS keys,
       (SELECT max(external_id) FROM src)         AS last_key,
       (SELECT count(*) FROM up WHERE ins)::int     AS inserted,
       (SELECT count(*) FROM up WHERE NOT ins)::int AS updated`;

// ---------------------------------------------------------------------------------------------
// Fase 1: leer, validar, rechazar o poner en la intermedia
// ---------------------------------------------------------------------------------------------

mkdirSync(dirname(REJECTS), { recursive: true });
const rejects = createWriteStream(REJECTS, { encoding: 'utf8' });
rejects.write('linea,motivo,detalle,fila_original\n');

let read = 0, valid = 0, rejected = 0, stagedBatches = 0, mergedBatches = 0;
const byReason = new Map<string, number>();
let batch: Row[] = [];

for await (const rec of records) {   // sigue después del encabezado, ya comprobado
  read++;
  const v = validate(rec);
  if (!v.ok) {
    // CORRECCIÓN (un error detiene todo y no hay registro de rechazados): la fila mala va al archivo
    // de rechazados con su línea, su motivo y la fila original, y la carga sigue.
    rejected++;
    byReason.set(v.reason, (byReason.get(v.reason) ?? 0) + 1);
    const out = `${rec.line},${v.reason},${csvField(v.detail)},${csvField(rec.raw)}\n`;
    if (!rejects.write(out)) await once(rejects, 'drain');
    continue;
  }
  valid++;
  batch.push(v.row);
  if (batch.length >= BATCH) { await stageBatch(batch); stagedBatches++; batch = []; }
}
if (batch.length > 0) { await stageBatch(batch); stagedBatches++; batch = []; }
rejects.end();
await once(rejects, 'finish');
// La intermedia se acaba de llenar y Postgres todavía no tiene estadísticas de ella: sin ANALYZE, cada
// lote de la fase 2 ordena TODAS las filas que quedan (medido: 29 ms por lote con 48 000 filas, y crece
// con el archivo); con ANALYZE recorre el índice y se detiene a las BATCH filas (0,4 ms).
await db.query('ANALYZE enrollments_staging');
const tStaged = performance.now();

// Repetidas: ids que aparecen más de una vez entre las filas válidas, y cuántos con datos distintos.
const { rows: [dup] } = await db.query<{ ids: number; extra_rows: number; ids_different: number }>(`
  SELECT count(*)::int AS ids, coalesce(sum(n - 1), 0)::int AS extra_rows,
         count(*) FILTER (WHERE versions > 1)::int AS ids_different
    FROM (SELECT external_id, count(*) AS n,
                 count(DISTINCT (student_name, email, course_code, enrolled_on, amount)) AS versions
            FROM enrollments_staging WHERE run_id = $1
           GROUP BY external_id HAVING count(*) > 1) t`, [runId]);

// ---------------------------------------------------------------------------------------------
// Fase 2: de la intermedia a la final, de a BATCH ids por transacción
// ---------------------------------------------------------------------------------------------

// CORRECCIÓN (UNA transacción para todo el archivo): una transacción por lote de BATCH ids. Una fila
// mala ya no puede abortar nada (no llega a la base), y si el proceso se corta aquí, la final queda
// con algunos lotes ya fusionados, cada uno con su valor definitivo (la última aparición del archivo).
// Relanzar con el mismo archivo deja exactamente el mismo resultado: los lotes ya hechos dan «sin
// cambios» y los que faltaban se insertan.
console.error('fase 2: fusionando…');   // a stderr: marca para la demostración de la caída a la mitad
let inserted = 0, updated = 0, keys = 0;
let lastKey = '';
for (;;) {
  await db.query('BEGIN');
  const { rows: [m] } = await db.query<{ keys: number; last_key: string | null; inserted: number; updated: number }>(MERGE, [runId, lastKey, BATCH]);
  await db.query('COMMIT');
  if (m.keys === 0) break;
  mergedBatches++;
  keys += m.keys; inserted += m.inserted; updated += m.updated;
  lastKey = m.last_key!;
}
const unchanged = keys - inserted - updated;

// ---------------------------------------------------------------------------------------------
// Fase 3: limpiar, registrar y resumir
// ---------------------------------------------------------------------------------------------

await db.query('DELETE FROM enrollments_staging WHERE run_id = $1', [runId]);
await db.query(
  `UPDATE import_runs SET finished_at = clock_timestamp(), rows_read = $2, rejected = $3, duplicates = $4,
          inserted = $5, updated = $6, unchanged = $7 WHERE id = $1`,
  [runId, read, rejected, dup.extra_rows, inserted, updated, unchanged]);
const tDone = performance.now();
const { rows: [tbl] } = await db.query<{ n: number; d: number }>('SELECT count(*)::int AS n, count(DISTINCT external_id)::int AS d FROM enrollments');
await db.end();

const seconds = (tDone - t0) / 1000;
const peakMb = process.resourceUsage().maxRSS / 1024; // maxRSS viene en kilobytes
const accountsOk = read === valid + rejected && valid === keys + dup.extra_rows && keys === inserted + updated + unchanged;
const fmt = (n: number) => String(n).padStart(7);

console.log(`archivo:                 ${FILE}`);
console.log(`corrida (import_runs):   ${runId}`);
console.log(`filas leídas:            ${fmt(read)}`);
console.log(`rechazadas:              ${fmt(rejected)}   -> ${REJECTS}`);
for (const [reason, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${reason.padEnd(22)}${fmt(n)}`);
console.log(`válidas:                 ${fmt(valid)}`);
console.log(`repetidas (external_id): ${fmt(dup.extra_rows)}   en ${dup.ids} ids; ${dup.ids_different} con datos distintos (gana la última aparición)`);
console.log(`ids únicos:              ${fmt(keys)}`);
console.log(`insertadas:              ${fmt(inserted)}`);
console.log(`actualizadas:            ${fmt(updated)}`);
console.log(`sin cambios:             ${fmt(unchanged)}`);
console.log(`filas en la tabla:       ${fmt(tbl.n)}   (external_id distintos: ${tbl.d})`);
console.log(`cuentas:                 ${accountsOk ? 'cierran' : 'NO CIERRAN'} (leídas = válidas + rechazadas; válidas = únicas + repetidas; únicas = insertadas + actualizadas + sin cambios)`);
console.log(`resultado:               COMMIT (${stagedBatches} lotes a la intermedia, ${mergedBatches} lotes de fusión de ${BATCH})`);
console.log(`tiempo:                  ${seconds.toFixed(2)} s   (leer+validar+intermedia ${((tStaged - t0) / 1000).toFixed(2)} s, fusión ${((tDone - tStaged) / 1000).toFixed(2)} s)`);
console.log(`memoria máxima (RSS):    ${peakMb.toFixed(1)} MB`);
