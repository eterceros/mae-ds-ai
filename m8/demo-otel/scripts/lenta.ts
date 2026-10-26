// OD a mano: lee la salida JSON de k6 (--out json=...) y lista las peticiones más lentas con su
// trace-id, para abrirlas en Grafana (Explore -> Tempo -> pegar el trace-id).
// Uso: node scripts/lenta.ts results/raw/mi-prueba.json.gz [cuántas]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pct } from './lib/util.ts';

const [file, cuantas = '5'] = process.argv.slice(2);
if (!file) { console.error('uso: node scripts/lenta.ts <salida de k6 .json o .json.gz> [cuántas]'); process.exit(1); }
const buf = readFileSync(file);
const text = file.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
const reqs: { ms: number; traceId: string; t: string; status: string }[] = [];
for (const line of text.split('\n')) {
  if (!line.startsWith('{"metric":"http_req_duration"')) continue;
  const j = JSON.parse(line);
  if (j.type === 'Point') reqs.push({ ms: j.data.value, traceId: j.data.tags.trace_id, t: j.data.time, status: j.data.tags.status });
}
const ms = reqs.map((r) => r.ms);
const p95 = pct(ms, 95);
console.log(`${reqs.length} peticiones, de ${reqs[0]?.t} a ${reqs.at(-1)?.t}`);
console.log(`p50 ${pct(ms, 50).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, máx ${Math.max(...ms).toFixed(1)} ms`);
console.log(`En Grafana (http://127.0.0.1:18530) -> Explore -> Tempo -> TraceQL, con ese rango de tiempo:`);
console.log(`  { resource.service.name = "api" && kind = server && duration >= ${Math.floor(p95)}ms }`);
console.log(`o directamente por trace-id (las ${cuantas} más lentas según k6):`);
for (const r of reqs.sort((a, b) => b.ms - a.ms).slice(0, Number(cuantas))) {
  console.log(`  ${r.ms.toFixed(1).padStart(8)} ms  ${r.traceId}  (${r.t}, HTTP ${r.status})`);
}
