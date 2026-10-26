// Piezas comunes de los scripts de medición: lanzar y parar procesos, esperar a que respondan,
// medianas, descripción del entorno y escritura de resultados.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import type pg from 'pg';
import { sleep } from '../../src/lib/config.ts';

export { sleep };

export class Proc {
  child: ChildProcess;
  log: string[] = [];
  constructor(file: string, env: Record<string, string> = {}, args: string[] = []) {
    this.child = spawn(process.execPath, ['--no-warnings', file, ...args], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) this.log.push(l.trimEnd()); };
    this.child.stdout!.on('data', keep);
    this.child.stderr!.on('data', keep);
  }
  exited() {
    return this.child.exitCode !== null ? Promise.resolve(this.child.exitCode) : new Promise<number | null>((r) => this.child.once('exit', r));
  }
  async stop() {
    if (this.child.exitCode === null) { const d = this.exited(); this.child.kill(); await d; }
  }
  result<T = any>(): T | undefined {
    const l = this.log.find((x) => x.startsWith('RESULT '));
    return l ? JSON.parse(l.slice(7)) : undefined;
  }
}

// Ejecuta un script de Node hasta que termina y devuelve su línea RESULT (y el log).
export async function runToEnd(file: string, env: Record<string, string> = {}, args: string[] = []) {
  const p = new Proc(file, env, args);
  const code = await p.exited();
  return { code, result: p.result(), log: p.log };
}

export async function waitHttp(url: string, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* todavía no */ }
    await sleep(100);
  }
  throw new Error(`no responde: ${url}`);
}

export const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN;
};

export const range = (xs: number[], digits = 0) => {
  const f = (x: number) => x.toFixed(digits);
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? '—' : s[0] === s[s.length - 1] ? f(s[0]) : `${f(s[0])}-${f(s[s.length - 1])}`;
};

export async function environment(pool: pg.Pool) {
  const pgv = (await pool.query('SELECT version()')).rows[0].version.split(' on ')[0];
  let docker = process.env.DOCKER_INFO ?? '';
  if (!docker) try {
    docker = execFileSync('docker', ['version', '--format', 'motor {{.Server.Version}}'], { encoding: 'utf8' }).trim();
    docker += ', Compose ' + execFileSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8' }).trim();
  } catch { docker = 'Docker (versión no disponible)'; }
  const cpu = os.cpus()[0].model.trim();
  const where = process.env.DOCKER_INFO ? 'Los procesos de Node corren en un contenedor de la misma red de Compose que Postgres' : 'Los procesos de Node corren en el anfitrión';
  return `Máquina: ${cpu}, ${os.cpus().length} hilos lógicos, ${Math.round(os.totalmem() / 2 ** 30)} GB de RAM visibles, ` +
    `${os.type()} ${os.release()}, Node ${process.version}. ${where}. Docker Desktop con WSL2 (${docker}); ${pgv}.`;
}

// SMOKE=1: corrida corta de comprobación; no pisa los resultados de referencia.
export function writeResult(file: string, md: string) {
  const dir = process.env.SMOKE ? 'results/raw/' : 'results/';
  const name = process.env.SMOKE ? `smoke-${file}` : file;
  mkdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true });
  writeFileSync(new URL(`../../${dir}${name}`, import.meta.url), md);
  console.log(`\n-> ${dir}${name}`);
}

export const today = () => new Date().toISOString().slice(0, 10);
