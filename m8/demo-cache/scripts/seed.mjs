// Crea y llena la base: 5000 productos y 3 millones de pedidos repartidos en 24 meses.
// La tabla orders NO tiene indice por product_id: el escenario C2 lo crea y lo borra.
// Uso: node scripts/seed.mjs   (unos 30-60 s)
import pg from 'pg';
import { ORDERS, PG_URL, PRODUCTS } from './lib/env.mjs';

const client = new pg.Client(PG_URL);
await client.connect();
const t0 = performance.now();
await client.query(`
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS products;
  CREATE TABLE products (
    id       int PRIMARY KEY,
    name     text NOT NULL,
    category int NOT NULL,
    version  int NOT NULL DEFAULT 1   -- sube con cada pedido nuevo; sirve para el ETag por version (C3b)
  );
  CREATE TABLE orders (
    id          bigserial PRIMARY KEY,
    product_id  int NOT NULL,
    customer_id int NOT NULL,
    amount      numeric(10,2) NOT NULL,
    created_at  timestamptz NOT NULL,
    note        text
  );
`);
await client.query(
  `INSERT INTO products (id, name, category)
   SELECT g, 'Producto ' || g, 1 + g % 40 FROM generate_series(1, $1) g`,
  [PRODUCTS],
);
await client.query(
  `INSERT INTO orders (product_id, customer_id, amount, created_at, note)
   SELECT 1 + floor(random() * $1)::int,
          1 + floor(random() * 200000)::int,
          round((5 + random() * 495)::numeric, 2),
          timestamptz '2026-10-01' - random() * interval '730 days',
          md5(g::text)
   FROM generate_series(1, $2) g`,
  [PRODUCTS, ORDERS],
);
await client.query('VACUUM ANALYZE products');
await client.query('VACUUM ANALYZE orders');
const { rows } = await client.query(
  `SELECT pg_size_pretty(pg_total_relation_size('orders')) AS size, (SELECT count(*) FROM orders) AS n`,
);
console.log(`orders: ${rows[0].n} filas, ${rows[0].size}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
await client.end();
