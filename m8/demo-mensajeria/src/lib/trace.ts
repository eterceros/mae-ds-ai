// W3C Trace Context mínimo, sin OpenTelemetry (eso es la S10).
// traceparent = "00-<trace-id 32 hex>-<span-id 16 hex>-<flags 2 hex>"
import { randomBytes } from 'node:crypto';

const RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function newTraceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

// Un salto nuevo dentro de la misma traza: se conserva el trace-id y se cambia el span-id.
export function childOf(parent: string | undefined): string {
  const m = parent ? RE.exec(parent) : null;
  if (!m) return newTraceparent();
  return `00-${m[1]}-${randomBytes(8).toString('hex')}-${m[3]}`;
}

export function traceIdOf(tp: string | undefined | null): string | null {
  const m = tp ? RE.exec(tp) : null;
  return m ? m[1] : null;
}
