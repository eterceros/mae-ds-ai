// Aplicador de migraciones minimo: corre una vez y termina (escenario K6).
// Lleva la cuenta en schema_migrations; si una migracion ya se aplico, la salta.
// Cada archivo va en su propia transaccion: si falla, no queda a medias y el
// proceso sale con codigo 1, asi Compose no arranca la API.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearPool } from './db';

async function main() {
  const dir = process.env.MIGRACIONES_DIR ?? join(__dirname, '..', 'migrations');
  const pool = crearPool();
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (archivo text PRIMARY KEY, aplicada_en timestamptz NOT NULL DEFAULT now())',
  );
  const { rows } = await pool.query('SELECT archivo FROM schema_migrations');
  const hechas = new Set(rows.map((r) => r.archivo));
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  let aplicadas = 0;
  for (const archivo of archivos) {
    if (hechas.has(archivo)) continue;
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(readFileSync(join(dir, archivo), 'utf8'));
      await cliente.query('INSERT INTO schema_migrations (archivo) VALUES ($1)', [archivo]);
      await cliente.query('COMMIT');
      aplicadas++;
      console.log(`migracion aplicada: ${archivo}`);
    } catch (err) {
      await cliente.query('ROLLBACK');
      throw new Error(`fallo ${archivo}: ${(err as Error).message}`);
    } finally {
      cliente.release();
    }
  }
  console.log(`migraciones: ${aplicadas} aplicadas, ${archivos.length - aplicadas} ya estaban`);
  await pool.end();
}

main().catch((err) => {
  console.error('Migracion fallida:', err.message ?? err);
  process.exit(1);
});
