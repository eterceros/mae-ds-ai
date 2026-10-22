// Utilidades comunes de los scripts de medición: levantar las instancias de la API, un cliente HTTP con
// keep-alive (node:http, no fetch: fetch suma latencia en Windows, ver la demo de S05), una distribución Zipf
// reproducible para elegir productos, y la suma de /stats de todas las instancias.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { API_PORTS } from './env.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const agent = new http.Agent({ keepAlive: true, maxSockets: Infinity });

// Devuelve { status, bytes (cuerpo), body (texto), etag }.
export function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, agent, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode >= 500) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve({ status: res.statusCode, bytes: buf.length, body: buf.toString(), etag: res.headers.etag });
      });
    });
    req.on('error', reject);
    req.end();
  });
}
export const getJson = async (port, path) => JSON.parse((await request(port, path)).body);
export const post = (port, path) => request(port, path, { method: 'POST' });

export async function startApis(n = 1, extraEnv = {}) {
  const ports = API_PORTS.slice(0, n);
  for (const port of ports) {
    try {
      await request(port, '/stats');
      throw new Error(`El puerto ${port} ya está en uso: pare ese proceso o cambie API_PORTS.`);
    } catch (e) {
      if (e.message.startsWith('El puerto')) throw e;
    }
  }
  const procs = ports.map((port) =>
    spawn(process.execPath, ['src/server.mjs'], { cwd: root, env: { ...process.env, ...extraEnv, PORT: String(port) }, stdio: 'ignore' }),
  );
  const stop = () => procs.forEach((p) => p.kill());
  process.on('exit', stop);
  for (const port of ports) {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      try {
        up = (await request(port, '/stats')).status === 200;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!up) throw new Error(`la API no arrancó en ${port}`);
  }
  return { ports, stop };
}

export async function sumStats(ports) {
  const all = await Promise.all(ports.map((p) => getJson(p, '/stats')));
  const total = {};
  for (const s of all) for (const [k, v] of Object.entries(s)) total[k] = (total[k] ?? 0) + v;
  return total;
}
export const resetStats = (ports) => Promise.all(ports.map((p) => post(p, '/stats/reset')));

// Generador pseudoaleatorio con semilla (mulberry32): mismas secuencias en cada corrida.
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Zipf sobre 1..n con exponente s: unos pocos productos reciben casi todo el tráfico (como en una tienda real).
export function zipf(n, s = 1, seed = 42) {
  const cdf = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) cdf[i] = acc += 1 / Math.pow(i + 1, s);
  for (let i = 0; i < n; i++) cdf[i] /= acc;
  const rand = rng(seed);
  return () => {
    const u = rand();
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
export const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
export const f0 = (n) => (Number.isFinite(n) ? Math.round(n).toString() : '-');
export const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? f1(xs[0]) : `${f1(Math.min(...xs))}–${f1(Math.max(...xs))}`);

export function machine() {
  let cpu = os.cpus()[0]?.model?.trim() ?? '?';
  let versions = '';
  try {
    versions = execSync(
      'docker compose exec -T postgres postgres --version && docker compose exec -T redis redis-server --version && docker compose exec -T valkey valkey-server --version',
      { cwd: root, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean)
      .map((l) => l.replace(/ sha=.*$/, ''))
      .join('; ');
  } catch {}
  return `${cpu}, ${os.cpus().length} hilos lógicos, ${Math.round(os.totalmem() / 2 ** 30)} GB de RAM, ${os.type()} ${os.release()}, Node ${process.version}. Servidores: ${versions}`;
}

export function writer() {
  const lines = [];
  const out = (s = '') => {
    console.log(s);
    lines.push(s);
  };
  return { out, text: () => lines.join('\n') + '\n' };
}
