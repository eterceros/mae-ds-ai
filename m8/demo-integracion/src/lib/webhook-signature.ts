// Firma de webhooks al estilo de Standard Webhooks (https://www.standardwebhooks.com/):
// cabeceras webhook-id, webhook-timestamp (segundos Unix) y webhook-signature: "v1,<base64>",
// donde la firma es HMAC-SHA256(clave, "<id>.<timestamp>.<cuerpo crudo>").
// La usa el emisor simulado para firmar; la verificación está en src/despues/webhook-receiver.ts.
import { createHmac } from 'node:crypto';

export function secretKey(secret: string): Buffer {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
}

export function signature(secret: string, id: string, timestamp: number, body: string | Buffer): Buffer {
  return createHmac('sha256', secretKey(secret)).update(`${id}.${timestamp}.`).update(body).digest();
}

export function signHeader(secret: string, id: string, timestamp: number, body: string): string {
  return `v1,${signature(secret, id, timestamp, body).toString('base64')}`;
}
