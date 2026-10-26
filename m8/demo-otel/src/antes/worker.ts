// Worker de confirmaciones, versión ANTES: lee el traceparent de la cabecera a mano (S08) y lo escribe
// en un log de texto.
import { assertTopology, connect } from '../lib/amqp.js';
import { QUEUE, WORK_MS } from '../lib/config.js';
import { traceIdOf } from '../lib/trace.js';

const ch = await (await connect()).createChannel();
await assertTopology(ch);
await ch.prefetch(10);
await ch.consume(QUEUE, async (msg) => {
  if (!msg) return;
  const pedido = JSON.parse(msg.content.toString());
  await new Promise((r) => setTimeout(r, WORK_MS)); // "enviar el correo de confirmación"
  console.log(`confirmado pedido ${pedido.id} (trace ${traceIdOf(msg.properties.headers?.traceparent)})`);
  ch.ack(msg);
});
console.log(`worker (antes) consumiendo ${QUEUE}`);
process.on('SIGTERM', async () => { await ch.close(); process.exit(0); });
