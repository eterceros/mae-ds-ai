import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RESULTS = join(ROOT, 'results');
export const RAW = join(RESULTS, 'raw');
mkdirSync(RAW, { recursive: true });

export const SMOKE = process.env.SMOKE === '1';
export const RUNS = Number(process.env.RUNS ?? (SMOKE ? 1 : 3));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const LOKI = process.env.LOKI_URL ?? 'http://127.0.0.1:18534';

export const INSTRUMENTADO =
  '--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register';

// docker compose con el proyecto de esta carpeta; MSYS_NO_PATHCONV evita que Git Bash reescriba /rutas.
export function compose(args: string[], env: Record<string, string> = {}, quiet = true): string {
  const r = spawnSync('docker', ['compose', ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1', ...env }, maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`docker compose ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  if (!quiet) process.stdout.write(r.stdout + r.stderr);
  return r.stdout;
}

// Levanta (o recrea) los servicios "antes" con o sin la auto-instrumentación.
export function antes(instrumentado: boolean) {
  compose(['up', '-d', '--wait'], { ANTES_NODE_OPTIONS: instrumentado ? INSTRUMENTADO : '' });
}

export function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const i = (p / 100) * (s.length - 1); // interpolación lineal, como k6
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
export const median = (xs: number[]) => pct(xs, 50);
export const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
export const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '—');

export type Req = { traceId: string; ms: number; status: number; t: number };

// Corre k6 y devuelve cada petición (duración, estado, trace-id) leída de la salida JSON de k6.
export function k6(name: string, baseUrl: string, env: Record<string, string>) {
  const args = ['--profile', 'load', 'run', '--rm', '-e', `BASE_URL=${baseUrl}`, 'k6', 'run', '--quiet',
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '--summary-export', `/out/${name}-summary.json`, '--out', `json=/out/${name}.json.gz`, '/scripts/pedidos.js'];
  const t0 = Date.now() / 1000;
  compose(args);
  const t1 = Date.now() / 1000;
  const reqs: Req[] = [];
  for (const line of gunzipSync(readFileSync(join(RAW, `${name}.json.gz`))).toString('utf8').split('\n')) {
    if (!line.startsWith('{"metric":"http_req_duration"') && !line.startsWith('{"metric":"http_reqs"')) continue;
    const j = JSON.parse(line);
    if (j.type !== 'Point') continue;
    if (j.metric === 'http_req_duration') {
      reqs.push({ traceId: j.data.tags.trace_id, ms: j.data.value, status: Number(j.data.tags.status), t: Date.parse(j.data.time) / 1000 });
    }
  }
  const summary = JSON.parse(readFileSync(join(RAW, `${name}-summary.json`), 'utf8'));
  return { reqs, summary, t0, t1 };
}

export function save(file: string, text: string) {
  writeFileSync(join(SMOKE ? RAW : RESULTS, SMOKE ? `smoke-${file}` : file), text);
  console.log(`-> ${SMOKE ? 'results/raw/smoke-' : 'results/'}${file}`);
}
export function saveRaw(file: string, text: string) { writeFileSync(join(RAW, file), text); }

export function entorno(): string {
  const v = (cmd: string, args: string[]) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return '?'; } };
  return `Docker ${v('docker', ['version', '--format', '{{.Server.Version}}'])}, Compose ${v('docker', ['compose', 'version', '--short'])}; ` +
    `${v('docker', ['info', '--format', '{{.NCPU}} CPU y {{.MemTotal}} B de RAM en la VM'])}`;
}
