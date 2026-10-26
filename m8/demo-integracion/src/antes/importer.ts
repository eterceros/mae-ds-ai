// ANTES (mala práctica) — Importar un CSV de clientes (I2).
//   node src/antes/importer.ts data/clientes-50000.csv
// Lo que suele salir en un primer intento:
//   1. Lee el archivo ENTERO en memoria y lo convierte en un arreglo de objetos: la memoria crece con
//      el tamaño del archivo.
//   2. No valida nada: confía en que la base rechace lo malo. Lo que la base no rechaza (un correo
//      vacío, un monto negativo, un país inventado) entra como basura.
//   3. Un INSERT por fila (una ida y vuelta a la base por fila), todo en UNA transacción: la primera
//      fila que la base rechaza aborta la carga entera, y no queda registro de cuáles eran las malas.
//   4. No hay clave natural ni upsert: volver a ejecutarlo duplica todo.
// La versión corregida está en src/despues/importer.ts.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { DATABASE_URL } from '../lib/config.ts';
import { startMemorySampler, printResult } from '../lib/memory.ts';

const file = process.argv[2];
const stopMem = startMemorySampler();
const t0 = performance.now();

const text = readFileSync(file, 'utf8');                       // <- todo el archivo en memoria
const rows = text.split('\n').slice(1).filter((l) => l.trim() !== '').map((l) => {
  const [external_id, email, full_name, country, amount_cents, signup_date] = l.split(',');
  return { external_id, email, full_name, country, amount_cents, signup_date };
});                                                             // <- y además como objetos

const db = new pg.Client({ connectionString: DATABASE_URL });
await db.connect();
let inserted = 0, failedAt: number | null = null, error = '';
try {
  await db.query('BEGIN');
  for (const r of rows) {                                       // <- un INSERT por fila
    await db.query(
      'INSERT INTO customers_naive (external_id, email, full_name, country, amount_cents, signup_date) VALUES ($1,$2,$3,$4,$5,$6)',
      [r.external_id, r.email, r.full_name, r.country, r.amount_cents, r.signup_date]);
    inserted++;
  }
  await db.query('COMMIT');
} catch (e) {
  await db.query('ROLLBACK');                                   // <- una fila mala deshace todo
  failedAt = inserted + 2;                                      // línea del archivo (1 = cabecera)
  error = String((e as Error).message);
  inserted = 0;
  console.error(`falló en la línea ${failedAt}: ${error}`);
}
await db.end();
const mem = stopMem();
printResult({ rowsRead: rows.length, inserted, failedAt, error, seconds: (performance.now() - t0) / 1000, ...mem });
