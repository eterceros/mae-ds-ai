// SIMULADOR — El proveedor de pagos que envía los webhooks (I1), y un atacante.
// Proveedor: firma cada entrega (Standard Webhooks), espera la respuesta como máximo TIMEOUT_MS y, si
// no llega un 2xx a tiempo, da la entrega por fallida y la REENVÍA con espera creciente (1, 2, 4, 8 s),
// hasta MAX_ATTEMPTS. Así se comportan los proveedores reales, con plazos de segundos y reintentos
// durante horas o días; aquí está comprimido.
// Atacante: entregas sin firma, con una firma hecha con otro secreto, y repeticiones de entregas
// válidas capturadas hace 10 minutos (firma correcta, marca de tiempo vieja).
import { signHeader } from '../lib/webhook-signature.ts';
import { sleep } from '../lib/config.ts';

export type Delivery = { eventId: string; attempt: number; status: number | 'timeout' | 'error'; ms: number; kind: string };

const BACKOFF_S = [1, 2, 4, 8];

function payload(eventId: string, orderId: string, amount: number) {
  return JSON.stringify({ type: 'payment.succeeded', data: { order_id: orderId, amount_cents: amount }, event_id: eventId });
}

async function post(url: string, headers: Record<string, string>, body: string, timeoutMs: number) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, signal: AbortSignal.timeout(timeoutMs) });
    await r.arrayBuffer();
    return { status: r.status as Delivery['status'], ms: performance.now() - t0 };
  } catch (e: any) {
    return { status: (e?.name === 'TimeoutError' ? 'timeout' : 'error') as Delivery['status'], ms: performance.now() - t0 };
  }
}

const ok = (s: Delivery['status']) => typeof s === 'number' && s >= 200 && s < 300;

// Entrega de un evento legítimo con reenvíos. Con duplicateAfterOk, además, vuelve a entregar el
// evento una vez después de un 2xx: los proveedores garantizan "al menos una vez", no "una vez".
export async function deliverWithRetries(url: string, secret: string, eventId: string, orderId: string, amount: number,
  timeoutMs: number, maxAttempts: number, log: Delivery[], duplicateAfterOk = false) {
  const body = payload(eventId, orderId, amount);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ts = Math.floor(Date.now() / 1000);
    const headers = { 'webhook-id': eventId, 'webhook-timestamp': String(ts), 'webhook-signature': signHeader(secret, eventId, ts, body) };
    const r = await post(url, headers, body, timeoutMs);
    log.push({ eventId, attempt, status: r.status, ms: r.ms, kind: 'genuine' });
    if (ok(r.status)) {
      if (duplicateAfterOk) {
        await sleep(500);
        const ts2 = Math.floor(Date.now() / 1000);
        const h2 = { 'webhook-id': eventId, 'webhook-timestamp': String(ts2), 'webhook-signature': signHeader(secret, eventId, ts2, body) };
        const r2 = await post(url, h2, body, timeoutMs);
        log.push({ eventId, attempt: attempt + 1, status: r2.status, ms: r2.ms, kind: 'genuine-dup' });
      }
      return true;
    }
    if (attempt < maxAttempts) await sleep(BACKOFF_S[Math.min(attempt - 1, BACKOFF_S.length - 1)] * 1000);
  }
  return false;
}

// Atacante. Devuelve cuántas entregas de cada tipo recibieron un 2xx.
export async function attack(url: string, secret: string, replayOf: { eventId: string; orderId: string; amount: number }[],
  forgedCount: number, log: Delivery[]) {
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < forgedCount; i++) {
    const eventId = `evt_forged_${i}`;
    const body = payload(eventId, `ord_forged_${i}`, 999_99);
    const ts = Math.floor(Date.now() / 1000);
    // La mitad sin firma; la otra mitad firmada con un secreto que no es el del proveedor.
    const headers: Record<string, string> = i % 2 === 0
      ? { 'webhook-id': eventId, 'webhook-timestamp': String(ts) }
      : { 'webhook-id': eventId, 'webhook-timestamp': String(ts), 'webhook-signature': signHeader('whsec_' + Buffer.from('otro-secreto').toString('base64'), eventId, ts, body) };
    jobs.push(post(url, headers, body, 30_000).then((r) => { log.push({ eventId, attempt: 1, status: r.status, ms: r.ms, kind: i % 2 === 0 ? 'forged-unsigned' : 'forged-wrong-key' }); }));
  }
  for (const ev of replayOf) {
    // Entrega válida capturada hace 10 minutos: firma correcta para esa marca de tiempo.
    const body = payload(ev.eventId, ev.orderId, ev.amount);
    const ts = Math.floor(Date.now() / 1000) - 600;
    const headers = { 'webhook-id': ev.eventId, 'webhook-timestamp': String(ts), 'webhook-signature': signHeader(secret, ev.eventId, ts, body) };
    jobs.push(post(url, headers, body, 30_000).then((r) => { log.push({ eventId: ev.eventId, attempt: 1, status: r.status, ms: r.ms, kind: 'replay' }); }));
  }
  await Promise.all(jobs);
}

export { ok as isOk };
