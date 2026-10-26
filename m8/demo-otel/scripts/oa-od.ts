// OA y OD: precios lento en 1 de cada 10 peticiones.
//  - antes (sin instrumentar): k6 da el p95 y nada más.
//  - despues (auto-instrumentación): del p95 de k6 a las trazas de la ventana de la prueba con
//    duración >= p95 (TraceQL), a la más lenta y a su camino crítico.
// Escribe results/OA-OD_P95_A_TRAZA.md (o results/raw/smoke-... con SMOKE=1).
import { antes, entorno, f0, f1, k6, median, pct, RUNS, save, saveRaw, SMOKE, sleep } from './lib/util.ts';
import { criticalPath, getTrace, search, tree, waitTrace, type Span } from './lib/tempo.ts';

const RATE = Number(process.env.RATE ?? 20);
const DURATION = process.env.DURATION ?? (SMOKE ? '10s' : '30s');
const SLOW_MS = 600;

type Fila = Record<string, string | number>;
const filasK6: Fila[] = [];
const filasTraza: Fila[] = [];
const capturas: string[] = [];

const apiServer = (spans: Span[]) => spans.find((s) => s.service === 'api' && s.kind === 'SERVER');
const preciosServer = (spans: Span[]) => spans.find((s) => s.service === 'precios' && s.kind === 'SERVER');

for (let run = 1; run <= RUNS; run++) {
  for (const variante of ['antes', 'despues'] as const) {
    if (variante === 'antes') antes(false); // el "antes" de OA: sin OpenTelemetry
    const name = `oa-${variante}-${run}`;
    const baseUrl = variante === 'antes' ? 'http://api-antes:3000' : 'http://api-despues:3000';
    console.log(`[${name}] k6 ${RATE}/s durante ${DURATION}`);
    const { reqs, summary, t0, t1 } = k6(name, baseUrl, { RATE: String(RATE), DURATION, ESCENARIO: 'OA', CORRIDA: String(run) });
    const ms = reqs.map((r) => r.ms);
    const k6p95 = summary.metrics.http_req_duration['p(95)'];
    const lenta = reqs.reduce((a, b) => (b.ms > a.ms ? b : a));
    filasK6.push({
      variante, corrida: run, peticiones: reqs.length, 'no 201': reqs.filter((r) => r.status !== 201).length,
      p50: f1(median(ms)), p90: f1(pct(ms, 90)), p95: f1(k6p95), p99: f1(pct(ms, 99)), max: f1(Math.max(...ms)),
      '>= 300 ms': ms.filter((x) => x >= 300).length,
    });
    if (variante === 'antes') continue;

    // --- OD: de la cifra a la traza ---
    // 1) esperar a que la traza más lenta de k6 esté completa en Tempo (el SDK exporta cada ~5 s)
    const tLenta = await waitTrace(lenta.traceId, (s) => !!preciosServer(s) && s.some((x) => x.service === 'worker'), 60000);
    await sleep(5000);
    // 2) la consulta que haría una persona en Grafana: ventana de la prueba + duración >= p95
    const umbral = Math.floor(k6p95);
    const q = `{ resource.service.namespace = "despues" && resource.service.name = "api" && kind = server && duration >= ${umbral}ms }`;
    // La búsqueda de Tempo ve las trazas unos segundos después que la consulta por id: se repite
    // hasta que el número de resultados deja de crecer (y se anota cuánto tardó).
    const tBusca = Date.now();
    let hall: Awaited<ReturnType<typeof search>> = [];
    for (let prev = -1, estable = 0; Date.now() - tBusca < 180000 && estable < 2; await sleep(5000)) {
      hall = await search(q, t0 - 5, t1 + 30, 1000);
      estable = hall.length > 0 && hall.length === prev ? estable + 1 : 0;
      prev = hall.length;
    }
    const lagS = (Date.now() - tBusca) / 1000;
    hall.sort((a, b) => b.spanMs - a.spanMs);
    const top = hall[0];
    const enK6 = new Set(reqs.map((r) => r.traceId));
    // 3) ¿la causa es precios? En TODAS las trazas >= p95: parte del span de la API que ocupa el de precios
    let causaPrecios = 0;
    const partes: number[] = [];
    for (const h of hall) {
      const s = await getTrace(h.traceId);
      const a = s && apiServer(s), p = s && preciosServer(s);
      if (!a || !p) continue;
      partes.push((100 * p.ms) / a.ms);
      if (p.ms >= 0.8 * a.ms) causaPrecios++;
    }
    const spans = (top && (await getTrace(top.traceId))) || tLenta || [];
    const a = apiServer(spans)!;
    const camino = criticalPath(spans, a);
    filasTraza.push({
      corrida: run, 'p95 k6 (ms)': f1(k6p95), 'peticiones k6 >= p95': reqs.filter((r) => r.ms >= k6p95).length,
      'consulta >= p95': `${hall.length} trazas`, 'búsqueda estable tras': `~${f0(lagS)} s`,
      'todas de esta prueba': hall.every((h) => enK6.has(h.traceId)) ? 'sí' : 'NO',
      'más lenta (Tempo)': top ? `${top.traceId} (${f1(top.spanMs)} ms)` : '—',
      '¿= la más lenta de k6?': top?.traceId === lenta.traceId ? `sí (${f1(lenta.ms)} ms en k6)` : `no: k6 ${lenta.traceId} ${f1(lenta.ms)} ms`,
      'precios >= 80 % del span de la API': `${causaPrecios} de ${hall.length}`,
      'parte de precios (mediana)': `${f0(median(partes))} %`,
    });
    capturas.push([
      `### Corrida ${run}: traza ${top?.traceId}`, '',
      `Span de la API ${f1(a.ms)} ms; spans en la traza: ${spans.length} (${[...new Set(spans.map((s) => s.service))].join(', ')}).`, '',
      'Camino crítico (desde POST /pedidos, bajando siempre por el hijo más largo):', '',
      ...camino.map((s, i) => `${i + 1}. \`${s.service}\` ${s.kind} \`${s.name}\`: ${f1(s.ms)} ms (${f0((100 * s.ms) / a.ms)} % del span de la API)`), '',
      '```', tree(spans), '```', '',
    ].join('\n'));
    saveRaw(`${name}-traza-lenta.json`, JSON.stringify(spans, null, 1));
  }
}

const tabla = (rows: Fila[]) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
};
const medianaDe = (v: string, col: string) => f1(median(filasK6.filter((r) => r.variante === v).map((r) => Number(r[col]))));

save('OA-OD_P95_A_TRAZA.md', `# OA y OD: del p95 de k6 a la traza más lenta

Generado por \`scripts/oa-od.ts\` el ${new Date().toISOString()}. ${entorno()}.
Carga: k6 2.3.0, ${RATE} pedidos/s durante ${DURATION} (constant-arrival-rate), desde un contenedor de la misma red de Compose.
precios tarda ${SLOW_MS} ms en 1 de cada 10 peticiones (y 2-5 ms en las demás). ${RUNS} corrida(s) por variante, alternadas.

## k6 (ms)

${tabla(filasK6)}

Medianas de las corridas: antes p50 ${medianaDe('antes', 'p50')} / p95 ${medianaDe('antes', 'p95')}; despues p50 ${medianaDe('despues', 'p50')} / p95 ${medianaDe('despues', 'p95')}.

## De la cifra a la traza (solo despues)

Consulta TraceQL, en la ventana de la prueba (inicio de k6 − 5 s, fin + 30 s), con el p95 de esa corrida como umbral:

\`\`\`
{ resource.service.namespace = "despues" && resource.service.name = "api" && kind = server && duration >= <p95>ms }
\`\`\`

${tabla(filasTraza)}

## La traza más lenta de cada corrida

${capturas.join('\n')}
`);
