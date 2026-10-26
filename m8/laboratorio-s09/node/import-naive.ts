// NAIVE IMPORTER (starting point of the S09 lab). Do NOT copy it as a model.
// It works with a small, perfect file and breaks with a real one. Every weak spot is marked
// with "PROBLEMA:". Your job is to write the improved version (in a new file) and measure both.
//
//   node import-naive.ts                          -> ../data/enrollments.csv
//   node import-naive.ts ../data/enrollments-clean.csv
//   DATABASE_URL=postgres://... node import-naive.ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(process.argv[2] ?? resolve(here, '..', 'data', 'enrollments.csv'));
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:lab@127.0.0.1:18450/lab';

const t0 = performance.now();
let read = 0;
let executed = 0;
let error: string | undefined;

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

try {
  // PROBLEMA: lee el archivo ENTERO en memoria. Con 50 000 filas pasa; con 500 000 o con
  // un archivo de varios GB la memoria crece con el archivo (o el proceso muere).
  const text = readFileSync(FILE, 'utf8');

  // PROBLEMA: split crea una segunda copia completa (un arreglo con todas las líneas),
  // y el map de abajo una tercera (un arreglo de arreglos). Tres copias del archivo a la vez.
  const lines = text.split('\n');

  // PROBLEMA: supone que la primera línea es el encabezado y no comprueba que las columnas
  // sean las esperadas ni que estén en ese orden.
  // PROBLEMA: split(',') no es un lector de CSV: no entiende comillas ("Rojas, Ana") ni
  // saltos de línea dentro de un campo, y no avisa si una fila trae columnas de más o de menos.
  const rows = lines.slice(1).filter((l) => l.length > 0).map((l) => l.split(','));
  read = rows.length;

  // PROBLEMA: UNA sola transacción para todo el archivo. La primera fila mala aborta la
  // transacción y se deshacen también las miles de filas buenas que ya se habían insertado.
  await client.query('BEGIN');

  for (const r of rows) {
    // PROBLEMA: no valida nada (fecha, correo, monto, campos vacíos); deja que la base de
    // datos lo descubra, con un error genérico y sin decir en qué línea del archivo estaba.
    // PROBLEMA: r.slice(0, 6) descarta en silencio las columnas de más: una fila corrida
    // (nombre con coma) puede cargarse con los datos en la columna equivocada.
    // PROBLEMA: un INSERT por fila = una ida y vuelta a la base por fila (50 000 viajes).
    // PROBLEMA: INSERT sin ON CONFLICT: una fila repetida en el archivo, o volver a ejecutar
    // el import, choca con la clave única (y sin esa clave, duplicaría todo en silencio).
    await client.query(
      'INSERT INTO enrollments (external_id, student_name, email, course_code, enrolled_on, amount) VALUES ($1, $2, $3, $4, $5, $6)',
      r.slice(0, 6),
    );
    executed++;
  }

  await client.query('COMMIT');
} catch (e) {
  // PROBLEMA: un error detiene todo. No hay archivo de rechazados con el motivo de cada
  // fila, así que para saber qué estaba mal hay que corregir y reintentar una fila a la vez.
  error = (e as Error).message;
  await client.query('ROLLBACK').catch(() => {});
} finally {
  const { rows } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM enrollments');
  await client.end();
  // Measurement (keep something like this in your improved version).
  const seconds = (performance.now() - t0) / 1000;
  const peakMb = process.resourceUsage().maxRSS / 1024; // maxRSS is in kilobytes
  console.log(`file:               ${FILE}`);
  console.log(`rows read:          ${read}`);
  console.log(`inserts executed:   ${executed}${error && read > 0 ? ` (failed on data row ${executed + 1}, line ${executed + 2} of the file)` : ''}`);
  console.log(`rows in table now:  ${rows[0].n}`);
  console.log(`result:             ${error ? `ERROR - ${error}` : 'COMMIT'}`);
  console.log(`time:               ${seconds.toFixed(2)} s`);
  console.log(`peak memory (RSS):  ${peakMb.toFixed(1)} MB`);
}
