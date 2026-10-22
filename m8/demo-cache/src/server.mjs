// API de la demo de caché (M8, S06). Fastify + node-postgres + ioredis (el mismo cliente para Redis y Valkey).
// Un solo recurso: el resumen de ventas de un producto por mes, una consulta costosa sin índice.
// Cada instancia cuenta las consultas que envía a Postgres y los aciertos/fallos de caché (GET /stats).
// Uso: PORT=18500 node src/server.mjs
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PG_URL, REDIS_URL, VALKEY_URL } from '../scripts/lib/env.mjs';

const PORT = Number(process.env.PORT ?? 18500);
const pool = new pg.Pool({ connectionString: PG_URL, max: Number(process.env.PG_POOL ?? 10) });
const stores = { redis: new Redis(REDIS_URL), valkey: new Redis(VALKEY_URL) };

const stats = {};
const resetStats = () =>
  Object.assign(stats, { summaryQueries: 0, versionQueries: 0, writeQueries: 0, hits: 0, misses: 0, staleServed: 0, lockWaits: 0 });
resetStats();

// ---------- Postgres ----------
const SUMMARY_SQL = `
  SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*)::int AS orders, sum(amount)::float8 AS revenue
  FROM orders WHERE product_id = $1 GROUP BY 1 ORDER BY 1`;

async function loadSummary(id) {
  stats.summaryQueries += 1;
  const { rows } = await pool.query(SUMMARY_SQL, [id]);
  const orders = rows.reduce((a, r) => a + r.orders, 0);
  const revenue = rows.reduce((a, r) => a + r.revenue, 0);
  return { productId: id, orders, revenue: Math.round(revenue * 100) / 100, months: rows };
}

async function productVersion(id) {
  stats.versionQueries += 1;
  const { rows } = await pool.query('SELECT version FROM products WHERE id = $1', [id]);
  return rows[0]?.version;
}

// ---------- Caché (cache-aside) y defensas contra la estampida ----------
const key = (id) => `summary:${id}`;
const inflight = new Map(); // single-flight local: una sola consulta por clave y por proceso
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ttlWithJitter = (ttl, jitter) => Math.max(1, Math.round(ttl * (1 + jitter * (Math.random() * 2 - 1))));

// Borra el candado solo si sigue siendo nuestro (atómico en el servidor).
const UNLOCK_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

async function computeAndStore(store, id, o) {
  const t0 = performance.now();
  const value = await loadSummary(id);
  const delta = performance.now() - t0; // cuánto costó recalcular (lo usa XFetch)
  const ttl = ttlWithJitter(o.ttl, o.jitter);
  if (o.defense === 'xfetch' || o.defense === 'swr') {
    // Guardamos el vencimiento lógico dentro del valor. En swr la clave vive el doble (se puede servir vieja).
    const envelope = { v: value, exp: Date.now() + ttl, delta };
    await store.set(key(id), JSON.stringify(envelope), 'PX', o.defense === 'swr' ? ttl * 2 : ttl);
  } else {
    await store.set(key(id), JSON.stringify(value), 'PX', ttl);
  }
  return value;
}

async function cached(store, id, o) {
  const raw = await store.get(key(id));

  if (o.defense === 'xfetch' || o.defense === 'swr') {
    if (raw) {
      const env = JSON.parse(raw);
      if (o.defense === 'xfetch') {
        // XFetch (Vattani et al., 2015): recalcula antes de tiempo con probabilidad creciente al acercarse el vencimiento.
        const early = -env.delta * o.beta * Math.log(Math.random());
        if (Date.now() + early < env.exp) {
          stats.hits += 1;
          return env.v;
        }
        stats.misses += 1;
        return computeAndStore(store, id, o);
      }
      // swr: si ya pasó el vencimiento lógico, uno solo refresca en segundo plano y todos reciben el valor viejo.
      stats.hits += 1;
      if (Date.now() >= env.exp) {
        stats.staleServed += 1;
        const token = randomUUID();
        const got = await store.set(`lock:${key(id)}`, token, 'PX', 5000, 'NX');
        if (got) {
          computeAndStore(store, id, o)
            .catch(() => {})
            .finally(() => store.eval(UNLOCK_LUA, 1, `lock:${key(id)}`, token));
        }
      }
      return env.v;
    }
    stats.misses += 1;
    return computeAndStore(store, id, o);
  }

  if (raw) {
    stats.hits += 1;
    return JSON.parse(raw);
  }
  stats.misses += 1;

  if (o.defense === 'singleflight') {
    const k = `${o.storeName}:${id}`;
    let p = inflight.get(k);
    if (!p) {
      p = computeAndStore(store, id, o).finally(() => inflight.delete(k));
      inflight.set(k, p);
    }
    return p;
  }

  if (o.defense === 'lock') {
    // Candado distribuido con SET NX PX: un solo proceso (de todas las instancias) consulta la base.
    const token = randomUUID();
    const lockKey = `lock:${key(id)}`;
    if (await store.set(lockKey, token, 'PX', 5000, 'NX')) {
      try {
        return await computeAndStore(store, id, o);
      } finally {
        await store.eval(UNLOCK_LUA, 1, lockKey, token);
      }
    }
    stats.lockWaits += 1;
    for (let i = 0; i < 150; i++) {
      await sleep(10);
      const again = await store.get(key(id));
      if (again) return JSON.parse(again);
    }
    return computeAndStore(store, id, o); // el dueño del candado murió o tardó demasiado
  }

  return computeAndStore(store, id, o); // sin defensa
}

// ---------- HTTP ----------
const app = Fastify({ logger: false, keepAliveTimeout: 60_000 });
const etagOf = (body) => `"${createHash('sha1').update(body).digest('base64url')}"`;
const options = (q, storeName) => ({
  storeName,
  ttl: Number(q.ttl ?? 30_000),
  jitter: Number(q.jitter ?? 0),
  defense: q.defense ?? 'none',
  beta: Number(q.beta ?? 1),
});

app.get('/stats', async () => stats);
app.post('/stats/reset', async () => {
  resetStats();
  return stats;
});

// C1 y C2: siempre a la base.
app.get('/db/products/:id/summary', async (req) => loadSummary(Number(req.params.id)));

// C3a: ETag calculado sobre el cuerpo. Ahorra bytes, pero la consulta costosa se ejecuta igual.
app.get('/etag-body/products/:id/summary', async (req, reply) => {
  const body = JSON.stringify(await loadSummary(Number(req.params.id)));
  const etag = etagOf(body);
  reply.header('etag', etag).header('cache-control', 'no-cache');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.type('application/json').send(body);
});

// C3b: ETag a partir de la versión del producto (una lectura por clave primaria). Si coincide, no hay consulta costosa.
app.get('/etag-version/products/:id/summary', async (req, reply) => {
  const id = Number(req.params.id);
  const version = await productVersion(id);
  const etag = `"p${id}-v${version}"`;
  reply.header('etag', etag).header('cache-control', 'no-cache');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  return reply.type('application/json').send(JSON.stringify(await loadSummary(id)));
});

// C4, C5, C6, C7: cache-aside en Redis o en Valkey.
app.get('/cache/:store/products/:id/summary', async (req, reply) => {
  const store = stores[req.params.store];
  if (!store) return reply.code(404).send({ error: 'store' });
  const value = await cached(store, Number(req.params.id), options(req.query, req.params.store));
  return reply.type('application/json').send(JSON.stringify(value));
});

// C7: escribir un pedido. ?invalidate=redis borra la clave del resumen DESPUÉS del commit; ?redelete=ms la vuelve a borrar.
app.post('/products/:id/orders', async (req) => {
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    stats.writeQueries += 1;
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO orders (product_id, customer_id, amount, created_at, note) VALUES ($1, 1, 1, now(), 'demo-c7')`,
      [id],
    );
    await client.query('UPDATE products SET version = version + 1 WHERE id = $1', [id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  const store = stores[req.query.invalidate];
  if (store) {
    await store.del(key(id));
    // Doble borrado: repetir el DEL más tarde elimina el valor viejo que una lectura lenta en vuelo pudo dejar.
    const again = Number(req.query.redelete ?? 0);
    if (again > 0) setTimeout(() => store.del(key(id)).catch(() => {}), again);
  }
  return { ok: true };
});

// C8: rate limiting por cliente (10 peticiones por segundo). Cada algoritmo es un script Lua: atómico en el servidor.
const LIMIT = 10;
const WINDOW_MS = 1000;
const FIXED_LUA = `
  local n = redis.call('INCR', KEYS[1])
  if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
  return n`;
const SLIDING_LUA = `
  local now = tonumber(ARGV[1]); local window = tonumber(ARGV[2]); local limit = tonumber(ARGV[3])
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
  if redis.call('ZCARD', KEYS[1]) < limit then
    redis.call('ZADD', KEYS[1], now, ARGV[4])
    redis.call('PEXPIRE', KEYS[1], window)
    return 1
  end
  return 0`;
app.get('/limited/:algo', async (req, reply) => {
  const client = req.query.client ?? 'anon';
  const r = stores[req.query.store ?? 'redis'];
  const now = Date.now();
  let allowed;
  if (req.params.algo === 'fixed') {
    const n = await r.eval(FIXED_LUA, 1, `rl:fixed:${client}:${Math.floor(now / WINDOW_MS)}`, WINDOW_MS);
    allowed = n <= LIMIT;
  } else {
    allowed = (await r.eval(SLIDING_LUA, 1, `rl:sliding:${client}`, now, WINDOW_MS, LIMIT, randomUUID())) === 1;
  }
  if (!allowed) return reply.code(429).send({ error: 'demasiadas peticiones' });
  return { ok: true };
});

await app.listen({ host: '127.0.0.1', port: PORT });
console.log(`API en http://127.0.0.1:${PORT}`);
