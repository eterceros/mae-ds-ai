// OA, desglose: para TODAS las peticiones de las corridas de despues (no solo la más lenta), en qué
// se fue el tiempo del span de la API: precios, COMMIT de Postgres, el resto.
// Necesita que Tempo todavía tenga las trazas de `npm run oa-od` (no correr `down` entre medio).
// Escribe results/OA_DESGLOSE.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { getTrace } from './lib/tempo.ts';
import { f0, f1, median, pct, RAW, RUNS, save } from './lib/util.ts';

const filas: string[] = [];
const tot = { lentas: 0, porPrecios: 0, porCommit: 0, ambas: 0, otras: 0, faltan: 0 };
const commits: number[] = [];
for (let run = 1; run <= RUNS; run++) {
  const ids: string[] = [];
  for (const line of gunzipSync(readFileSync(join(RAW, `oa-despues-${run}.json.gz`))).toString('utf8').split('\n')) {
    if (!line.startsWith('{"metric":"http_req_duration"')) continue;
    const j = JSON.parse(line);
    if (j.type === 'Point') ids.push(j.data.tags.trace_id);
  }
  let lentas = 0, porPrecios = 0, porCommit = 0, ambas = 0, otras = 0, faltan = 0;
  const cRun: number[] = [];
  for (const id of ids) {
    const s = await getTrace(id);
    const api = s?.find((x) => x.service === 'api' && x.kind === 'SERVER');
    if (!s || !api) { faltan++; continue; }
    const precios = s.find((x) => x.service === 'precios' && x.kind === 'SERVER')?.ms ?? 0;
    const commit = s.find((x) => x.name.startsWith('pg.query:COMMIT'))?.ms ?? 0;
    cRun.push(commit);
    if (api.ms < 300) continue;
    lentas++;
    const p = precios >= 300, c = commit >= 50;
    if (p && c) ambas++; else if (p) porPrecios++; else if (c) porCommit++; else otras++;
  }
  commits.push(...cRun);
  Object.assign(tot, {
    lentas: tot.lentas + lentas, porPrecios: tot.porPrecios + porPrecios, porCommit: tot.porCommit + porCommit,
    ambas: tot.ambas + ambas, otras: tot.otras + otras, faltan: tot.faltan + faltan,
  });
  filas.push(`| ${run} | ${ids.length} | ${faltan} | ${lentas} | ${porPrecios} | ${ambas} | ${porCommit} | ${otras} | ` +
    `${f1(median(cRun))} / ${f1(pct(cRun, 95))} / ${f1(Math.max(...cRun))} | ${cRun.filter((x) => x >= 50).length} |`);
}

save('OA_DESGLOSE.md', `# OA, desglose de todas las peticiones de despues

Generado por \`scripts/oa-desglose.ts\` el ${new Date().toISOString()}, sobre las trazas de las ${RUNS} corridas de despues de \`scripts/oa-od.ts\` (las mismas de [OA-OD_P95_A_TRAZA.md](OA-OD_P95_A_TRAZA.md)).
«Lenta» = span de la API >= 300 ms. Causa: precios >= 300 ms, COMMIT >= 50 ms.

| corrida | peticiones | sin traza en Tempo | lentas | solo precios | precios + COMMIT | solo COMMIT | otra | COMMIT p50 / p95 / máx (ms) | COMMIT >= 50 ms |
|---|---|---|---|---|---|---|---|---|---|
${filas.join('\n')}

Total: ${tot.lentas} lentas; ${tot.porPrecios} solo por precios, ${tot.ambas} por precios y COMMIT, ${tot.porCommit} solo por COMMIT, ${tot.otras} por otra cosa. COMMIT en las ${commits.length} peticiones: mediana ${f1(median(commits))} ms, p95 ${f1(pct(commits, 95))} ms, p99 ${f1(pct(commits, 99))} ms, máx ${f1(Math.max(...commits))} ms (${f0((100 * commits.filter((x) => x >= 50).length) / commits.length)} % >= 50 ms).
`);
