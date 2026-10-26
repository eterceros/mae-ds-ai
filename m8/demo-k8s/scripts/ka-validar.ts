// KA: an AI-generated manifest, unreviewed. What does each tool catch?
//  1. `kubectl apply --dry-run=server` round by round: each round fixes ONLY what the server reported
//     (the server stops at the first error of each object, so new errors appear after each fix).
//  2. kube-linter on the raw file and on the server-clean version.
//  3. ka-2 (passes both tools) is applied for real and observed: what is still broken.
//  4. despues/: 0 errors, 0 findings, and it answers.
// Usage: node scripts/ka-validar.ts   (needs despues/ applied in namespace s11, see README)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, kubectl, kjson, kubeLinter, restarts, readyEndpoints, runLoad, sleep, environment, writeResult } from './lib/k8s.ts';

const NS_KA = 's11-ka';
const RAW = join(ROOT, 'antes', 'ka-1-generado-por-ia.yaml');
const OUT = join(ROOT, 'results', 'raw', 'ka');
mkdirSync(OUT, { recursive: true });

// What a developer does with each server message (only the fix the message asks for).
const FIXES: { when: RegExp; fix: (y: string) => string; what: string }[] = [
  { when: /unmarshal bool into Go struct field ConfigMap\.data/, what: 'ConfigMap: `DEBUG: true` → `"true"`', fix: (y) => y.replace('DEBUG: true', 'DEBUG: "true"') },
  { when: /unmarshal number into Go struct field ConfigMap\.data/, what: 'ConfigMap: `PORT: 3000` → `"3000"`', fix: (y) => y.replace('PORT: 3000', 'PORT: "3000"') },
  { when: /illegal base64/, what: 'Secret: el valor de `data:` pasado a base64', fix: (y) => y.replace('API_KEY: demo-clave-v1 ', `API_KEY: ${Buffer.from('demo-clave-v1').toString('base64')} `) },
  { when: /quantities must match/, what: 'Deployment api: `256mb` → `256Mi`', fix: (y) => y.replace('memory: 256mb', 'memory: 256Mi') },
  { when: /Unsupported value: "HTTP"/, what: 'Service api: `protocol: HTTP` → `TCP`', fix: (y) => y.replace('protocol: HTTP', 'protocol: TCP') },
  { when: /unknown field "spec\.template\.spec\.containers\[0\]\.livenesProbe"/, what: 'Deployment api: errata `livenesProbe` → `livenessProbe`', fix: (y) => y.replace('livenesProbe:', 'livenessProbe:') },
  { when: /does not match template `labels`/, what: 'Deployment api: etiqueta de la plantilla `api-server` → `api`', fix: (y) => y.replace('app: api-server', 'app: api') },
];

kubectl(['delete', 'namespace', NS_KA, '--ignore-not-found', '--wait=true']);
kubectl(['create', 'namespace', NS_KA]);

// 1. Server dry-run, round by round.
let yaml = readFileSync(RAW, 'utf8');
const rounds: { n: number; errors: string[]; fixes: string[] }[] = [];
for (let n = 1; n <= 10; n++) {
  const r = kubectl(['apply', '--dry-run=server', '-f', '-'], { input: yaml, allowFail: true });
  // kubectl prints either `Error from server (...): error when creating ...` or `The X "name" is invalid: ...`.
  const errors = r.err.split('\n').filter((l) => /^Error from server|^The \w+ "[^"]+" is invalid/.test(l))
    .map((l) => l.replace(/^Error from server \((\w+)\): error when creating "STDIN": /, '($1) '));
  const applied: string[] = [];
  for (const e of errors) {
    const f = FIXES.find((x) => x.when.test(e));
    if (!f) throw new Error(`no fix known for: ${e}`);
    yaml = f.fix(yaml); applied.push(f.what);
  }
  rounds.push({ n, errors, fixes: applied });
  console.log(`dry-run round ${n}: ${errors.length} error(s)`);
  if (errors.length === 0) break;
}
writeFileSync(join(OUT, 'ka-1-tras-dry-run.yaml'), yaml);
const serverErrors = rounds.reduce((n, r) => n + r.errors.length, 0);

// 2. kube-linter: on the raw file, on the server-clean version and on ka-2.
const lintRaw = kubeLinter(join(ROOT, 'antes'), 'ka-1-generado-por-ia.yaml');
const lintClean = kubeLinter(OUT, 'ka-1-tras-dry-run.yaml');
const lintKa2 = kubeLinter(join(ROOT, 'antes'), 'ka-2-pasa-los-validadores.yaml');
const dryKa2 = kubectl(['apply', '--dry-run=server', '-f', 'antes/ka-2-pasa-los-validadores.yaml'], { allowFail: true });
console.log(`kube-linter: raw ${lintRaw.length}, after dry-run ${lintClean.length}, ka-2 ${lintKa2.length}`);

// 3. ka-2 for real: wait 90 s and look.
kubectl(['apply', '-f', 'antes/ka-2-pasa-los-validadores.yaml']);
console.log('ka-2 applied; observing for 90 s');
await sleep(90_000);
const pods = kjson(['-n', NS_KA, 'get', 'pods', '-l', 'app']).items.map((p: any) => ({
  app: p.metadata.labels.app,
  ready: (p.status.containerStatuses ?? []).every((c: any) => c.ready),
  restarts: (p.status.containerStatuses ?? []).reduce((m: number, c: any) => m + c.restartCount, 0),
}));
const apiRestarts90 = restarts('app=api', NS_KA);
const svc = kjson(['-n', NS_KA, 'get', 'svc', 'api']);
const unhealthy = [...new Set(kjson(['-n', NS_KA, 'get', 'events', '--field-selector', 'reason=Unhealthy']).items
  .map((e: any) => String(e.message).replace(/\s+/g, ' ')))];
const loadKa2 = await (await runLoad('carga-ka', `http://api.${NS_KA}/cotizacion?producto=p1`, 10, 20, NS_KA)).result();
const apiReady = readyEndpoints('api', NS_KA), preciosReady = readyEndpoints('precios', NS_KA);

// 4. despues/ (already applied in namespace s11).
const dryDespues = kubectl(['apply', '--dry-run=server', '-f', 'despues/'], { allowFail: true });
const lintDespues = kubeLinter(join(ROOT, 'despues'));
const loadDespues = await (await runLoad('carga-ka', 'http://api.s11/cotizacion?producto=p1', 10, 20, 's11')).result();

kubectl(['delete', 'namespace', NS_KA, '--wait=false']);

const esc = (s: string) => s.replace(/\|/g, '\\|');
const byCheck = (l: { check: string }[]) =>
  Object.entries(l.reduce((m: Record<string, number>, x) => (m[x.check] = (m[x.check] ?? 0) + 1, m), {}))
    .map(([k, v]) => `\`${k}\` ×${v}`).join(', ') || '—';
const nPods = (app: string) => pods.filter((p: any) => p.app === app).length;
const nReady = (app: string) => pods.filter((p: any) => p.app === app && p.ready).length;
const reasons = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k}: ${v}`).join(', ') || '—';

const md = `# KA · Manifiesto generado por IA, sin revisar

${environment()}

Archivo de partida: [\`antes/ka-1-generado-por-ia.yaml\`](../antes/ka-1-generado-por-ia.yaml) (6 objetos: ConfigMap, Secret, 2 Deployment, 2 Service). Script: \`node --no-warnings scripts/ka-validar.ts\`. Conteos exactos; la validación es determinista (3 corridas, mismo resultado en los conteos).

## 1. \`kubectl apply --dry-run=server\`, ronda por ronda

El servidor valida cada objeto y se detiene en **su primer error**: al corregir uno puede aparecer el siguiente. En cada ronda se corrigió solo lo que pedía el mensaje.

| Ronda | Mensaje del servidor | Corrección |
|---|---|---|
${rounds.map((r) => r.errors.length
    ? r.errors.map((e, i) => `| ${i === 0 ? `${r.n} (${r.errors.length})` : ''} | ${esc(e).slice(0, 170)} | ${r.fixes[i]} |`).join('\n')
    : `| ${r.n} (0) | todos los objetos: «created (server dry run)» | — |`).join('\n')}

**Total: ${serverErrors} errores en ${rounds.length - 1} rondas** hasta que el servidor acepta el archivo. Resultado: [\`raw/ka/ka-1-tras-dry-run.yaml\`](raw/ka/ka-1-tras-dry-run.yaml).

## 2. kube-linter v0.8.3 (comprobaciones por defecto)

| Sobre | Hallazgos | Por comprobación |
|---|---|---|
| el archivo original (\`ka-1\`) | ${lintRaw.length} | ${byCheck(lintRaw)} |
| la versión que ya acepta el servidor | **${lintClean.length}** | ${byCheck(lintClean)} |
| [\`antes/ka-2-pasa-los-validadores.yaml\`](../antes/ka-2-pasa-los-validadores.yaml) | ${lintKa2.length} | — |

Sobre el archivo original kube-linter **se salta sin avisar** los objetos que no puede decodificar (el ConfigMap con \`DEBUG: true\` y el Deployment \`api\` con \`256mb\`): por eso ve menos. Orden útil: primero el servidor, después el linter.

<details><summary>Hallazgos de kube-linter sobre la versión que acepta el servidor</summary>

${lintClean.map((l) => `- \`${l.check}\` · ${l.obj}`).join('\n')}

</details>

## 3. \`ka-2\`: pasa los dos validadores y no funciona

\`ka-2\` (servidor: ${dryKa2.code === 0 ? 'acepta todo' : 'ERROR'}; kube-linter: ${lintKa2.length} hallazgos) aplicado de verdad en el espacio de nombres \`${NS_KA}\`:

| Qué | Medido | Causa (ningún validador la ve) |
|---|---|---|
| \`precios\` listo a los 90 s | ${nReady('precios')} de ${nPods('precios')} pods; endpoints listos en su Service: ${preciosReady} | readiness a \`/health\`; la app expone \`/salud\` (404) |
| reinicios de \`api\` en 90 s | **${apiRestarts90}** (entre ${nPods('api')} pods) | liveness a \`/salud\`; la app expone \`/salud/vivo\` (404): Kubernetes reinicia el contenedor cada ~30 s |
| Service \`api\` tipo LoadBalancer | EXTERNAL-IP \`${svc.status?.loadBalancer?.ingress?.[0]?.ip ?? '<pending>'}\` | kind no trae balanceador; se entra con Gateway API (KD) o \`port-forward\` |
| 200 peticiones (10/s × 20 s) a \`http://api.${NS_KA}/cotizacion\` desde un pod | **${loadKa2.ok} correctas**, ${loadKa2.fail} fallidas (${reasons(loadKa2.reasons)}) | \`targetPort: 8080\`; el contenedor escucha en 3000 |
| ConfigMap \`api-config\` | no lo lee nadie | el Deployment no tiene \`envFrom\`; \`MONEDA\` no existe |
| Secret con \`data:\` en base64, en el repositorio | aceptado por los dos | base64 no es cifrado (KC); el secreto no va en el repo (S02) |

Mensajes \`Unhealthy\` distintos en los eventos:

${unhealthy.map((e) => `- \`${e}\``).join('\n')}

## 4. \`despues/\`

- \`kubectl apply --dry-run=server -f despues/\`: ${dryDespues.code === 0 ? '**0 errores**' : 'ERROR: ' + dryDespues.err}
- kube-linter sobre \`despues/\`: **${lintDespues.length} hallazgos** (una excepción declarada con su motivo en \`api.yaml\`: \`no-anti-affinity\`, un solo nodo en kind)
- 200 peticiones (10/s × 20 s) a \`http://api.s11/cotizacion\` desde un pod: **${loadDespues.ok} correctas**, ${loadDespues.fail} fallidas

## Cuenta de hallazgos

| Quién lo encontró | Defectos |
|---|---|
| \`--dry-run=server\` | ${serverErrors} |
| kube-linter (después del servidor) | ${lintClean.length} |
| Solo al ejecutar: readiness de \`precios\`, liveness de \`api\`, \`targetPort\`, LoadBalancer, ConfigMap sin uso | 5 |
| Ninguna de las dos: el secreto en el repositorio (lo encuentra \`gitleaks\`, S02) y la clave como valor literal en \`env\` (\`env-var-secret\` de kube-linter solo mira nombres que contienen \`secret\`;\`API_KEY\` no lo dispara) | 2 |
`;
writeResult('KA_VALIDACION.md', md);
writeFileSync(join(OUT, 'ka.json'), JSON.stringify({ rounds, lintRaw, lintClean, lintKa2, pods, apiRestarts90, loadKa2, loadDespues, unhealthy }, null, 2));
