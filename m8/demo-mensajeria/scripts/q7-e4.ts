// Q7 (E4): llamada síncrona a un LLM local frente a 202 Accepted + cola + worker.
// Requiere: docker compose --profile e4 up -d --build --wait  (lo hace `npm run q7`).
// Carga con k6 (contenedor grafana/k6 en la misma red de Compose). Entre pruebas se espera a que
// el LLM vuelva a responder rápido, para que una prueba no herede la cola de la anterior.
import { execSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { environment, writeResult, makePool, sleep, median, queueInfo } from './lib/harness.ts';
import { Q_SUMMARIES, Q_SUMMARIES_DLQ } from '../src/lib/amqp.ts';
import { traceIdOf } from '../src/lib/trace.ts';

const RATES = (process.env.RATES ?? '5,10,20').split(',').map(Number);
const DURATION = process.env.DURATION ?? '30s';
const RUNS = Number(process.env.RUNS ?? 3);
const e4 = new pg.Pool({ connectionString: 'postgres://postgres:demo@127.0.0.1:18332/e4', max: 2 });
const sh = (cmd: string) => execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).toString();

function k6(script: 'sync' | 'async', rate: number, tag: string) {
  return new Promise<any>((resolve, reject) => {
    const p = spawn('docker', ['compose', '--profile', 'load', 'run', '--rm', '-e', `RATE=${rate}`, '-e', `DURATION=${DURATION}`, '-e', `TAG=${tag}`,
      'k6', 'run', '--quiet', `/scripts/${script}.js`], { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    p.on('exit', () => {
      try { resolve(JSON.parse(readFileSync(new URL(`../results/raw/${script}-${script === 'sync' ? rate : tag}.json`, import.meta.url), 'utf8')).metrics); }
      catch (e) { reject(e); }
    });
  });
}

// Espera a que el LLM responda una petición corta en menos de 2 s (que no tenga cola pendiente).
async function waitLlmIdle() {
  const t0 = Date.now();
  for (;;) {
    const s = Date.now();
    try {
      const r = await fetch('http://127.0.0.1:12434/engines/v1/chat/completions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ model: 'ai/smollm2', max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] }),
      });
      if (r.ok && Date.now() - s < 2000) return Date.now() - t0;
    } catch { /* sigue ocupado */ }
    await sleep(3000);
  }
}

async function resetE4() {
  sh('node --no-warnings scripts/e4-reset.ts');
}

async function waitJobsDrained(timeoutMs = 600_000) {
  const t0 = Date.now();
  for (;;) {
    const { rows } = await e4.query(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending FROM summary_jobs`);
    if (rows[0].pending === 0) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(500);
  }
}

async function jobStats() {
  const { rows } = await e4.query(`
    SELECT status, attempts, traceparent_in, traceparent_worker,
           extract(epoch FROM (finished_at - created_at)) * 1000 AS e2e_ms, created_at, finished_at
      FROM summary_jobs`);
  const done = rows.filter((r) => r.status === 'done');
  const e2e = done.map((r) => Number(r.e2e_ms)).sort((a, b) => a - b);
  const p95 = e2e.length ? e2e[Math.floor(e2e.length * 0.95) - 1] ?? e2e[e2e.length - 1] : NaN;
  const first = Math.min(...rows.map((r) => +r.created_at)), last = Math.max(...done.map((r) => +r.finished_at));
  return {
    jobs: rows.length, done: done.length, failed: rows.filter((r) => r.status === 'failed').length,
    pending: rows.filter((r) => r.status === 'pending').length,
    retried: rows.filter((r) => r.attempts > 1).length,
    e2eMed: Math.round(median(e2e)), e2eP95: Math.round(p95), e2eMax: Math.round(e2e[e2e.length - 1] ?? NaN),
    drainS: Math.round((last - first) / 100) / 10,
    traceOk: done.filter((r) => traceIdOf(r.traceparent_in) && traceIdOf(r.traceparent_in) === traceIdOf(r.traceparent_worker)).length,
  };
}

const m = (x: any, k: string) => Math.round(x?.values?.[k] ?? NaN);

const pool = makePool(1);
const env = await environment(pool); await pool.end();
const llmInfo = sh('docker model inspect ai/smollm2');
const modelId = JSON.parse(llmInfo).id.slice(7, 19);

type Row = Record<string, any>;
const syncRows: Row[] = [], asyncRows: Row[] = [], failRows: Row[] = [];

for (let run = 1; run <= RUNS; run++) {
  for (const rate of RATES) {
    // --- síncrono ---
    await resetE4();
    const idle0 = await waitLlmIdle();
    const s = await k6('sync', rate, String(rate));
    const ok = s.http_reqs.values.count;
    const sum = JSON.parse(readFileSync(new URL(`../results/raw/sync-${rate}.json`, import.meta.url), 'utf8'));
    const chk = Object.fromEntries((sum.root_group.checks ?? []).map((c: any) => [c.name, c.passes]));
    const recover = await waitLlmIdle();
    syncRows.push({ run, rate, reqs: ok, s200: chk['200'] ?? 0, s504: chk['504'] ?? 0, dropped: s.dropped_iterations?.values?.count ?? 0,
      med: m(s.http_req_duration, 'med'), p95: m(s.http_req_duration, 'p(95)'), vus: s.vus_max?.values?.max, recoverS: Math.round(recover / 1000), idle0 });
    console.log('sync', JSON.stringify(syncRows.at(-1)));

    // --- asíncrono ---
    await resetE4();
    const t0 = Date.now();
    const a = await k6('async', rate, `r${rate}`);
    const asum = JSON.parse(readFileSync(new URL(`../results/raw/async-r${rate}.json`, import.meta.url), 'utf8'));
    const achk = Object.fromEntries((asum.root_group.checks ?? []).map((c: any) => [c.name, c.passes]));
    await waitJobsDrained();
    const js = await jobStats();
    asyncRows.push({ run, rate, reqs: a.http_reqs.values.count, s202: achk['202'] ?? 0, med: m(a.http_req_duration, 'med'), p95: m(a.http_req_duration, 'p(95)'),
      dropped: a.dropped_iterations?.values?.count ?? 0, ...js, wallS: Math.round((Date.now() - t0) / 1000) });
    console.log('async', JSON.stringify(asyncRows.at(-1)));
  }

  // --- matar el worker en mitad de la carga (SIGKILL) y apagarlo limpio (SIGTERM) ---
  for (const how of ['kill', 'stop'] as const) {
    await resetE4();
    await waitLlmIdle();
    const rate = 10;
    const t0 = Date.now();
    const load = k6('async', rate, `${how}`);
    await sleep(10_000);
    const tStop = Date.now();
    sh(how === 'kill' ? 'docker compose --profile e4 kill llm-worker' : 'docker compose --profile e4 stop llm-worker');
    const stopMs = Date.now() - tStop;
    const logs = sh('docker compose --profile e4 logs --no-log-prefix llm-worker');
    const clean = /apagado limpio/.test(logs.split('llm-worker prefetch').at(-1) ?? '');
    await sleep(Math.max(0, 19_000 - (Date.now() - t0)));
    const q = await queueInfo(Q_SUMMARIES);   // la consola refresca cada ~5 s: valor aproximado
    await sleep(Math.max(0, 20_000 - (Date.now() - t0)));
    sh('docker compose --profile e4 start llm-worker');
    const a = await load;
    const asum = JSON.parse(readFileSync(new URL(`../results/raw/async-${how}.json`, import.meta.url), 'utf8'));
    const achk = Object.fromEntries((asum.root_group.checks ?? []).map((c: any) => [c.name, c.passes]));
    await waitJobsDrained();
    const js = await jobStats();
    const dlq = (await queueInfo(Q_SUMMARIES_DLQ)).messages ?? 0;
    failRows.push({ run, how, reqs: a.http_reqs.values.count, s202: achk['202'] ?? 0, stopMs, clean, queuedWhileDown: q.messages, dlq, ...js });
    console.log(how, JSON.stringify(failRows.at(-1)));
  }
}
await e4.end();

let md = `# Q7. E4: llamada síncrona a un LLM local frente a 202 Accepted + cola + worker

Medido el ${new Date().toISOString().slice(0, 10)}. ${env} LLM: Docker Model Runner (motor llama.cpp) con \`ai/smollm2\` (361.82 M parámetros, IQ2_XXS/Q4_K_M, id ${modelId}), \`max_tokens\` 48, \`temperature\` 0, declarado con \`models:\` en Compose (la API y el worker reciben \`LLM_URL\` y \`LLM_MODEL\`). k6 2.3.0 en un contenedor de la misma red, \`constant-arrival-rate\` durante ${DURATION}; cada petición lleva un número de pedido distinto en el texto. API y worker en contenedores Node 24.19; plazo del LLM: 10 s en la ruta síncrona (\`AbortSignal.timeout\`, responde 504), 30 s en el worker. Worker con prefetch 2. Antes de cada prueba se espera a que el LLM no tenga cola (responde en < 2 s). ${RUNS} corridas.

## Síncrono: \`POST /sync/summaries\` espera al LLM

| Corrida | pet/s | Peticiones | 200 | 504 (plazo de 10 s) | Iteraciones descartadas por k6 | Latencia mediana (ms) | p95 (ms) | VUs máx. | Segundos hasta que el LLM vuelve a responder rápido |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
`;
for (const r of syncRows) md += `| ${r.run} | ${r.rate} | ${r.reqs} | ${r.s200} | **${r.s504}** | ${r.dropped} | ${r.med} | ${r.p95} | ${r.vus} | ${r.recoverS} |\n`;
md += `
## Asíncrono: \`POST /async/summaries\` responde 202 y un worker procesa la cola

| Corrida | pet/s | Peticiones | 202 | Latencia de la API mediana (ms) | p95 (ms) | Trabajos hechos | Fallidos | Pendientes al final | Petición→hecho mediana (ms) | p95 (ms) | máx. (ms) | Del primer encargo al último hecho (s) | \`traceparent\` conservado |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
`;
for (const r of asyncRows) md += `| ${r.run} | ${r.rate} | ${r.reqs} | ${r.s202} | ${r.med} | ${r.p95} | ${r.done} | ${r.failed} | ${r.pending} | ${r.e2eMed} | ${r.e2eP95} | ${r.e2eMax} | ${r.drainS} | ${r.traceOk} / ${r.done} |\n`;
md += `
## Worker caído en mitad de la carga (10 pet/s asíncronas, ${DURATION}; se detiene en el segundo 10 y vuelve en el 20)

- \`kill\`: \`docker compose kill llm-worker\` (SIGKILL, como un corte).
- \`stop\`: \`docker compose stop llm-worker\` (SIGTERM; el worker deja de recibir, termina lo que tiene en vuelo, cierra; gracia de 20 s).

| Corrida | Cómo | Peticiones | 202 | Tiempo de parada (ms) | ¿Apagado limpio en el log? | Mensajes en cola con el worker caído | Trabajos hechos | Pendientes al final | Reintentados (\`attempts\` > 1) | En la DLQ | Petición→hecho máx. (ms) |
|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
`;
for (const r of failRows) md += `| ${r.run} | ${r.how} | ${r.reqs} | ${r.s202} | ${r.stopMs} | ${r.clean ? 'sí' : 'no'} | ${r.queuedWhileDown ?? '-'} | ${r.done} | ${r.pending} | **${r.retried}** | ${r.dlq} | ${r.e2eMax} |\n`;
md += `
Lectura: ver la sección Q7 de [ESCENARIOS.md](ESCENARIOS.md).
`;
writeResult('Q7_E4_LLM.md', md);
process.exit(0);
