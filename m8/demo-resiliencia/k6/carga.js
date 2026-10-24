// Carga a ritmo fijo (modelo abierto): llegan RPS peticiones por segundo aunque A se ponga lento,
// como pasa con usuarios reales. Con FALLA=colgado|caido, a los 10 s se rompe B y a los 20 s se arregla.
import http from 'k6/http';
import { sleep } from 'k6';
import { A, TOXIPROXY, summaryTrendStats, submetricas, guardarResumen } from './comun.js';

const RUTA = __ENV.RUTA || '/r1';
const RPS = Number(__ENV.RPS || 50);
const DURACION = __ENV.DURACION || '30s';
const FALLA = __ENV.FALLA || ''; // '', 'colgado' o 'caido'
const FASES = FALLA ? ['antes', 'falla', 'despues'] : ['todo'];

export const options = {
  summaryTrendStats,
  thresholds: submetricas('fase', FASES),
  scenarios: {
    carga: {
      executor: 'constant-arrival-rate', rate: RPS, timeUnit: '1s', duration: DURACION,
      preAllocatedVUs: 100, maxVUs: 1000, exec: 'carga',
    },
    ...(FALLA && { control: { executor: 'per-vu-iterations', vus: 1, iterations: 1, startTime: '10s', exec: 'control' } }),
  },
};

export function setup() {
  return { inicio: Date.now() };
}

export function carga(datos) {
  const t = Date.now() - datos.inicio;
  const fase = !FALLA ? 'todo' : t < 10_000 ? 'antes' : t < 20_000 ? 'falla' : 'despues';
  http.get(`${A}${RUTA}`, { tags: { fase }, timeout: __ENV.K6_TIMEOUT || '60s' });
}

// Rompe B durante 10 s a través de la API de Toxiproxy y lo marca en A para ubicar los eventos.
export function control() {
  const json = { headers: { 'content-type': 'application/json' }, tags: { fase: 'control' } };
  http.get(`${A}/admin/marca?nombre=falla`, json);
  if (FALLA === 'colgado') {
    // timeout=0 en el sentido A->B: Toxiproxy acepta la conexión pero la petición nunca llega a B
    // y la conexión no se cierra nunca: B "colgado".
    http.post(`${TOXIPROXY}/proxies/b/toxics`, JSON.stringify({ name: 'colgado', type: 'timeout', stream: 'upstream', attributes: { timeout: 0 } }), json);
  } else {
    // enabled=false: Toxiproxy cierra el puerto; conectar falla al instante (ECONNREFUSED).
    http.post(`${TOXIPROXY}/proxies/b`, JSON.stringify({ enabled: false }), json);
  }
  sleep(10);
  if (FALLA === 'colgado') http.del(`${TOXIPROXY}/proxies/b/toxics/colgado`, null, json);
  else http.post(`${TOXIPROXY}/proxies/b`, JSON.stringify({ enabled: true }), json);
  http.get(`${A}/admin/marca?nombre=fin`, json);
}

export const handleSummary = guardarResumen;
