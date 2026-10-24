// Piezas comunes de los scripts de medición: reiniciar base y colas, supervisar procesos
// (los reinicia cuando mueren, como haría un orquestador), contar mensajes y escribir resultados.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import type pg from 'pg';
import { makePool, SCHEMA } from '../../src/lib/db.ts';
import { connect, assertTopology, Q_AUDIT, Q_SHIPPING, Q_SHIPPING_DLQ, EXCHANGE } from '../../src/lib/amqp.ts';
import { MGMT_URL, sleep } from '../../src/lib/config.ts';

export { sleep };

export async function resetAll(pool: pg.Pool, extraQueues: string[] = []) {
  await pool.query(SCHEMA);
  const conn = await connect();
  const ch = await conn.createChannel();
  for (const q of [Q_AUDIT, Q_SHIPPING, Q_SHIPPING_DLQ, ...extraQueues]) await ch.deleteQueue(q);
  await ch.deleteExchange(EXCHANGE); await ch.deleteExchange(`${EXCHANGE}.dlx`);  // las colas de E4 (summaries.*) no se tocan: Q7 tiene las suyas
  await assertTopology(ch);
  await ch.close(); await conn.close();
}

// Proceso supervisado: si muere (p. ej. por el crash inyectado), se vuelve a lanzar.
export class Supervised {
  child: ChildProcess | null = null;
  restarts = 0;
  private stopped = false;
  log: string[] = [];
  file: string; env: Record<string, string>; name: string;
  constructor(file: string, env: Record<string, string>, name: string) { this.file = file; this.env = env; this.name = name; }
  start() {
    this.child = spawn(process.execPath, ['--no-warnings', this.file], {
      env: { ...process.env, ...this.env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) this.log.push(l); };
    this.child.stdout!.on('data', keep);
    this.child.stderr!.on('data', keep);
    this.child.on('exit', () => {
      if (this.stopped) return;
      this.restarts++;
      setTimeout(() => this.start(), 100);
    });
    return this;
  }
  async stop() {
    this.stopped = true;
    if (this.child && this.child.exitCode === null) {
      const done = new Promise((r) => this.child!.once('exit', r));
      this.child.kill();
      await done;
    }
  }
  get crashes() { return this.log.filter((l) => l.startsWith('[crash]')).length; }
}

export async function waitHttp(url: string, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* todavía no */ }
    await sleep(100);
  }
  throw new Error(`no responde: ${url}`);
}

// Vacía una cola y devuelve los mensajes (para contar). Termina tras `idleMs` sin mensajes.
export async function drainQueue(queue: string, idleMs = 1500) {
  const conn = await connect();
  const ch = await conn.createChannel();
  await ch.prefetch(500);
  const msgs: { body: any; headers: Record<string, any>; redelivered: boolean }[] = [];
  let last = Date.now();
  const { consumerTag } = await ch.consume(queue, (m) => {
    if (!m) return;
    msgs.push({ body: JSON.parse(m.content.toString()), headers: m.properties.headers ?? {}, redelivered: m.fields.redelivered });
    last = Date.now();
    ch.ack(m);
  });
  while (Date.now() - last < idleMs) await sleep(100);
  await ch.cancel(consumerTag);
  await ch.close(); await conn.close();
  return msgs;
}

export async function queueInfo(name: string) {
  const r = await fetch(`${MGMT_URL}/api/queues/%2F/${encodeURIComponent(name)}`, {
    headers: { authorization: 'Basic ' + Buffer.from('demo:demo').toString('base64') },
  });
  return r.json() as Promise<any>;
}

export async function environment(pool: pg.Pool) {
  const pgv = (await pool.query('SELECT version()')).rows[0].version.split(' on ')[0];
  const ov = await (await fetch(`${MGMT_URL}/api/overview`, {
    headers: { authorization: 'Basic ' + Buffer.from('demo:demo').toString('base64') },
  })).json() as any;
  const cpu = os.cpus()[0].model.trim();
  return `Máquina: ${cpu}, ${os.cpus().length} hilos lógicos, ${Math.round(os.totalmem() / 2 ** 30)} GB de RAM, ` +
    `${os.type()} ${os.release()}, Node ${process.version}. Servidores (Docker Desktop, WSL2): ${pgv}; ` +
    `RabbitMQ ${ov.rabbitmq_version} (Erlang ${ov.erlang_version}).`;
}

// SMOKE=1: corrida corta de comprobación; no pisa los resultados de referencia.
export function writeResult(file: string, md: string) {
  const dir = process.env.SMOKE ? 'results/raw/' : 'results/';
  const name = process.env.SMOKE ? `smoke-${file}` : file;
  mkdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true });
  writeFileSync(new URL(`../../${dir}${name}`, import.meta.url), md);
  console.log(`\n-> ${dir}${name}`);
}

export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};

export { makePool };
