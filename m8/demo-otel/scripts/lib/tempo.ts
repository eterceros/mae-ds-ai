// Lectura de trazas desde la API HTTP de Tempo (la que usa Grafana por debajo).
export const TEMPO = process.env.TEMPO_URL ?? 'http://127.0.0.1:18533';

export type Span = {
  service: string; namespace: string; scope: string; name: string; kind: string;
  spanId: string; parentId: string | null; start: number; end: number; ms: number;
  attrs: Record<string, string | number | boolean>;
};

const hex = (b64?: string) => (b64 ? Buffer.from(b64, 'base64').toString('hex') : null);
const val = (v: any) => v?.stringValue ?? (v?.intValue !== undefined ? Number(v.intValue) : v?.boolValue ?? v?.doubleValue);

// Devuelve los spans de una traza, o null si Tempo no la tiene.
export async function getTrace(traceId: string): Promise<Span[] | null> {
  const r = await fetch(`${TEMPO}/api/traces/${traceId}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Tempo ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  const out: Span[] = [];
  for (const b of j.batches ?? j.resourceSpans ?? []) {
    const ra = Object.fromEntries((b.resource?.attributes ?? []).map((a: any) => [a.key, val(a.value)]));
    for (const ss of b.scopeSpans ?? []) for (const s of ss.spans ?? []) {
      const start = Number(BigInt(s.startTimeUnixNano) / 1000n) / 1000; // ms con decimales
      const end = Number(BigInt(s.endTimeUnixNano) / 1000n) / 1000;
      out.push({
        service: String(ra['service.name']), namespace: String(ra['service.namespace'] ?? ''),
        scope: ss.scope?.name ?? '', name: s.name, kind: String(s.kind ?? '').replace('SPAN_KIND_', ''),
        spanId: hex(s.spanId)!, parentId: hex(s.parentSpanId), start, end, ms: end - start,
        attrs: Object.fromEntries((s.attributes ?? []).map((a: any) => [a.key, val(a.value)])),
      });
    }
  }
  return out;
}

// Búsqueda TraceQL en una ventana de tiempo (segundos Unix).
export async function search(q: string, startS: number, endS: number, limit = 20) {
  const u = new URL(`${TEMPO}/api/search`);
  u.searchParams.set('q', q); u.searchParams.set('start', String(Math.floor(startS)));
  u.searchParams.set('end', String(Math.ceil(endS))); u.searchParams.set('limit', String(limit));
  const r = await fetch(u);
  if (!r.ok) throw new Error(`Tempo search ${r.status}: ${await r.text()}`);
  const j: any = await r.json();
  // Por traza: el span que cumplió la condición más largo (ms). durationMs de Tempo es la traza ENTERA
  // (incluye relay y worker, que terminan después de la respuesta), por eso se usa el span.
  return (j.traces ?? []).map((t: any) => ({
    traceId: String(t.traceID).padStart(32, '0'), rootService: t.rootServiceName, rootName: t.rootTraceName,
    traceMs: t.durationMs ?? 0,
    spanMs: Math.max(0, ...(t.spanSets ?? [t.spanSet]).filter(Boolean).flatMap((ss: any) => ss.spans ?? [])
      .map((sp: any) => Number(sp.durationNanos) / 1e6)),
  })) as { traceId: string; rootService: string; rootName: string; traceMs: number; spanMs: number }[];
}

// Árbol de texto de una traza: lo que se ve en Grafana (Explore -> Tempo), en ASCII.
export function tree(spans: Span[]): string {
  const t0 = Math.min(...spans.map((s) => s.start));
  const ids = new Set(spans.map((s) => s.spanId));
  const kids = new Map<string, Span[]>();
  for (const s of spans) {
    const p = s.parentId && ids.has(s.parentId) ? s.parentId : 'raiz';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p)!.push(s);
  }
  for (const l of kids.values()) l.sort((a, b) => a.start - b.start);
  const lines: string[] = [];
  const walk = (s: Span, depth: number) => {
    const huerfano = depth === 0 && s.parentId ? `  (padre ${s.parentId} NO está en la traza)` : '';
    lines.push(`${'  '.repeat(depth)}${s.service.padEnd(8)} ${s.kind.padEnd(8)} ${s.name.padEnd(40 - 2 * depth)} ` +
      `+${(s.start - t0).toFixed(1).padStart(7)} ms ${s.ms.toFixed(1).padStart(8)} ms  span ${s.spanId}${huerfano}`);
    for (const k of kids.get(s.spanId) ?? []) walk(k, depth + 1);
  };
  for (const r of kids.get('raiz') ?? []) walk(r, 0);
  return lines.join('\n');
}

export async function waitTrace(traceId: string, pred: (s: Span[]) => boolean, timeoutMs = 30000) {
  const t = Date.now();
  let last: Span[] | null = null;
  while (Date.now() - t < timeoutMs) {
    last = await getTrace(traceId);
    if (last && pred(last)) return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return last;
}

// Camino crítico simplificado: desde la raíz, baja siempre por el hijo más largo.
export function criticalPath(spans: Span[], root: Span): Span[] {
  const path = [root];
  let cur = root;
  for (;;) {
    const kids = spans.filter((s) => s.parentId === cur.spanId && s.start < root.end);
    if (!kids.length) return path;
    cur = kids.reduce((a, b) => (b.ms > a.ms ? b : a));
    path.push(cur);
  }
}
