// W3C Trace Context a mano, como en la S08 (demo-mensajeria/src/lib/trace.ts), sin OpenTelemetry.
// Solo lo usa src/antes/: es lo que hay que QUITAR al poner la auto-instrumentación.
import { randomBytes } from 'node:crypto';

const RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function newTraceparent(): string {
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

export function childOf(parent: string | undefined): string {
  const m = parent ? RE.exec(parent) : null;
  if (!m) return newTraceparent();
  return `00-${m[1]}-${randomBytes(8).toString('hex')}-${m[3]}`;
}

export function traceIdOf(tp: unknown): string | null {
  const m = typeof tp === 'string' ? RE.exec(tp) : null;
  return m ? m[1] : null;
}
