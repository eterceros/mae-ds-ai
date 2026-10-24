// R6: dos rutas de A a la vez. La "lenta" depende de un B que tarda 2 s; la "rápida", de un B sano.
// Las dos comparten el pool de conexiones salientes de A. ¿La lenta arrastra a la rápida?
import http from 'k6/http';
import { A, summaryTrendStats, submetricas, guardarResumen } from './comun.js';

const BULKHEAD = __ENV.BULKHEAD || '0';
const comun = { executor: 'constant-arrival-rate', timeUnit: '1s', duration: __ENV.DURACION || '30s', preAllocatedVUs: 100, maxVUs: 1000 };

export const options = {
  summaryTrendStats,
  thresholds: submetricas('ruta', ['lento', 'rapido']),
  scenarios: {
    lento: { ...comun, rate: Number(__ENV.RPS_LENTO || 30), exec: 'lento' },
    rapido: { ...comun, rate: Number(__ENV.RPS_RAPIDO || 50), exec: 'rapido' },
  },
};

export function lento() {
  http.get(`${A}/r6/lento?bulkhead=${BULKHEAD}`, { tags: { ruta: 'lento' } });
}
export function rapido() {
  http.get(`${A}/r6/rapido`, { tags: { ruta: 'rapido' } });
}

export const handleSummary = guardarResumen;
