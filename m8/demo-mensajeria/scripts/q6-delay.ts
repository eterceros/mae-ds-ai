// Q6: reintento con retardo. Tres formas en RabbitMQ 4.4:
//  A) retardo nativo de quorum queue (desde 4.3): argumentos x-delayed-retry-type/min/max;
//     el consumidor hace basic.reject(requeue=true) y la cola retiene el mensaje min*delivery_count ms.
//  B) cabecera x-opt-delivery-time (4.4): el consumidor confirma el original y republica una copia
//     con "no entregar antes de <epoch ms>"; la cola quorum la guarda y la entrega al llegar la hora.
//  C) clásico DLX + TTL: una cola de espera por nivel (1 s, 2 s, 3 s) sin consumidores; al vencer el
//     TTL, el mensaje se "muere" y su DLX lo devuelve a la cola principal.
// Cada mensaje falla 3 veces y la 4.ª funciona; se mide el retardo real entre intentos.
// Al final, la prueba de "cabeza de cola": un mensaje de 5 s delante de uno de 1 s.
import type { Channel, ConsumeMessage } from 'amqplib';
import { connect } from '../src/lib/amqp.ts';
import { environment, writeResult, makePool, sleep, median } from './lib/harness.ts';

const MSGS = 20;
const FAILS = 3;
const BASE = 1000; // ms; retardo planificado del intento n = BASE * n

type Rec = { id: number; t: number[] };

async function freshQueue(ch: Channel, name: string, args: Record<string, unknown>) {
  await ch.deleteQueue(name);
  await ch.assertQueue(name, { durable: true, arguments: args });
}

async function scenario(kind: 'native' | 'delivery-time' | 'dlx-ttl') {
  const conn = await connect();
  const ch = await conn.createConfirmChannel();
  const main = `q6.${kind}`;
  if (kind === 'native') {
    await freshQueue(ch, main, {
      'x-queue-type': 'quorum', 'x-delivery-limit': 10,
      'x-delayed-retry-type': 'failed', 'x-delayed-retry-min': BASE, 'x-delayed-retry-max': 10 * BASE,
    });
  } else {
    await freshQueue(ch, main, { 'x-queue-type': 'quorum' });
  }
  if (kind === 'dlx-ttl') {
    for (let n = 1; n <= FAILS; n++) {
      // Cola de espera: TTL fijo por cola y, al vencer, de vuelta a la principal por el exchange por defecto.
      await freshQueue(ch, `${main}.wait.${n}`, {
        'x-queue-type': 'quorum', 'x-message-ttl': BASE * n,
        'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': main,
        'x-dead-letter-strategy': 'at-least-once', 'x-overflow': 'reject-publish',
      });
    }
  }
  const recs = new Map<number, Rec>();
  let done = 0;
  await ch.prefetch(50);
  const { consumerTag } = await ch.consume(main, (m: ConsumeMessage | null) => {
    if (!m) return;
    const body = JSON.parse(m.content.toString()) as { id: number };
    const rec = recs.get(body.id) ?? { id: body.id, t: [] };
    recs.set(body.id, rec);
    rec.t.push(Date.now());
    const attempt = rec.t.length;
    if (attempt > FAILS) { ch.ack(m); done++; return; }
    if (kind === 'native') {
      ch.reject(m, true);                    // reject sí incrementa delivery-count (nack no; ver Q5)
    } else if (kind === 'delivery-time') {
      ch.publish('', main, m.content, {
        persistent: true,
        headers: { 'x-opt-delivery-time': { '!': 'long', value: Date.now() + BASE * attempt }, 'x-attempt': attempt },
      });
      ch.waitForConfirms().then(() => ch.ack(m));   // ack del original solo cuando la copia está guardada
    } else {
      ch.publish('', `${main}.wait.${attempt}`, m.content, { persistent: true, headers: { 'x-attempt': attempt } });
      ch.waitForConfirms().then(() => ch.ack(m));
    }
  });
  for (let id = 1; id <= MSGS; id++) ch.sendToQueue(main, Buffer.from(JSON.stringify({ id })), { persistent: true });
  const t0 = Date.now();
  while (done < MSGS && Date.now() - t0 < 30_000) await sleep(50);
  await ch.cancel(consumerTag);
  await ch.deleteQueue(main);
  if (kind === 'dlx-ttl') for (let n = 1; n <= FAILS; n++) await ch.deleteQueue(`${main}.wait.${n}`);
  await ch.close(); await conn.close();
  // Error = retardo real - planificado, por intento.
  const perAttempt: { planned: number; med: number; max: number; min: number }[] = [];
  for (let n = 1; n <= FAILS; n++) {
    const d = [...recs.values()].filter((r) => r.t.length > n).map((r) => r.t[n] - r.t[n - 1]);
    perAttempt.push({ planned: BASE * n, med: median(d), min: Math.min(...d), max: Math.max(...d) });
  }
  return { kind, done, perAttempt };
}

// Cabeza de cola: A (5 s) se encola antes que B (1 s). ¿Cuándo sale B?
async function headOfLine(kind: 'per-message-ttl-classic' | 'per-message-ttl-quorum' | 'delivery-time') {
  const conn = await connect();
  const ch = await conn.createConfirmChannel();
  const target = `q6.hol.${kind}.target`, wait = `q6.hol.${kind}.wait`;
  await freshQueue(ch, target, { 'x-queue-type': 'quorum' });
  const seen: Record<string, number> = {};
  const t0 = Date.now();
  if (kind === 'delivery-time') {
    ch.publish('', target, Buffer.from('A'), { headers: { 'x-opt-delivery-time': { '!': 'long', value: t0 + 5000 } } });
    ch.publish('', target, Buffer.from('B'), { headers: { 'x-opt-delivery-time': { '!': 'long', value: t0 + 1000 } } });
  } else {
    await freshQueue(ch, wait, {
      ...(kind === 'per-message-ttl-quorum' ? { 'x-queue-type': 'quorum' } : {}),
      'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': target,
    });
    // TTL por mensaje (propiedad expiration) en UNA sola cola de espera.
    ch.publish('', wait, Buffer.from('A'), { expiration: '5000' });
    ch.publish('', wait, Buffer.from('B'), { expiration: '1000' });
  }
  await ch.waitForConfirms();
  await ch.consume(target, (m) => { if (m) { seen[m.content.toString()] = Date.now() - t0; ch.ack(m); } });
  while (Object.keys(seen).length < 2 && Date.now() - t0 < 15000) await sleep(20);
  await ch.deleteQueue(target); await ch.deleteQueue(wait);
  await ch.close(); await conn.close();
  return { kind, A: seen.A ?? null, B: seen.B ?? null };
}

const pool = makePool(1);
const env = await environment(pool); await pool.end();
const res: Awaited<ReturnType<typeof scenario>>[] = [];
for (const k of ['native', 'delivery-time', 'dlx-ttl'] as const) for (let r = 0; r < 3; r++) { const x = await scenario(k); console.log(JSON.stringify(x)); res.push(x); }
const hol: Awaited<ReturnType<typeof headOfLine>>[] = [];
for (const k of ['per-message-ttl-classic', 'per-message-ttl-quorum', 'delivery-time'] as const) for (let r = 0; r < 3; r++) { const x = await headOfLine(k); console.log(JSON.stringify(x)); hol.push(x); }

const label = { native: 'A) nativo: `x-delayed-retry-*` + `reject(requeue)`', 'delivery-time': 'B) `x-opt-delivery-time` al republicar', 'dlx-ttl': 'C) DLX + TTL (3 colas de espera)' };
let md = `# Q6. Reintento con retardo: nativo de RabbitMQ 4.4 frente a DLX + TTL

Medido el ${new Date().toISOString().slice(0, 10)}. ${env}

${MSGS} mensajes; cada uno falla ${FAILS} veces y el intento ${FAILS + 1} funciona. Retardo planificado antes del intento n+1: ${BASE} ms × n (1 s, 2 s, 3 s). Se mide el tiempo real entre intentos del mismo mensaje. 3 corridas por variante (las cifras juntan los ${MSGS} mensajes de cada corrida: mediana [mín-máx] en ms).

| Variante | Corrida | Terminados | Intento 1→2 (plan 1000) | 2→3 (plan 2000) | 3→4 (plan 3000) |
|---|---:|---:|---:|---:|---:|
`;
const runs: Record<string, number> = {};
for (const r of res) {
  runs[r.kind] = (runs[r.kind] ?? 0) + 1;
  md += `| ${label[r.kind]} | ${runs[r.kind]} | ${r.done}/${MSGS} | ${r.perAttempt.map((p) => `${p.med} [${p.min}-${p.max}]`).join(' | ')} |\n`;
}
md += `
**Cabeza de cola.** Se encola A con retardo de 5 s y, detrás, B con 1 s. Momento (ms desde el envío) en que cada uno llega al consumidor:

| Mecanismo | A (plan 5000) | B (plan 1000) |
|---|---:|---:|
`;
const hl = { 'per-message-ttl-classic': 'TTL por mensaje (`expiration`) en una cola classic de espera', 'per-message-ttl-quorum': 'TTL por mensaje en una cola quorum de espera', 'delivery-time': '`x-opt-delivery-time` en la cola quorum' };
for (const h of hol) md += `| ${hl[h.kind]} | ${h.A ?? 'no llegó'} | ${h.B ?? 'no llegó'} |\n`;
md += `
Lectura: ver la sección Q6 de [ESCENARIOS.md](ESCENARIOS.md).
`;
writeResult('Q6_RETARDO.md', md);
process.exit(0);
