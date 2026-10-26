// Logs JSON con pino. Con la auto-instrumentación encendida, @opentelemetry/instrumentation-pino
// agrega trace_id, span_id y trace_flags a cada línea escrita dentro de un span, y además envía el
// log por OTLP (en otel-lgtm llega a Loki). Sin instrumentación son las mismas líneas, sin esos campos.
import { pino } from 'pino';

export const log = pino({ base: { service: process.env.OTEL_SERVICE_NAME ?? 'sin-nombre' } });
