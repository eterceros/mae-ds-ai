import pg from 'pg';
import { DATABASE_URL, SCHEMA } from './config.js';

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });

// Tablas del pedido y de la outbox (patrón de la S08). "headers" son las cabeceras AMQP que el
// relay pondrá al publicar: ahí viaja el contexto de la traza de la petición que creó el pedido.
export async function ensureSchema() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(1111)'); // api y relay arrancan a la vez
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.pedidos (
      id uuid PRIMARY KEY, sku text NOT NULL, cantidad int NOT NULL, total_cents int NOT NULL,
      creado timestamptz NOT NULL DEFAULT now())`);
    await c.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.outbox (
      id bigserial PRIMARY KEY, pedido_id uuid NOT NULL, payload jsonb NOT NULL,
      headers jsonb NOT NULL DEFAULT '{}', creado timestamptz NOT NULL DEFAULT now(), publicado timestamptz)`);
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
