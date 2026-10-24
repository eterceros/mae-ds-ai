// Q5: mensaje venenoso (siempre falla) entre 50 mensajes buenos. ¿Cuántas veces se intenta,
// termina en la DLQ, bloquea a los demás? Se prueban cuatro formas de decir "falló" en AMQP 0-9-1.
import type { Channel, ConsumeMessage, GetMessage } from 'amqplib';
import { connect } from '../src/lib/amqp.ts';
import { environment, writeResult, makePool, sleep } from './lib/harness.ts';

const GOOD = 50;
const WATCH_MS = 10_000;
const DELIVERY_LIMIT = 3;

type Variant = { id: string; label: string; queueType: 'quorum' | 'classic'; fail: (ch: Channel, m: ConsumeMessage) => void };
const variants: Variant[] = [
  { id: 'reject-requeue', label: 'quorum, `basic.reject(requeue=true)`', queueType: 'quorum', fail: (ch, m) => ch.reject(m, true) },
  { id: 'nack-requeue', label: 'quorum, `basic.nack(requeue=true)`', queueType: 'quorum', fail: (ch, m) => ch.nack(m, false, true) },
  { id: 'nack-norequeue', label: 'quorum, `basic.nack(requeue=false)`', queueType: 'quorum', fail: (ch, m) => ch.nack(m, false, false) },
  { id: 'classic-nack-requeue', label: 'classic, `basic.nack(requeue=true)`', queueType: 'classic', fail: (ch, m) => ch.nack(m, false, true) },
];

async function run(v: Variant) {
  const conn = await connect();
  const ch = await conn.createChannel();
  const q = `q5.${v.id}`, dlx = `q5.${v.id}.dlx`, dlq = `q5.${v.id}.dlq`;
  await ch.deleteQueue(q); await ch.deleteQueue(dlq);
  await ch.assertExchange(dlx, 'fanout', { durable: true });
  await ch.assertQueue(dlq, { durable: true });
  await ch.bindQueue(dlq, dlx, '');
  const args: Record<string, unknown> = { 'x-dead-letter-exchange': dlx };
  if (v.queueType === 'quorum') { args['x-queue-type'] = 'quorum'; args['x-delivery-limit'] = DELIVERY_LIMIT; }
  await ch.assertQueue(q, { durable: true, arguments: args });
  for (let i = 1; i <= GOOD; i++) {
    ch.sendToQueue(q, Buffer.from(JSON.stringify({ i })), { persistent: true });
    if (i === GOOD / 2) ch.sendToQueue(q, Buffer.from('{esto no es JSON'), { persistent: true, messageId: 'poison' });
  }
  await sleep(300);

  let attempts = 0, goodDone = 0, lastGoodAt = 0;
  const deliveryCounts: (number | null)[] = [];
  const t0 = Date.now();
  await ch.prefetch(10);
  const { consumerTag } = await ch.consume(q, (m) => {
    if (!m) return;
    try {
      JSON.parse(m.content.toString());  // el "procesamiento": el venenoso lanza aquí
      goodDone++; lastGoodAt = Date.now() - t0;
      ch.ack(m);
    } catch {
      attempts++;
      if (deliveryCounts.length < 8) deliveryCounts.push((m.properties.headers?.['x-delivery-count'] as number) ?? null);
      v.fail(ch, m);
    }
  });
  // Observar hasta WATCH_MS o hasta que el venenoso aparezca en la DLQ.
  let dead: GetMessage | false = false; let deadAt: number | null = null;
  while (Date.now() - t0 < WATCH_MS) {
    dead = await ch.get(dlq, { noAck: true });
    if (dead) { deadAt = Date.now() - t0; break; }
    await sleep(50);
  }
  await ch.cancel(consumerTag);
  const death = dead ? (dead.properties.headers?.['x-first-death-reason'] ?? dead.properties.headers?.['x-death']?.[0]?.reason) : null;
  await ch.deleteQueue(q); await ch.deleteQueue(dlq); await ch.deleteExchange(dlx);
  await ch.close(); await conn.close();
  return { ...v, attempts, goodDone, lastGoodAt, inDlq: !!dead, deadAt, death, deliveryCounts };
}

const pool = makePool(1);
const env = await environment(pool); await pool.end();
const res = [];
for (const v of variants) for (let r = 1; r <= 3; r++) { const x = await run(v); console.log(JSON.stringify({ ...x, fail: undefined })); res.push({ ...x, run: r }); }

let md = `# Q5. Mensaje venenoso y DLQ

Medido el ${new Date().toISOString().slice(0, 10)}. ${env}

${GOOD} mensajes buenos y 1 venenoso (cuerpo que no es JSON) en la posición ${GOOD / 2 + 1}. Consumidor con prefetch 10 y ack manual; ante un fallo responde con la operación de la fila. Colas quorum con \`x-delivery-limit: ${DELIVERY_LIMIT}\` y \`x-dead-letter-exchange\`; la classic solo con DLX (las classic no tienen límite de entregas). Se observa ${WATCH_MS / 1000} s o hasta que el venenoso llega a la DLQ. 3 corridas por variante.

| Variante | Corrida | Intentos del venenoso | ¿Llegó a la DLQ? | Tiempo hasta la DLQ (ms) | Motivo (\`x-first-death-reason\`) | Buenos procesados | \`x-delivery-count\` visto en cada intento |
|---|---:|---:|---|---:|---|---:|---|
`;
for (const r of res) md += `| ${r.label} | ${r.run} | **${r.attempts}** | ${r.inDlq ? 'sí' : `no (en ${WATCH_MS / 1000} s)`} | ${r.deadAt ?? '-'} | ${r.death ?? '-'} | ${r.goodDone} / ${GOOD} | ${r.deliveryCounts.map((x) => x ?? '∅').join(', ')}${r.attempts > r.deliveryCounts.length ? ', …' : ''} |\n`;
md += `
Lectura: ver la sección Q5 de [ESCENARIOS.md](ESCENARIOS.md).
`;
writeResult('Q5_VENENOSO.md', md);
process.exit(0);
