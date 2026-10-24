// Corre los escenarios (RONDAS veces cada uno, 3 por omisión) y guarda en results/raw/
// el resumen de k6 y los contadores de A y B de cada corrida. Al final arma results/ESCENARIOS.md.
//   node scripts/medir.ts            -> todos
//   node scripts/medir.ts R4 R5      -> solo los que empiezan con R4 o R5
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { setTimeout as dormir } from 'node:timers/promises';
import { ESCENARIOS, type Escenario } from './escenarios.ts';
import { generarInforme } from './informe.ts';

const A = 'http://127.0.0.1:18200';
const B = 'http://127.0.0.1:18201';
const TOXI = 'http://127.0.0.1:18210';
const RONDAS = Number(process.env.RONDAS ?? 3);
const RAW = new URL('../results/raw/', import.meta.url);
mkdirSync(RAW, { recursive: true });

async function pedir(url: string, metodo = 'GET', cuerpo?: unknown) {
  const r = await fetch(url, { method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined, headers: { 'content-type': 'application/json' } });
  if (!r.ok) throw new Error(`${metodo} ${url} -> ${r.status} ${await r.text()}`);
  const texto = await r.text(); // Toxiproxy responde 204 sin cuerpo a /reset
  return texto ? JSON.parse(texto) : null;
}

async function preparar(e: Escenario) {
  await pedir(`${TOXI}/reset`, 'POST'); // quita tóxicos y vuelve a habilitar los proxies
  await pedir(`${A}/stats/reset`);
  await pedir(`${B}/stats/reset`);
  for (const t of e.toxicos) await pedir(`${TOXI}/proxies/${t.proxy}/toxics`, 'POST', t.cuerpo);
  await dormir(500);
}

function k6(e: Escenario, salida: string) {
  const env = Object.entries({ ...e.env, SALIDA: salida }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const r = spawnSync('docker', ['compose', 'run', '--rm', '-T', 'k6', 'run', '--quiet', ...env, `/k6/${e.script}`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`k6 falló (${r.status}):\n${r.stdout}\n${r.stderr}`);
}

const filtro = process.argv.slice(2);
const elegidos = ESCENARIOS.filter((e) => !filtro.length || filtro.some((f) => e.id.startsWith(f)));

for (const e of elegidos) {
  for (let ronda = 1; ronda <= RONDAS; ronda++) {
    const salida = `${e.id}-${ronda}`;
    const t0 = Date.now();
    await preparar(e);
    k6(e, salida);
    // Los contadores se leen apenas termina k6 (en R1-colgado importa: muestra lo que quedó colgado en A).
    const stats = { a: await pedir(`${A}/stats`), b: await pedir(`${B}/stats`) };
    writeFileSync(new URL(`${salida}-ab.json`, RAW), JSON.stringify(stats));
    const k = JSON.parse(readFileSync(new URL(`${salida}.json`, RAW), 'utf8'));
    const n = k.metrics.http_reqs?.values?.count;
    console.log(`${salida}: ${((Date.now() - t0) / 1000).toFixed(0)} s, ${n} peticiones de k6, B recibió ${stats.b.recibidas}`);
  }
}
await pedir(`${TOXI}/reset`, 'POST');
generarInforme();
