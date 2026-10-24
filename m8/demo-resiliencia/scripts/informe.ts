// Arma results/ESCENARIOS.md a partir de lo que dejó medir.ts en results/raw/.
// Cada cifra de las tablas es la MEDIANA de las corridas; entre paréntesis, el rango (mín–máx).
//   node scripts/informe.ts   -> vuelve a generar el informe sin medir de nuevo
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { ESCENARIOS, type Escenario } from './escenarios.ts';

const RAW = new URL('../results/raw/', import.meta.url);
const leer = (f: string) => JSON.parse(readFileSync(new URL(f, RAW), 'utf8'));

type Num = number | undefined;
interface Evento { t: number; evento: string }

const mediana = (xs: Num[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const f1 = (x: Num) => (x === undefined ? '-' : x >= 100 ? x.toFixed(0) : x.toFixed(1));
const f0 = (x: Num) => (x === undefined ? '-' : Math.round(x).toString());
const f2 = (x: Num) => (x === undefined ? '-' : x.toFixed(2));
const rango = (xs: Num[], fmt = f1) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length > 1 ? ` (${fmt(Math.min(...v))}–${fmt(Math.max(...v))})` : '';
};
const cel = (xs: Num[], fmt = f1, conRango = false) => fmt(mediana(xs)) + (conRango ? rango(xs, fmt) : '');

// Latencias y % de errores de una submétrica de k6 (por fase o por ruta).
function lat(k: any, etiqueta: string) {
  const d = k.metrics[`http_req_duration{${etiqueta}}`]?.values;
  const f = k.metrics[`http_req_failed{${etiqueta}}`]?.values;
  return { n: d?.count as Num, p50: d?.med as Num, p95: d?.['p(95)'] as Num, p99: d?.['p(99)'] as Num, max: d?.max as Num, err: f ? (f.rate * 100) as Num : undefined };
}

// Cuenta instantes por intervalos de `anchoMs` desde `desde`.
function cubetas(ts: number[], desde: number, anchoMs: number, hastaMs?: number) {
  const c: number[] = [];
  for (const t of ts) {
    if (t < desde || (hastaMs !== undefined && t - desde >= hastaMs)) continue;
    const i = Math.floor((t - desde) / anchoMs);
    c[i] = (c[i] ?? 0) + 1;
  }
  return Array.from(c, (x) => x ?? 0);
}
const entre = (ts: number[], a: number, b: number) => ts.filter((t) => t >= a && t < b).length;

function corridas(e: Escenario) {
  const res: { k: any; a: any; b: any }[] = [];
  for (let n = 1; existsSync(new URL(`${e.id}-${n}-ab.json`, RAW)); n++) {
    const { a, b } = leer(`${e.id}-${n}-ab.json`);
    res.push({ k: leer(`${e.id}-${n}.json`), a, b });
  }
  return res;
}

function versionDocker() {
  const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  return r.stdout?.trim() || '?';
}

export function generarInforme() {
  const filas: string[] = [];
  const p = (s = '') => filas.push(s);
  const esc = (id: string) => ESCENARIOS.find((x) => x.id === id)!;
  const porId = Object.fromEntries(ESCENARIOS.map((e) => [e.id, corridas(e)]));
  const nRondas = Math.max(...Object.values(porId).map((c) => c.length));
  const primera = Object.values(porId).flat()[0];
  const fecha = primera ? new Date(primera.a.marcas?.falla ?? Date.now()).toISOString().slice(0, 10) : '?';

  p('# Demo de resiliencia: resultados medidos (R0–R6)');
  p();
  p(`Generado por \`scripts/informe.ts\` con las corridas de \`scripts/medir.ts\` (${new Date().toISOString().slice(0, 10)}). Máquina: ${os.cpus()[0].model.trim()}, ${os.cpus().length} hilos lógicos, ${Math.round(os.totalmem() / 2 ** 30)} GB de RAM, ${os.type()} ${os.release()}; Docker Desktop con WSL2 (motor ${versionDocker()}). Todo corre en contenedores en la misma máquina: k6 2.3.0 → A (Node 24.22.1) → Toxiproxy 2.13.0 → B (Node 24.22.1); opossum 10.0.0.`);
  void fecha;
  p();
  p(`Cada cifra es la **mediana de ${nRondas} corridas**; entre paréntesis, el rango (mín–máx). Latencias en milisegundos, medidas por k6 desde que envía la petición a A hasta que recibe la respuesta. «% errores» = respuestas de A que no son 2xx más las que k6 abandonó al vencer su propio timeout. Los datos crudos están en \`results/raw/\`.`);
  p();

  // ---------- R0-R3 ----------
  p('## R0–R3. B lento o colgado: sin protección, con timeout y con reintentos');
  p();
  p('Carga a ritmo fijo: 50 peticiones por segundo durante 30 s (modelo abierto: si A se pone lento, las peticiones siguen llegando). En R1–R3, Toxiproxy afecta al 20 % de las conexiones de A a B, elegidas al azar: «lento» = la respuesta de B llega 2 s tarde; «colgado» = la conexión queda abierta y no pasa nada, nunca. A abre una conexión por llamada, así que la falla se decide llamada por llamada. En los casos «colgado», k6 abandona la petición a los 10 s.');
  p();
  p('| Escenario | p50 | p95 | p99 | máx. | % errores | Llamadas a B por petición | Peticiones que recibió B | Máx. en curso en A | Llamadas colgadas en A al terminar |');
  p('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const id of ['R0', 'R1-lento', 'R1-colgado', 'R2-lento', 'R2-colgado', 'R3-lento', 'R3-colgado']) {
    const e = esc(id);
    const cs = porId[id];
    if (!cs.length) continue;
    const L = cs.map((c) => lat(c.k, 'fase:todo'));
    const R = cs.map((c) => c.a.rutas[e.env.RUTA]);
    p(`| **${id}** ${e.titulo} | ${cel(L.map((l) => l.p50))} | ${cel(L.map((l) => l.p95), f1, true)} | ${cel(L.map((l) => l.p99))} | ${cel(L.map((l) => l.max))} | ${cel(L.map((l) => l.err), f1, true)} | ${cel(R.map((r) => r.llamadasAB / r.peticiones), f2)} | ${cel(cs.map((c) => c.b.recibidas), f0)} | ${cel(R.map((r) => r.maxEnCurso), f0)} | ${cel(R.map((r) => r.enCurso), f0)} |`);
  }
  p();
  p('Respuestas de A por motivo (suma de las corridas):');
  p();
  for (const id of ['R1-lento', 'R1-colgado', 'R2-lento', 'R2-colgado', 'R3-lento', 'R3-colgado']) {
    const e = esc(id);
    const suma: Record<string, number> = {};
    for (const c of porId[id]) for (const [m, v] of Object.entries(c.a.rutas[e.env.RUTA].respuestas as Record<string, number>)) suma[m] = (suma[m] ?? 0) + v;
    if (Object.keys(suma).length) p(`- **${id}**: ${Object.entries(suma).map(([m, v]) => `${m}: ${v}`).join('; ')}`);
  }
  p();
  p('«Llamadas colgadas en A al terminar»: llamadas de A a B que seguían abiertas al acabar la carga. k6 ya había abandonado esas peticiones, pero A no se entera y su llamada a B sigue esperando. «Máx. en curso en A»: el máximo de peticiones atendiéndose a la vez en A. En R1-colgado, el «máx.» de latencia es el timeout de k6 (10 s), no el de A, que no tiene.');
  p();

  // ---------- R4 ----------
  p('## R4. Reintentos sin espera, sin jitter y con jitter');
  p();
  p('B responde 503 durante 1 s y, justo en ese momento, llegan 50 peticiones a la vez (como cuando B se reinicia con muchos clientes conectados). Cada petición hace hasta 6 intentos en total, con espera base de 200 ms que se duplica hasta un tope de 2 s (200, 400, 800, 1600, 2000 ms) y plazo de 1 s por intento. «antes» (el cliente de `src/antes/`) reintenta enseguida, sin esperar; sin jitter, todas esperan exactamente lo mismo; con jitter completo, cada una espera al azar entre 0 y ese valor; con jitter «igual», la mitad fija más la mitad al azar.');
  p();
  p('| Variante | % errores | p50 | p95 | máx. | Peticiones que recibió B | Máx. llegadas a B en 50 ms | Máx. de reintentos que llegan a B en 50 ms | Máx. de reintentos en 10 ms | Reintentos |');
  p('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const seriesR4: Record<string, number[]> = {};
  for (const id of ['R4-antes-sin-espera', 'R4-sin-jitter', 'R4-jitter-completo', 'R4-jitter-igual']) {
    const e = esc(id);
    const cs = porId[id];
    if (!cs.length) continue;
    const L = cs.map((c) => lat(c.k, 'fase:todo'));
    const max50 = cs.map((c) => Math.max(...cubetas(c.b.llegadas, c.b.llegadas[0], 50)));
    // Solo los reintentos (intento >= 2): el primer intento llega igual con o sin jitter.
    const reint = (c: any) => (c.b.llegadas as number[]).filter((_, i) => c.b.intentos[i] >= 2);
    const rmax50 = cs.map((c) => Math.max(0, ...cubetas(reint(c), c.b.llegadas[0], 50)));
    const rmax10 = cs.map((c) => Math.max(0, ...cubetas(reint(c), c.b.llegadas[0], 10)));
    // Para la tabla en el tiempo, la corrida cuyo máximo en 50 ms es la mediana.
    const orden = max50.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
    const cMed = cs[orden[Math.floor(orden.length / 2)][1]];
    seriesR4[id] = cubetas(cMed.b.llegadas, cMed.b.llegadas[0], 100, 3200);
    p(`| **${id}** | ${cel(L.map((l) => l.err), f1, true)} | ${cel(L.map((l) => l.p50))} | ${cel(L.map((l) => l.p95))} | ${cel(L.map((l) => l.max))} | ${cel(cs.map((c) => c.b.recibidas), f0, true)} | ${cel(max50, f0, true)} | ${cel(rmax50, f0, true)} | ${cel(rmax10, f0, true)} | ${cel(cs.map((c) => c.a.rutas[e.env.RUTA].reintentos), f0)} |`);
  }
  p();
  if (Object.keys(seriesR4).length) {
    const ancho = Math.max(...Object.values(seriesR4).map((s) => s.length));
    p('Peticiones que llegan a B en cada intervalo de 100 ms, contando desde la primera (una corrida representativa por variante; la columna es el inicio del intervalo en ms):');
    p();
    p(`| Variante | ${Array.from({ length: ancho }, (_, i) => `${i * 100}`).join(' | ')} |`);
    p(`|---|${Array.from({ length: ancho }, () => '---:').join('|')}|`);
    for (const [id, s] of Object.entries(seriesR4)) p(`| ${id} | ${Array.from({ length: ancho }, (_, i) => s[i] ?? 0).join(' | ')} |`);
    p();
  }

  // ---------- R5 ----------
  p('## R5. Circuit breaker (opossum 10) con B colgado o caído');
  p();
  p('50 peticiones por segundo durante 30 s. De los 10 a los 20 s, B falla en todas las llamadas: «colgado» = Toxiproxy acepta la conexión y no deja pasar nada (tóxico `timeout` con `timeout: 0`); «caído» = Toxiproxy cierra el puerto (`enabled: false`) y conectar falla al instante. A llama con plazo de 500 ms. El breaker abre cuando falla más del 50 % de las llamadas (con un mínimo de 10) en la ventana de los últimos 10 s o 2 s, queda abierto 2 s y luego deja pasar una llamada de prueba (semiabierto): si sale bien, cierra; si no, vuelve a abrir.');
  p();
  p('| Variante | Antes: p95 | Falla: p50 | Falla: p95 | Falla: % errores | Llamadas de A a B durante la falla | Después: % errores | Después: p95 | Breaker: ms hasta abrir | Aperturas | ms hasta cerrar tras volver B |');
  p('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const id of ESCENARIOS.filter((x) => x.id.startsWith('R5')).map((x) => x.id)) {
    const e = esc(id);
    const cs = porId[id];
    if (!cs.length) continue;
    const antes = cs.map((c) => lat(c.k, 'fase:antes'));
    const falla = cs.map((c) => lat(c.k, 'fase:falla'));
    const desp = cs.map((c) => lat(c.k, 'fase:despues'));
    const conB = e.env.RUTA.includes('breaker=1');
    const d = cs.map((c) => {
      const { falla: tF, fin: tFin } = c.a.marcas;
      const ev = c.a.breaker.eventos as Evento[];
      const abrir = ev.find((x) => x.evento === 'open' && x.t >= tF);
      const cerrar = ev.find((x) => x.evento === 'close' && x.t >= tFin);
      return {
        llamadasFalla: entre(c.a.rutas[e.env.RUTA].tLlamadas, tF, tFin),
        msAbrir: abrir ? abrir.t - tF : undefined,
        aperturas: ev.filter((x) => x.evento === 'open').length,
        msCerrar: cerrar ? cerrar.t - tFin : undefined,
      };
    });
    const sb = (s: string) => (conB ? s : '-');
    p(`| **${id}** ${e.titulo} | ${cel(antes.map((l) => l.p95))} | ${cel(falla.map((l) => l.p50))} | ${cel(falla.map((l) => l.p95), f1, true)} | ${cel(falla.map((l) => l.err), f1)} | ${cel(d.map((x) => x.llamadasFalla), f0, true)} | ${cel(desp.map((l) => l.err), f1, true)} | ${cel(desp.map((l) => l.p95))} | ${sb(cel(d.map((x) => x.msAbrir), f0, true))} | ${sb(cel(d.map((x) => x.aperturas), f0, true))} | ${sb(cel(d.map((x) => x.msCerrar), f0, true))} |`);
  }
  p();
  p('Unas 500 peticiones llegan a A durante los 10 s de falla. «Llamadas de A a B»: intentos que A lanzó de verdad hacia B (con el circuito abierto, opossum rechaza sin llamar). Los tiempos del breaker se cuentan desde que k6 inyecta la falla y desde que la retira.');
  p();
  for (const id of ['R5-colgado-breaker-10s', 'R5-colgado-breaker-2s', 'R5-caido-breaker-10s', 'R5-caido-breaker-2s']) {
    const c = porId[id]?.[0];
    if (!c) continue;
    const tF = c.a.marcas.falla;
    const nombres: Record<string, string> = { open: 'abre', halfOpen: 'semiabierto', close: 'cierra' };
    const ev = (c.a.breaker.eventos as Evento[]).map((x) => `${nombres[x.evento] ?? x.evento} ${((x.t - tF) / 1000).toFixed(2)} s`);
    p(`Secuencia del breaker en ${id}, corrida 1 (segundos desde que empieza la falla; la falla termina a los 10 s): ${ev.join(' → ')}.`);
    p();
  }

  // ---------- R6 ----------
  p('## R6. Bulkhead: que una dependencia lenta no arrastre a la otra');
  p();
  p('Dos rutas de A al mismo tiempo durante 30 s: `/r6/lento` (30 pet/s; su B tarda 2 s en todas las llamadas) y `/r6/rapido` (50 pet/s; su B está sano). Las dos comparten el pool de conexiones salientes de A, limitado a 20 conexiones; plazo de 2,5 s por llamada (incluye la espera por una conexión libre). Con bulkhead, la ruta lenta acepta como mucho 10 llamadas a la vez y rechaza al instante (503) las que sobran.');
  p();
  p('| Variante | Rápida: p50 | Rápida: p95 | Rápida: % errores | Lenta: p50 | Lenta: p95 | Lenta: % errores | Lenta: rechazadas por el bulkhead | Lenta: timeouts | Lenta: respuestas 200 |');
  p('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const id of ['R6-sin-bulkhead', 'R6-con-bulkhead']) {
    const e = esc(id);
    const cs = porId[id];
    if (!cs.length) continue;
    const rap = cs.map((c) => lat(c.k, 'ruta:rapido'));
    const len = cs.map((c) => lat(c.k, 'ruta:lento'));
    const rl = cs.map((c) => c.a.rutas[`/r6/lento?bulkhead=${e.env.BULKHEAD}`]);
    p(`| **${id}** | ${cel(rap.map((l) => l.p50))} | ${cel(rap.map((l) => l.p95), f1, true)} | ${cel(rap.map((l) => l.err), f1, true)} | ${cel(len.map((l) => l.p50))} | ${cel(len.map((l) => l.p95))} | ${cel(len.map((l) => l.err), f1, true)} | ${cel(rl.map((r) => r.respuestas['503 bulkhead lleno'] ?? 0), f0)} | ${cel(rl.map((r) => r.respuestas['504 timeout'] ?? 0), f0)} | ${cel(rl.map((r) => r.respuestas['200'] ?? 0), f0)} |`);
  }
  p();
  p('## Qué no se midió');
  p();
  p('- **El fragmento de Spring** (`spring/ClienteB.java`: Resilience4j 2.4 y `@Retryable`/`@ConcurrencyLimit` de Spring Framework 7) es equivalente en intención, **no medido**: no se compiló ni se corrió contra esta demo.');
  p('- **Una red real.** A, B, Toxiproxy y k6 corren en la misma máquina, en la red de Docker Desktop. Las fallas son las que inyecta Toxiproxy (latencia fija, conexión colgada, puerto cerrado), no las de una red real (pérdida de paquetes, latencia variable, DNS, TLS).');
  p('- **El costo de cada protección en condiciones normales** (cuánto suma un breaker o un limitador por llamada): es muy pequeño frente a lo medido aquí y no es el tema de la sesión.');
  p('- **Ajuste fino de parámetros.** Los valores (300 ms, 2 reintentos, ventana de 2 o 10 s, límite de 10) son ejemplos razonables para estos tiempos, no recomendaciones; en un sistema real salen de las latencias medidas de B y de lo que el negocio tolera.');
  p('- **Presupuesto de reintentos** (limitar los reintentos a un % de las llamadas) y **propagar el plazo** a B (que B sepa cuánto le queda al cliente): se explican en la sesión, no están en la demo.');
  p('- **Failover, alta disponibilidad, autoescalado o caos en infraestructura**: fuera del alcance de este módulo; aquí la resiliencia está solo en el código de UNA llamada.');
  p();
  writeFileSync(new URL('../results/ESCENARIOS.md', import.meta.url), filas.join('\n'));
  console.log('results/ESCENARIOS.md escrito');
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/informe.ts')) generarInforme();
