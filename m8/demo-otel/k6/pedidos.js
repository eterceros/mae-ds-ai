// Carga para OA y OD: POST /pedidos a ritmo constante.
// Cada petición:
//   - lleva etiquetas de k6 (escenario, corrida) para separar esta prueba de otras en los resultados;
//   - lleva su propio traceparent, así k6 sabe el trace-id de cada petición (etiqueta trace_id) y
//     la petición más lenta de k6 se abre directamente en Tempo. Si la API no está instrumentada,
//     la cabecera se ignora y no cambia nada.
// Uso: docker compose --profile load run --rm k6 run -e RATE=20 -e DURATION=30s /scripts/pedidos.js
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://api-despues:3000';
const ESCENARIO = __ENV.ESCENARIO || 'manual';
const CORRIDA = __ENV.CORRIDA || '1';

export const options = {
  scenarios: {
    pedidos: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 20), timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 30, maxVUs: 100,
    },
  },
  tags: { escenario: ESCENARIO, corrida: CORRIDA },
  summaryTrendStats: ['min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function hex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export default function () {
  const traceId = hex(32);
  const res = http.post(`${BASE_URL}/pedidos`, JSON.stringify({ sku: `sku-${1 + Math.floor(Math.random() * 50)}`, cantidad: 1 }), {
    headers: { 'content-type': 'application/json', traceparent: `00-${traceId}-${hex(16)}-01` },
    tags: { name: 'POST /pedidos', trace_id: traceId },
  });
  check(res, { '201': (r) => r.status === 201 });
}
