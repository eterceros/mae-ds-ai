import pg from 'pg';
import { DATABASE_URL } from './config.ts';

export function makePool(max = 10) {
  return new pg.Pool({ connectionString: DATABASE_URL, max });
}

// I1. Webhook entrante de un proveedor de pagos.
export const SCHEMA_I1 = `
DROP TABLE IF EXISTS payments_ledger, webhook_inbox CASCADE;

-- Efecto del webhook: un abono en el libro de pagos. Sin UNIQUE a propósito: así se ve
-- cuántas veces se aplicó cada evento.
CREATE TABLE payments_ledger (
  id           bigserial PRIMARY KEY,
  event_id     text NOT NULL,
  order_id     text NOT NULL,
  amount_cents int  NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Bandeja de entrada (solo la usa src/despues/): una fila por evento, clave = webhook-id.
CREATE TABLE webhook_inbox (
  event_id     text PRIMARY KEY,
  event_type   text NOT NULL,
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  status       text NOT NULL DEFAULT 'pending',
  attempts     int  NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_error   text,
  processed_at timestamptz
);
CREATE INDEX webhook_inbox_todo ON webhook_inbox (received_at) WHERE status <> 'done';
`;

// I2. Carga por lotes de un CSV de clientes.
export const SCHEMA_I2 = `
DROP TABLE IF EXISTS customers_naive, customers, customers_staging, import_runs CASCADE;

-- Destino de src/antes/importer.ts: sin clave natural, tal como lo haría un script rápido.
CREATE TABLE customers_naive (
  id           bigserial PRIMARY KEY,
  external_id  text NOT NULL,
  email        text NOT NULL,
  full_name    text NOT NULL,
  country      text NOT NULL,
  amount_cents int  NOT NULL,
  signup_date  date NOT NULL
);

-- Destino de src/despues/importer.ts: la clave del sistema de origen es la clave primaria.
CREATE TABLE customers (
  external_id  text PRIMARY KEY,
  email        text NOT NULL,
  full_name    text NOT NULL,
  country      char(2) NOT NULL,
  amount_cents int  NOT NULL CHECK (amount_cents >= 0),
  signup_date  date NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Registro de cada ejecución: qué archivo, cuántas filas, qué cambió.
CREATE TABLE import_runs (
  id            serial PRIMARY KEY,
  file          text NOT NULL,
  started_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at   timestamptz,
  rows_read     int,
  rows_rejected int,
  inserted      int,
  updated       int,
  unchanged     int
);

-- Tabla intermedia: lo validado se escribe aquí y desde aquí se fusiona con el destino.
-- UNLOGGED: no pasa por el WAL (más rápida); si Postgres se cae se vacía, lo que aquí no importa
-- porque se puede volver a cargar desde el archivo.
CREATE UNLOGGED TABLE customers_staging (
  run_id       int  NOT NULL,
  batch_no     int  NOT NULL,
  line_no      int  NOT NULL,
  external_id  text NOT NULL,
  email        text NOT NULL,
  full_name    text NOT NULL,
  country      char(2) NOT NULL,
  amount_cents int  NOT NULL,
  signup_date  date NOT NULL,
  PRIMARY KEY (run_id, line_no)
);
CREATE INDEX customers_staging_batch ON customers_staging (run_id, batch_no);
`;

// I3. Envío de pedidos a un tercero.
export const SCHEMA_I3 = `
DROP TABLE IF EXISTS orders_to_sync, sync_state, outbound CASCADE;

-- Pedidos que hay que enviar al tercero.
CREATE TABLE orders_to_sync (
  id           int PRIMARY KEY,
  customer     text NOT NULL,
  amount_cents int  NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- src/antes/sender.ts: sincronización con "marca de agua" (hasta qué updated_at ya se envió).
CREATE TABLE sync_state (name text PRIMARY KEY, last_synced_at timestamptz NOT NULL);
INSERT INTO sync_state VALUES ('third-party', '-infinity');

-- src/despues/sender.ts: una fila por envío pendiente (la outbox de la S08).
CREATE TABLE outbound (
  id              bigserial PRIMARY KEY,
  order_id        int  NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        int  NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz
);
CREATE INDEX outbound_pending ON outbound (next_attempt_at) WHERE status = 'pending';
`;
