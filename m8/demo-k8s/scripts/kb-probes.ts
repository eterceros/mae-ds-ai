// KB: liveness that depends on precios (antes) vs liveness on the process only + readiness for the
// dependency (despues). Same app, same image; only the probe path of the liveness changes.
//
// Each run: fresh api pods; a load Pod sends 10 req/s for 240 s to http://api.s11/cotizacion;
// at t=20 s precios is switched off (replicas 0) and at t=110 s it is switched on again (90 s down).
// Measured: api restarts, failed requests (total, during the outage, after precios is back), and the
// time from "precios Ready again" to the first 200 and to the first full second of 200s.
// Usage: node --no-warnings scripts/kb-probes.ts [runs=3]
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, kubectl, kjson, restarts, readyEndpoints, runLoad, sleep, waitFor, median, environment, writeResult } from './lib/k8s.ts';

const RUNS = Number(process.argv[2] ?? 3);
const RPS = 10, SECS = 240, DOWN_AT = 20, UP_AT = 110;
const VARIANTS = [
  { name: 'antes', file: 'antes/kb-liveness-con-dependencia.yaml', label: 'liveness → /salud/listo (consulta precios)' },
  { name: 'despues', file: 'despues/api.yaml', label: 'liveness → /salud/vivo; readiness → /salud/listo' },
];
const RAW = join(ROOT, 'results', 'raw', 'kb');
mkdirSync(RAW, { recursive: true });

async function oneRun(v: typeof VARIANTS[number], run: number) {
  kubectl(['scale', '-n', 's11', 'deployment/precios', '--replicas=1']);
  kubectl(['-n', 's11', 'rollout', 'status', 'deployment/precios', '--timeout=120s']);
  kubectl(['apply', '-f', v.file]);
  kubectl(['-n', 's11', 'rollout', 'restart', 'deployment/api']);          // fresh pods: restart count 0
  kubectl(['-n', 's11', 'rollout', 'status', 'deployment/api', '--timeout=180s']);
  await waitFor('old api pods gone', () => kjson(['-n', 's11', 'get', 'pods', '-l', 'app=api']).items.length === 2, 120_000);
  await waitFor('2 api endpoints ready', () => readyEndpoints('api') === 2, 60_000);

  const load = await runLoad('carga-kb', 'http://api.s11/cotizacion?producto=p1', RPS, SECS);
  await waitFor('load pod running', () => kjson(['-n', 's11', 'get', 'pod', 'carga-kb']).status.phase === 'Running', 60_000, 200);
  const t0 = Date.now();
  const timeline: { t: number; apiReady: number; restarts: number; precios: number }[] = [];
  let tPreciosBack = 0, downDone = false, upDone = false;
  while (Date.now() - t0 < SECS * 1000) {
    const t = (Date.now() - t0) / 1000;
    if (!downDone && t >= DOWN_AT) { kubectl(['scale', '-n', 's11', 'deployment/precios', '--replicas=0']); downDone = true; }
    if (!upDone && t >= UP_AT) { kubectl(['scale', '-n', 's11', 'deployment/precios', '--replicas=1']); upDone = true; }
    const precios = readyEndpoints('precios');
    if (upDone && !tPreciosBack && precios > 0) tPreciosBack = t;
    timeline.push({ t: Math.round(t * 10) / 10, apiReady: readyEndpoints('api'), restarts: restarts('app=api'), precios });
    await sleep(2000);
  }
  const res = await load.result();
  const apiRestarts = restarts('app=api');
  const states = kjson(['-n', 's11', 'get', 'pods', '-l', 'app=api']).items.map((p: any) => {
    const c = p.status.containerStatuses?.[0];
    return c?.state?.waiting?.reason ?? (c?.ready ? 'Ready' : Object.keys(c?.state ?? {})[0]);
  });
  // The load Pod started ~when t0 was taken; its per-second series is aligned with t0 within ~1 s.
  const sec = res.sec;
  const failIn = (a: number, b: number) => sec.filter((s) => s.s >= a && s.s < b).reduce((n, s) => n + s.fail, 0);
  const back = Math.ceil(tPreciosBack);
  const firstOk = sec.find((s) => s.s >= back && s.ok > 0)?.s;
  const firstFull = sec.find((s) => s.s >= back && s.fail === 0 && s.ok > 0)?.s;
  const r = {
    variant: v.name, run, total: res.total, ok: res.ok, fail: res.fail, reasons: res.reasons, apiRestarts, states,
    failBefore: failIn(0, DOWN_AT), failOutage: failIn(DOWN_AT, back), failAfterBack: failIn(back, SECS + 5),
    preciosBackAt: Math.round(tPreciosBack * 10) / 10,
    firstOkAfterBack: firstOk === undefined ? null : firstOk - back,
    firstFullAfterBack: firstFull === undefined ? null : firstFull - back,
  };
  writeFileSync(join(RAW, `${v.name}-${run}.json`), JSON.stringify({ ...r, timeline, sec }, null, 2));
  console.log(JSON.stringify(r));
  return r;
}

// `node scripts/kb-probes.ts report` rebuilds the report from results/raw/kb/ without measuring again.
const REPORT_ONLY = process.argv[2] === 'report';
type Run = Awaited<ReturnType<typeof oneRun>> & { timeline: { t: number; apiReady: number; restarts: number }[] };
const all: Run[] = [];
if (!REPORT_ONLY) {
  for (let run = 1; run <= RUNS; run++) for (const v of VARIANTS) { await oneRun(v, run); }
  kubectl(['scale', '-n', 's11', 'deployment/precios', '--replicas=1']);
  kubectl(['apply', '-f', 'despues/api.yaml']);
}
for (const f of readdirSync(RAW).filter((x) => /^(antes|despues)-\d+\.json$/.test(x)).sort()) all.push(JSON.parse(readFileSync(join(RAW, f), 'utf8')));
all.sort((a, b) => a.run - b.run || a.variant.localeCompare(b.variant));

// From the 2-second samples: seconds from "precios back" until BOTH api pods are in the Service again.
const fullCapacity = (r: Run) => {
  const x = r.timeline.find((s) => s.t >= r.preciosBackAt && s.apiReady === 2);
  return x ? Math.round(x.t - r.preciosBackAt) : null;
};
const restartsAfterBack = (r: Run) => r.apiRestarts - (r.timeline.filter((s) => s.t <= r.preciosBackAt).at(-1)?.restarts ?? 0);
const reasonsOf = (r: Run) => Object.entries(r.reasons).map(([k, v]) => `${k} ${v}`).join(', ');
const rows = all.map((r) => `| ${r.variant} | ${r.run} | ${r.apiRestarts} | ${r.fail} | ${r.failOutage} | ${r.failAfterBack} | ${r.firstOkAfterBack ?? 'nunca'} | ${fullCapacity(r) ?? `> ${Math.round(SECS - r.preciosBackAt)}`} | ${reasonsOf(r)} |`);
const med = (v: string, f: (r: Run) => number | null) => {
  const xs = all.filter((r) => r.variant === v).map((r) => f(r) ?? NaN);
  return `${median(xs)} (${Math.min(...xs)}–${Math.max(...xs)})`;
};
writeResult('KB_PROBES.md', `# KB · Liveness que consulta una dependencia frente a readiness bien usada

${environment()}

Mismo código y misma imagen; solo cambia la ruta de la *liveness* de \`api\` (2 réplicas):

- **antes** ([\`antes/kb-liveness-con-dependencia.yaml\`](../antes/kb-liveness-con-dependencia.yaml)): ${VARIANTS[0].label}
- **despues** ([\`despues/api.yaml\`](../despues/api.yaml)): ${VARIANTS[1].label}

Ambas: readiness cada 2 s (2 fallos), liveness cada 5 s (3 fallos), startup cada 1 s. Procedimiento de cada corrida (\`node --no-warnings scripts/kb-probes.ts\`): pods nuevos de \`api\`; un pod de carga hace ${RPS} peticiones/s durante ${SECS} s a \`http://api.s11/cotizacion\` (por el Service, como otro servicio del clúster); en t = ${DOWN_AT} s se apaga \`precios\` (réplicas a 0) y en t = ${UP_AT} s se vuelve a encender (${UP_AT - DOWN_AT} s caído). ${all.length / 2} corridas por variante, alternadas. Los endpoints listos y los reinicios se muestrean cada 2 s: los tiempos en segundos tienen esa resolución.

## Resumen (mediana y rango de ${all.length / 2} corridas)

| | antes | despues |
|---|---|---|
| Reinicios de \`api\` (2 pods) | **${med('antes', (r) => r.apiRestarts)}** | **${med('despues', (r) => r.apiRestarts)}** |
| … de ellos, después de que \`precios\` volvió | ${med('antes', restartsAfterBack)} | ${med('despues', restartsAfterBack)} |
| Peticiones fallidas (de ${RPS * SECS}) | ${med('antes', (r) => r.fail)} | ${med('despues', (r) => r.fail)} |
| … mientras \`precios\` estaba caído | ${med('antes', (r) => r.failOutage)} | ${med('despues', (r) => r.failOutage)} |
| … después de que \`precios\` volvió | ${med('antes', (r) => r.failAfterBack)} | ${med('despues', (r) => r.failAfterBack)} |
| Segundos desde que \`precios\` vuelve hasta el primer 200 | ${med('antes', (r) => r.firstOkAfterBack)} | ${med('despues', (r) => r.firstOkAfterBack)} |
| Segundos hasta tener **los 2 pods** de nuevo en el Service | **${med('antes', fullCapacity)}** | **${med('despues', fullCapacity)}** |

## Cada corrida

| Variante | Corrida | Reinicios | Fallidas | Durante la caída | Tras volver | 1.er 200 tras volver (s) | 2 pods en el Service tras volver (s) | Motivos de los fallos |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Los motivos son los que ve el cliente: \`http 502\` = la api respondió que \`precios\` no contesta; \`ECONNREFUSED\` = el Service no tenía pods listos; \`TimeoutError\` = sin respuesta en 2 s; \`UND_ERR_SOCKET\` = conexión cortada. La serie segundo a segundo (peticiones correctas y fallidas, endpoints listos, reinicios cada 2 s) está en [\`raw/kb/\`](raw/kb/).
`);
