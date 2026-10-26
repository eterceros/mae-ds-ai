// KC: Secret as an environment variable (antes/kc-secreto-en-variable.yaml) vs mounted as a file
// (despues/api.yaml), and "base64 is not encryption".
//  1. base64: whoever can `get` the Secret reads the value with one decode.
//  2. Where the value shows up: `env` inside the container and the Pod definition.
//  3. Rotation: the Secret changes; how long until each pod sees the new value (polled every 1 s).
// The app only ever returns a SHA-256 fingerprint of the value (/config), never the value.
// Usage: node --no-warnings scripts/kc-secretos.ts [rotations=3]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, kubectl, kjson, sleep, median, environment, writeResult } from './lib/k8s.ts';

const ROTATIONS = Number(process.argv[2] ?? 3);
const WAIT_MAX = 180; // seconds to wait for a pod to see the new value
const RAW = join(ROOT, 'results', 'raw', 'kc');
mkdirSync(RAW, { recursive: true });
const fp = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 8);

function setSecret(value: string) {
  const y = kubectl(['-n', 's11', 'create', 'secret', 'generic', 'api-secretos', `--from-literal=API_KEY=${value}`, '--dry-run=client', '-o', 'yaml']).out;
  kubectl(['apply', '-f', '-'], { input: y });
}
const podsOf = (app: string) => kjson(['-n', 's11', 'get', 'pods', '-l', `app=${app}`, '--field-selector=status.phase=Running']).items.map((p: any) => p.metadata.name as string);
function config(pod: string) {
  const r = kubectl(['-n', 's11', 'exec', pod, '--', 'node', '-e',
    "fetch('http://127.0.0.1:3000/config').then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"], { allowFail: true });
  return r.code === 0 ? JSON.parse(r.out) : null;
}

// Start from a known value and fresh pods.
setSecret('demo-clave-v0');
kubectl(['apply', '-f', 'despues/api.yaml', '-f', 'antes/kc-secreto-en-variable.yaml']);
kubectl(['-n', 's11', 'rollout', 'restart', 'deployment/api', 'deployment/api-variable']);
kubectl(['-n', 's11', 'rollout', 'status', 'deployment/api', '--timeout=180s']);
kubectl(['-n', 's11', 'rollout', 'status', 'deployment/api-variable', '--timeout=180s']);
await sleep(5000);

// 1. base64 is not encryption.
const stored = kubectl(['-n', 's11', 'get', 'secret', 'api-secretos', '-o', 'jsonpath={.data.API_KEY}']).out;
const decoded = Buffer.from(stored, 'base64').toString('utf8');

// 2. Where the value shows up (searched for literally; only yes/no is reported).
const [podVar] = podsOf('api-variable');
const [podFile] = podsOf('api');
const envVar = kubectl(['-n', 's11', 'exec', podVar, '--', 'env']).out.includes(decoded);
const envFile = kubectl(['-n', 's11', 'exec', podFile, '--', 'env']).out.includes(decoded);
const procVar = kubectl(['-n', 's11', 'exec', podVar, '--', 'cat', '/proc/1/environ']).out.includes(decoded);
const specVar = kubectl(['-n', 's11', 'get', 'pod', podVar, '-o', 'yaml']).out.includes(decoded);
const specFile = kubectl(['-n', 's11', 'get', 'pod', podFile, '-o', 'yaml']).out.includes(decoded);
const fileFile = kubectl(['-n', 's11', 'exec', podFile, '--', 'cat', '/etc/secretos/API_KEY']).out.includes(decoded);

// 3. Rotations.
const rot: any[] = [];
for (let i = 1; i <= ROTATIONS; i++) {
  const value = `demo-clave-v${i}`;
  const target = fp(value);
  const pods = [...podsOf('api').map((p) => ({ pod: p, kind: 'archivo' as const })), ...podsOf('api-variable').map((p) => ({ pod: p, kind: 'variable' as const }))];
  const seen: Record<string, number | null> = Object.fromEntries(pods.map((p) => [p.pod, null]));
  setSecret(value);
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < WAIT_MAX && pods.some((p) => p.kind === 'archivo' && seen[p.pod] === null)) {
    for (const p of pods) {
      if (seen[p.pod] !== null) continue;
      const c = config(p.pod);
      const got = p.kind === 'archivo' ? c?.clave_archivo : c?.clave_variable;
      if (got === target) seen[p.pod] = Math.round((Date.now() - t0) / 100) / 10;
    }
    await sleep(1000);
  }
  // Give the env-var pod the same chance, then check it once more at WAIT_MAX.
  while ((Date.now() - t0) / 1000 < WAIT_MAX) await sleep(1000);
  for (const p of pods.filter((x) => x.kind === 'variable')) {
    if (config(p.pod)?.clave_variable === target) seen[p.pod] = WAIT_MAX;
  }
  // The env-var pod only sees the new value after a restart.
  const tr = Date.now();
  kubectl(['-n', 's11', 'rollout', 'restart', 'deployment/api-variable']);
  kubectl(['-n', 's11', 'rollout', 'status', 'deployment/api-variable', '--timeout=180s']);
  await sleep(2000);
  const after = podsOf('api-variable').map((p) => config(p)?.clave_variable === target);
  const r = {
    rotation: i,
    file: pods.filter((p) => p.kind === 'archivo').map((p) => seen[p.pod]),
    variable: pods.filter((p) => p.kind === 'variable').map((p) => seen[p.pod]),
    variableAfterRestart: after.every(Boolean), restartSecs: Math.round((Date.now() - tr) / 100) / 10,
  };
  rot.push(r); console.log(JSON.stringify(r));
}
setSecret('demo-clave-v1');
kubectl(['-n', 's11', 'delete', 'deployment', 'api-variable', '--wait=false']);
writeFileSync(join(RAW, 'kc.json'), JSON.stringify({ stored, envVar, envFile, procVar, specVar, specFile, fileFile, rot }, null, 2));

const fileTimes = rot.flatMap((r) => r.file as number[]);
const yes = (b: boolean) => (b ? '**sí**' : 'no');
writeResult('KC_SECRETOS.md', `# KC · Secret como variable o como archivo; base64 no es cifrado

${environment()}

Script: \`node --no-warnings scripts/kc-secretos.ts\`. Secret \`api-secretos\` (clave \`API_KEY\`, valores de demostración \`demo-clave-vN\`) creado con \`kubectl create secret generic … --from-literal\`, no desde un archivo del repositorio. La app nunca devuelve el valor: \`/config\` da sus primeros 8 caracteres de SHA-256.

- **variable** · [\`antes/kc-secreto-en-variable.yaml\`](../antes/kc-secreto-en-variable.yaml): \`env.valueFrom.secretKeyRef\` (1 pod)
- **archivo** · [\`despues/api.yaml\`](../despues/api.yaml): volumen \`secret\` en \`/etc/secretos\` y la app lee \`/etc/secretos/API_KEY\` en cada uso (2 pods)

## 1. base64 no es cifrado

\`kubectl get secret api-secretos -o jsonpath='{.data.API_KEY}'\` devuelve \`${stored}\`; decodificado con \`base64 -d\` da el valor original: ${decoded === 'demo-clave-v0' ? '**sí, idéntico**' : 'NO'}. Un solo comando, sin clave: cualquiera con permiso de leer Secrets en el espacio de nombres (o con el YAML en el repo) tiene el valor.

## 2. Dónde aparece el valor (búsqueda literal)

| Dónde | variable | archivo |
|---|---|---|
| \`kubectl exec … -- env\` | ${yes(envVar)} | ${yes(envFile)} |
| \`/proc/1/environ\` del contenedor (lo hereda cualquier proceso hijo) | ${yes(procVar)} | — |
| \`kubectl get pod … -o yaml\` | ${yes(specVar)} | ${yes(specFile)} |
| \`kubectl exec … -- cat /etc/secretos/API_KEY\` | — | ${yes(fileFile)} |

Con \`exec\` se lee igual de las dos formas: el archivo no protege contra quien entra al contenedor. Lo que evita es que el valor viaje en el entorno (volcados de \`env\`, procesos hijos, mensajes de error que imprimen el entorno).

## 3. Cambiar el Secret (${ROTATIONS} rotaciones, sondeo cada 1 s)

| Rotación | archivo: segundos hasta ver el valor nuevo (por pod) | variable: ¿lo ve a los ${WAIT_MAX} s? | variable tras \`kubectl rollout restart\` |
|---|---|---|---|
${rot.map((r) => `| ${r.rotation} | ${r.file.map((x: number | null) => x ?? `> ${WAIT_MAX}`).join(' · ')} | ${r.variable.every((x: number | null) => x === null) ? '**no**' : 'sí'} | ${r.variableAfterRestart ? 'sí' : 'no'} (reinicio en ${r.restartSecs} s) |`).join('\n')}

**Archivo: mediana ${median(fileTimes)} s (rango ${Math.min(...fileTimes)}–${Math.max(...fileTimes)} s, ${fileTimes.length} observaciones), sin reiniciar. Variable: nunca, hasta reiniciar el pod.** El retraso del archivo lo fija el kubelet (sincronización periódica), no la app; por eso la app lee el archivo en cada uso en vez de copiarlo al arrancar.

No se midió: un volumen montado con \`subPath\` tampoco se actualiza (documentado por Kubernetes).
`);
