import pg from 'pg';
import { DATABASE_URL } from './config.ts';

export function makePool(max = 10) {
  return new pg.Pool({ connectionString: DATABASE_URL, max });
}

// Esquema de la demo. `reset` lo deja vacío (lo usan los scripts antes de cada corrida).
export const SCHEMA = `
DROP TABLE IF EXISTS orders, outbox, shipments, processed_messages, summary_jobs CASCADE;

CREATE TABLE orders (
  id           uuid PRIMARY KEY,
  seq          int  NOT NULL,
  customer     text NOT NULL,
  amount_cents int  NOT NULL CHECK (amount_cents > 0),
  traceparent  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Outbox transaccional: el evento se escribe en la MISMA transacción que el pedido.
CREATE TABLE outbox (
  id           bigserial PRIMARY KEY,
  event_id     uuid NOT NULL UNIQUE,
  exchange     text NOT NULL DEFAULT 'orders',
  routing_key  text NOT NULL,
  payload      jsonb NOT NULL,
  headers      jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
-- Índice parcial: el relay solo busca lo pendiente.
CREATE INDEX outbox_pending ON outbox (id) WHERE published_at IS NULL;

-- Efecto del consumidor "envíos": una fila por envío. Sin UNIQUE a propósito (Q3).
CREATE TABLE shipments (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL,
  event_id    uuid NOT NULL,
  traceparent text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Consumidor idempotente (Q4): un mensaje se procesa una vez por consumidor.
CREATE TABLE processed_messages (
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

-- E4 (Q7): recurso de estado de un trabajo asíncrono.
CREATE TABLE summary_jobs (
  id                 uuid PRIMARY KEY,
  status             text NOT NULL DEFAULT 'pending',   -- pending | done | failed
  input              text NOT NULL,
  result             text,
  error              text,
  attempts           int  NOT NULL DEFAULT 0,
  traceparent_in     text,
  traceparent_worker text,
  created_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at         timestamptz,
  finished_at        timestamptz
);
`;
