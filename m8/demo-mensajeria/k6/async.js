// Q7: la misma carga contra 202 Accepted + cola + worker. Mide solo la respuesta de la API;
// el tiempo hasta "done" lo mide scripts/q7-e4.ts leyendo summary_jobs.
import http from 'k6/http';
import { check } from 'k6';

const RATE = Number(__ENV.RATE || 5);
export const options = {
  scenarios: {
    async: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '30s', preAllocatedVUs: 20, maxVUs: 200 },
  },
  summaryTrendStats: ['med', 'p(95)', 'max'],
};
const TEXT = 'Order 42: three books were paid by card and shipped to Cochabamba with express delivery.';

export default function () {
  const r = http.post(`${__ENV.BASE_URL}/async/summaries`, JSON.stringify({ text: TEXT.replace('42', String(__VU * 100000 + __ITER)) }), {
    headers: { 'content-type': 'application/json' }, timeout: '20s', tags: { name: 'async' },
  });
  check(r, { '202': (x) => x.status === 202, 'location': (x) => !!x.headers['Location'] });
}

export function handleSummary(data) {
  return { [`/out/async-${__ENV.TAG || RATE}.json`]: JSON.stringify(data) };
}
