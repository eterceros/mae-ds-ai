// Worker de confirmaciones, versión DESPUÉS. La instrumentación de amqplib lee el contexto de las
// cabeceras del mensaje y abre un span "process" hijo del "publish": la traza sigue sola.
import { assertTopology, connect } from '../lib/amqp.js';
import { QUEUE, WORK_MS } from '../lib/config.js';
import { log } from '../lib/log.js';

const ch = await (await connect()).createChannel();
await assertTopology(ch);
await ch.prefetch(10);
await ch.consume(QUEUE, async (msg) => {
  if (!msg) return;
  const pedido = JSON.parse(msg.content.toString());
  await new Promise((r) => setTimeout(r, WORK_MS)); // "enviar el correo de confirmación"
  // CORRECCIÓN: ya no se lee msg.properties.headers.traceparent a mano; el span activo es el del
  // mensaje y pino agrega su trace_id a esta línea (OC).
  log.info({ pedido: pedido.id }, 'pedido confirmado');
  ch.ack(msg);
});
log.info({ queue: QUEUE }, 'worker (despues) consumiendo');
process.on('SIGTERM', async () => { await ch.close(); process.exit(0); });
