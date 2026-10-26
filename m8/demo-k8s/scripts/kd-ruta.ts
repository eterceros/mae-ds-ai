// KD: HTTPRoute through the pre-installed Gateway controller (scripts/instalar-gateway.ts).
// Only checks that it routes: /cotizacion -> api, /precios -> precios, anything else -> 404.
// kind has no load balancer, so the Gateway's Service is reached with port-forward on 127.0.0.1:18520.
// Usage: node --no-warnings scripts/kd-ruta.ts
import { kubectl, kjson, portForward, waitFor, environment, writeResult } from './lib/k8s.ts';

const LOCAL = 18520;
const N = 100;

kubectl(['apply', '-f', 'despues/ruta.yaml']);
const tAccepted = await waitFor('HTTPRoute accepted', () => {
  const st = kjson(['-n', 's11', 'get', 'httproute', 'api']).status?.parents?.[0]?.conditions ?? [];
  return st.some((c: any) => c.type === 'Accepted' && c.status === 'True') && st.some((c: any) => c.type === 'ResolvedRefs' && c.status === 'True');
});
const route = kjson(['-n', 's11', 'get', 'httproute', 'api']).status.parents[0].conditions.map((c: any) => `${c.type}=${c.status}`);
const gw = kjson(['-n', 's11', 'get', 'gateway', 'demo']).status.conditions.map((c: any) => `${c.type}=${c.status} (${c.reason})`);

// The controller creates a Deployment + Service for the Gateway in its own namespace.
const sel = 'gateway.envoyproxy.io/owning-gateway-name=demo,gateway.envoyproxy.io/owning-gateway-namespace=s11';
await waitFor('envoy pod ready', () => kjson(['-n', 'envoy-gateway-system', 'get', 'pods', '-l', sel]).items
  .some((p: any) => (p.status.containerStatuses ?? []).every((c: any) => c.ready)), 180_000);
const svc = kjson(['-n', 'envoy-gateway-system', 'get', 'svc', '-l', sel]).items[0];
const svcPort = svc.spec.ports[0].port;
const pf = await portForward(`svc/${svc.metadata.name}`, LOCAL, svcPort, 'envoy-gateway-system');

async function probe(path: string, n: number) {
  const status: Record<string, number> = {};
  const pods = new Set<string>();
  let sample = '';
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${LOCAL}${path}`, { signal: AbortSignal.timeout(2000) });
      const body = await r.text();
      status[r.status] = (status[r.status] ?? 0) + 1;
      try { const j = JSON.parse(body); if (j.pod) pods.add(j.pod); } catch { /* not JSON */ }
      sample ||= body.slice(0, 120);
    } catch (e: any) { status[e?.cause?.code ?? 'error'] = (status[e?.cause?.code ?? 'error'] ?? 0) + 1; }
  }
  return { path, status, pods: pods.size, sample };
}
const results = [await probe('/cotizacion?producto=p2', N), await probe('/precios/p3', N), await probe('/salud/vivo', 20), await probe('/otra-cosa', 20)];
pf.stop();

const fmt = (s: Record<string, number>) => Object.entries(s).map(([k, v]) => `${k}: ${v}`).join(', ');
writeResult('KD_HTTPROUTE.md', `# KD · HTTPRoute con un controlador preinstalado

${environment()}

Controlador: Envoy Gateway v1.9.2, instalado antes por \`scripts/instalar-gateway.ts\` (no se explica en clase). Rutas: [\`despues/ruta.yaml\`](../despues/ruta.yaml). Script: \`node --no-warnings scripts/kd-ruta.ts\`. kind no tiene balanceador: al Service del Gateway (\`${svc.metadata.name}\`, tipo ${svc.spec.type}) se llega con \`kubectl port-forward\` en \`127.0.0.1:${LOCAL}\`.

- HTTPRoute \`api\`: ${route.join(', ')} (en ${(tAccepted / 1000).toFixed(1)} s)
- Gateway \`demo\`: ${gw.join(', ')}

| Petición | Se espera | Respuestas | Pods distintos que respondieron | Muestra |
|---|---|---|---|---|
| \`GET ${results[0].path}\` × ${N} | api (que llama a precios) | ${fmt(results[0].status)} | ${results[0].pods} | \`${results[0].sample}\` |
| \`GET ${results[1].path}\` × ${N} | precios | ${fmt(results[1].status)} | — | \`${results[1].sample}\` |
| \`GET ${results[2].path}\` × 20 | sin ruta: 404 del Gateway | ${fmt(results[2].status)} | — | \`${results[2].sample}\` |
| \`GET ${results[3].path}\` × 20 | sin ruta: 404 del Gateway | ${fmt(results[3].status)} | — | \`${results[3].sample}\` |

Solo se verificó que enruta. No se midió latencia ni nada del controlador.
`);
