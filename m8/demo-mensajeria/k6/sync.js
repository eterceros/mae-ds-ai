// Q7: carga constante contra la llamada SÍNCRONA al LLM. k6 solo como evidencia (no se optimiza).
import http from 'k6/http';
import { check } from 'k6';

const RATE = Number(__ENV.RATE || 5);
export const options = {
  scenarios: {
    sync: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '30s', preAllocatedVUs: 50, maxVUs: 400 },
  },
  summaryTrendStats: ['med', 'p(95)', 'max'],
};
const TEXT = 'Order 42: three books were paid by card and shipped to Cochabamba with express delivery.';

export default function () {
  const r = http.post(`${__ENV.SYNC_BASE_URL}/sync/summaries`, JSON.stringify({ text: TEXT.replace('42', String(__VU * 100000 + __ITER)) }), {
    headers: { 'content-type': 'application/json' }, timeout: '20s', tags: { name: 'sync' },
  });
  check(r, { '200': (x) => x.status === 200, '504': (x) => x.status === 504 });
}

export function handleSummary(data) {
  return { [`/out/sync-${RATE}.json`]: JSON.stringify(data) };
}
