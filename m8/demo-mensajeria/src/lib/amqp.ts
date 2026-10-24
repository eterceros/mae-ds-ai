import amqp from 'amqplib';
import { AMQP_URL } from './config.ts';

export const EXCHANGE = 'orders';                    // exchange tipo topic
export const RK_ORDER_CREATED = 'order.created';     // clave de enrutamiento del evento
export const Q_SHIPPING = 'orders.created.shipping'; // la consume el worker de envíos
export const Q_AUDIT = 'orders.created.audit';       // copia de cada evento: la usan los scripts para contar
export const Q_SHIPPING_DLQ = 'orders.created.shipping.dlq';

export const EX_SUMMARIES = 'summaries';
export const Q_SUMMARIES = 'summaries.requested';
export const Q_SUMMARIES_DLQ = 'summaries.requested.dlq';

export async function connect() {
  // heartbeat corto (parámetro de la URL): si el proceso se cuelga, RabbitMQ lo nota en ~20 s.
  // Si el proceso muere, el sistema operativo cierra el socket y RabbitMQ lo nota al instante.
  return amqp.connect(AMQP_URL.includes('?') ? AMQP_URL : `${AMQP_URL}?heartbeat=10`);
}

// Declara la topología. Es idempotente: declarar lo mismo dos veces no cambia nada.
export async function assertTopology(ch: amqp.Channel) {
  await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
  await ch.assertExchange(`${EXCHANGE}.dlx`, 'fanout', { durable: true });
  await ch.assertQueue(Q_SHIPPING_DLQ, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(Q_SHIPPING_DLQ, `${EXCHANGE}.dlx`, '');
  // quorum queue: replicada con Raft (aquí un solo nodo), durable, con contador de entregas.
  // x-delivery-limit + DLX: tras 5 fallos contados (reject, no nack; ver Q5) el mensaje va a la DLQ.
  await ch.assertQueue(Q_SHIPPING, { durable: true, arguments: {
    'x-queue-type': 'quorum', 'x-delivery-limit': 5, 'x-dead-letter-exchange': `${EXCHANGE}.dlx` } });
  await ch.bindQueue(Q_SHIPPING, EXCHANGE, RK_ORDER_CREATED);
  await ch.assertQueue(Q_AUDIT, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(Q_AUDIT, EXCHANGE, RK_ORDER_CREATED);

  await ch.assertExchange(EX_SUMMARIES, 'direct', { durable: true });
  await ch.assertExchange(`${EX_SUMMARIES}.dlx`, 'direct', { durable: true });
  await ch.assertQueue(Q_SUMMARIES_DLQ, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await ch.bindQueue(Q_SUMMARIES_DLQ, `${EX_SUMMARIES}.dlx`, 'summary.requested');
  await ch.assertQueue(Q_SUMMARIES, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-delivery-limit': 5,                         // tras 5 fallos, a la DLQ
      'x-dead-letter-exchange': `${EX_SUMMARIES}.dlx`,
    },
  });
  await ch.bindQueue(Q_SUMMARIES, EX_SUMMARIES, 'summary.requested');
}

// Publica y espera la confirmación del broker (publisher confirm): solo entonces el mensaje
// está escrito en la cola. Sin esto, "publish" solo significa "lo puse en el socket".
export function publishConfirmed(
  ch: amqp.ConfirmChannel, exchange: string, rk: string, body: unknown, opts: amqp.Options.Publish,
): Promise<void> {
  return new Promise((resolve, reject) => {
    ch.publish(exchange, rk, Buffer.from(JSON.stringify(body)), {
      persistent: true, contentType: 'application/json', ...opts,
    }, (err) => (err ? reject(err) : resolve()));
  });
}
