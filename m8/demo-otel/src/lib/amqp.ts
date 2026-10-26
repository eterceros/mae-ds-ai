import amqp from 'amqplib';
import { AMQP_URL, QUEUE } from './config.js';

export async function connect() {
  for (let i = 1; ; i++) { // reintenta mientras RabbitMQ termina de arrancar
    try {
      return await amqp.connect(`${AMQP_URL}?heartbeat=10`);
    } catch (err) {
      if (i >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export async function assertTopology(ch: amqp.Channel) {
  await ch.assertQueue(QUEUE, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
}

// Publica en la cola y espera la confirmación del broker (publisher confirm, visto en la S08).
export function sendConfirmed(ch: amqp.ConfirmChannel, body: unknown, headers: Record<string, unknown>) {
  return new Promise<void>((ok, mal) => ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(body)),
    { persistent: true, contentType: 'application/json', headers }, (err) => (err ? mal(err) : ok())));
}
