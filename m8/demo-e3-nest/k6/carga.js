// Carga para E3: DOS rutas a la vez, a ritmo fijo (modelo abierto), mientras se rompe precios.
//   /pedidos/:id  usa el módulo de precios          (etiqueta ruta=pedidos)
//   /catalogo     NO lo usa: la ruta de control     (etiqueta ruta=catalogo)
// Cada petición lleva su fase (etiqueta fase), según el reloj:
//   calentamiento  [0, CALENTAMIENTO)                  se descarta: Node todavía está optimizando
//   antes          hasta INICIO_FALLA                  precios sano
//   falla          de INICIO_FALLA a FIN_FALLA         precios roto por Toxiproxy (si FALLA=colgado|caido)
//   despues        de FIN_FALLA a DURACION             precios arreglado: ¿se recupera solo?
// INICIO_FALLA, FIN_FALLA y DURACION se cuentan desde el fin del calentamiento.
//
//   docker compose --env-file formas/http.env run --rm k6 run -e FALLA=colgado /k6/carga.js
import http from 'k6/http';
import { sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';
import { API, TOXIPROXY, PROXY, summaryTrendStats, submetricas, guardarResumen } from './comun.js';

const RPS = Number(__ENV.RPS || 50); // peticiones por segundo, EN CADA ruta
const CALENTAMIENTO = Number(__ENV.CALENTAMIENTO || 10); // s
const INICIO_FALLA = Number(__ENV.INICIO_FALLA || 10); // s después del calentamiento
const FIN_FALLA = Number(__ENV.FIN_FALLA || 20);
const DURACION = Number(__ENV.DURACION || 30);
const FALLA = __ENV.FALLA || ''; // '', 'colgado' o 'caido'
const TOTAL = CALENTAMIENTO + DURACION;

// DATOS: k6 no inventa datos; pide ids que EXISTEN. Aquí, del rango 1..N_PRODUCTOS que genera
// la plantilla en memoria (src/precios/precios.service.ts). En su proyecto, cámbienlo por los
// ids de su seed: un rango conocido o un archivo JSON con la lista, p. ej.
//   docker compose ... run --rm k6 run -e IDS=/k6/ids.json /k6/carga.js     (ids.json = [3, 8, 15, ...])
// SharedArray lee el archivo UNA vez y lo comparte entre todos los usuarios virtuales.
const N_PRODUCTOS = Number(__ENV.N_PRODUCTOS || 1000);
const IDS = __ENV.IDS ? new SharedArray('ids', () => JSON.parse(open(__ENV.IDS))) : null;
const idAlAzar = () => (IDS ? IDS[Math.floor(Math.random() * IDS.length)] : 1 + Math.floor(Math.random() * N_PRODUCTOS));

const RUTAS = ['pedidos', 'catalogo'];
const FASES = ['calentamiento', 'antes', 'falla', 'despues'];
// Llamadas de la API a precios en cada fase (sale de GET /stats de la API).
const llamadas = new Counter('llamadas_a_precios');

const ruta = (exec) => ({
  executor: 'constant-arrival-rate', rate: RPS, timeUnit: '1s', duration: `${TOTAL}s`,
  preAllocatedVUs: 50, maxVUs: 500, exec,
});

export const options = {
  summaryTrendStats,
  thresholds: submetricas(RUTAS, FASES),
  scenarios: {
    pedidos: ruta('pedidos'),
    catalogo: ruta('catalogo'),
    // Un solo usuario virtual que marca las fases y, si hay FALLA, rompe y arregla precios.
    control: { executor: 'per-vu-iterations', vus: 1, iterations: 1, exec: 'control', maxDuration: `${TOTAL + 5}s` },
  },
};

const json = { headers: { 'content-type': 'application/json' }, tags: { fase: 'control' } };
const stats = () => http.get(`${API}/stats`, json).json();

export function setup() {
  const s = stats(); // también confirma que la API responde y en qué forma está
  if (s.modo === 'http') http.post(`${TOXIPROXY}/reset`, null, json); // sin fallas de una corrida anterior
  console.log(`Forma: ${s.modo}; falla: ${FALLA || 'ninguna'}; ${RPS} pet/s por ruta; ${TOTAL} s`);
  return { inicio: Date.now(), modo: s.modo, llamadas: s.llamadas };
}

function fase(datos) {
  const t = (Date.now() - datos.inicio) / 1000;
  if (t < CALENTAMIENTO) return 'calentamiento';
  if (t < CALENTAMIENTO + INICIO_FALLA) return 'antes';
  if (t < CALENTAMIENTO + FIN_FALLA) return 'falla';
  return 'despues';
}

export function pedidos(datos) {
  const id = idAlAzar();
  // name agrupa todas las URL /pedidos/<id> bajo una sola en el resumen.
  http.get(`${API}/pedidos/${id}`, { tags: { ruta: 'pedidos', fase: fase(datos), name: '/pedidos/:id' }, timeout: '10s' });
}

export function catalogo(datos) {
  http.get(`${API}/catalogo`, { tags: { ruta: 'catalogo', fase: fase(datos) }, timeout: '10s' });
}

// Rompe precios a través de la API de Toxiproxy y anota cuántas llamadas recibió en cada fase.
export function control(datos) {
  let previo = datos.llamadas;
  const anotar = (nombreFase) => {
    const ahora = stats().llamadas;
    llamadas.add(ahora - previo, { fase: nombreFase });
    previo = ahora;
  };
  const romper = FALLA && datos.modo === 'http';
  if (FALLA && !romper) console.log('Forma en proceso: no hay red que romper; las fases se miden igual.');

  sleep(CALENTAMIENTO);
  anotar('calentamiento');
  sleep(INICIO_FALLA);
  anotar('antes');
  if (romper && FALLA === 'colgado') {
    // timeout=0 en el sentido API->precios: Toxiproxy acepta la conexión, pero la petición nunca
    // llega a precios y la conexión no se cierra: precios "colgado".
    http.post(`${TOXIPROXY}/proxies/${PROXY}/toxics`, JSON.stringify({ name: 'colgado', type: 'timeout', stream: 'upstream', attributes: { timeout: 0 } }), json);
  } else if (romper) {
    // enabled=false: Toxiproxy cierra el puerto; conectar falla al instante (ECONNREFUSED).
    http.post(`${TOXIPROXY}/proxies/${PROXY}`, JSON.stringify({ enabled: false }), json);
  }
  sleep(FIN_FALLA - INICIO_FALLA);
  if (romper && FALLA === 'colgado') http.del(`${TOXIPROXY}/proxies/${PROXY}/toxics/colgado`, null, json);
  else if (romper) http.post(`${TOXIPROXY}/proxies/${PROXY}`, JSON.stringify({ enabled: true }), json);
  anotar('falla');
  sleep(DURACION - FIN_FALLA);
  anotar('despues');
}

export const handleSummary = guardarResumen(RUTAS, FASES);
