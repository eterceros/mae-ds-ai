// R4: B deja de responder (503) durante FALLA_MS y, en ese mismo momento, llegan N peticiones
// a la vez (como cuando B se reinicia con muchos clientes conectados). Cada una reintenta.
import http from 'k6/http';
import { A, summaryTrendStats, submetricas, guardarResumen } from './comun.js';

const N = Number(__ENV.N || 200);

export const options = {
  summaryTrendStats,
  thresholds: submetricas('fase', ['todo']),
  scenarios: { rafaga: { executor: 'per-vu-iterations', vus: N, iterations: 1, maxDuration: '60s' } },
};

export function setup() {
  http.get(`http://b:3001/admin/fallar?ms=${__ENV.FALLA_MS || 1000}`, { tags: { fase: 'control' } });
}

export default function () {
  http.get(`${A}${__ENV.RUTA}`, { tags: { fase: 'todo' } });
}

export const handleSummary = guardarResumen;
