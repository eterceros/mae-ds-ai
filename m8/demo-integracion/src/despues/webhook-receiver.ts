// DESPUÉS (práctica corregida) — Receptor del webhook de pagos (I1). Comparar con src/antes/webhook-receiver.ts.
// Solo hace lo imprescindible antes de responder: verificar la firma sobre el cuerpo crudo, comprobar
// que el mensaje es reciente y guardarlo en la bandeja de entrada (webhook_inbox). El trabajo lento lo
// hace src/despues/webhook-worker.ts después, leyendo la bandeja como una cola.
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { makePool } from '../lib/db.ts';
import { RECEIVER_PORT, WEBHOOK_SECRET } from '../lib/config.ts';
import { signature } from '../lib/webhook-signature.ts';

const TOLERANCE_S = Number(process.env.WEBHOOK_TOLERANCE_S ?? 300);   // ventana de 5 minutos
const MAX_BODY = 256 * 1024;
const pool = makePool(20);

// CORRECCIÓN: verificar la firma HMAC. Se calcula sobre el cuerpo CRUDO (los bytes tal como llegaron):
// si primero se hace JSON.parse y luego JSON.stringify, el texto cambia y la firma no coincide.
// La comparación es en tiempo constante (timingSafeEqual): con "===" el tiempo de respuesta revela
// cuántos bytes iniciales acertó un atacante. La cabecera puede traer varias firmas separadas por
// espacio (rotación de secretos): basta con que una coincida.
function verify(id: string, ts: string, sigHeader: string, raw: Buffer): 'ok' | 'bad-signature' | 'too-old' {
  const tsNum = Number(ts);
  // CORRECCIÓN: ventana de tiempo contra repeticiones. La marca de tiempo va dentro de lo firmado,
  // así que un atacante que capturó una entrega válida no puede cambiarla; pasada la ventana, se rechaza.
  if (!Number.isInteger(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > TOLERANCE_S) return 'too-old';
  const expected = signature(WEBHOOK_SECRET, id, tsNum, raw);
  for (const part of sigHeader.split(' ')) {
    const [version, b64] = part.split(',');
    if (version !== 'v1' || !b64) continue;
    const given = Buffer.from(b64, 'base64');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return 'ok';
  }
  return 'bad-signature';
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return; }
  if (req.method !== 'POST' || req.url !== '/webhooks/payments') { res.statusCode = 404; res.end(); return; }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { res.writeHead(413).end(); return; }   // CORRECCIÓN: límite de tamaño
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const id = String(req.headers['webhook-id'] ?? '');
  const check = verify(id, String(req.headers['webhook-timestamp'] ?? ''), String(req.headers['webhook-signature'] ?? ''), raw);
  if (!id || check !== 'ok') { res.writeHead(401).end(check); return; }
  try {
    const ev = JSON.parse(raw.toString('utf8')) as { type: string };
    // CORRECCIÓN: guardar y responder. La clave primaria es el webhook-id (el id del evento que pone
    // el emisor): un reenvío del mismo evento no crea otra fila (ON CONFLICT DO NOTHING) y se le
    // responde 200 igual, para que el emisor deje de reenviarlo.
    const r = await pool.query(
      'INSERT INTO webhook_inbox (event_id, event_type, payload) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING',
      [id, ev.type, raw.toString('utf8')]);
    // CORRECCIÓN: 202 en milisegundos; el trabajo lento queda en la bandeja para el worker.
    res.writeHead(r.rowCount === 1 ? 202 : 200).end();
  } catch (e) {
    res.writeHead(400).end(String(e));
  }
});
server.listen(RECEIVER_PORT, '127.0.0.1', () => console.log(`receptor DESPUÉS en ${RECEIVER_PORT} (pid ${process.pid})`));
