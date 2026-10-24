// K7. Dockerfiles generados por IA, revisados con hadolint y Trivy/Scout.
// Dos generadores con el mismo pedido (ia/prompt.txt): un modelo local chico
// (ai/smollm2 en Docker Model Runner) y Gordon (el asistente de Docker Desktop).
import { readFileSync } from 'node:fs';
import { COMPOSE, cabecera, contextoLimpio, docker, dockerOk, esperarHttp, guardar, join, maquina, RAIZ, tamanos } from './lib/util.mjs';
import { scout, trivy, TRIVY } from './lib/escaneo.mjs';

const HADOLINT = 'hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d';
const m = maquina();
const ctx = contextoLimpio('k7');

const ARCHIVOS = [
  { id: 'smollm2', nombre: 'IA local: ai/smollm2 (sin revisar)', ruta: 'antes/Dockerfile.ia-smollm2' },
  { id: 'gordon', nombre: 'Gordon (sin revisar)', ruta: 'antes/Dockerfile.ia-gordon' },
  { id: 'gordon-revisado', nombre: 'Gordon, revisado a mano', ruta: 'despues/Dockerfile.ia-gordon-revisado' },
  { id: 'ingenuo', nombre: 'Ingenuo de K1', ruta: 'antes/Dockerfile' },
  { id: 'referencia', nombre: 'Referencia (despues/Dockerfile)', ruta: 'despues/Dockerfile' },
];

// hadolint lee el Dockerfile por la entrada estandar.
function hadolint(ruta) {
  const r = docker(['run', '--rm', '-i', HADOLINT, 'hadolint', '--no-color', '-'], { input: readFileSync(join(RAIZ, ruta), 'utf8') });
  const lineas = r.out.trim().split('\n').filter(Boolean).map((l) => l.replace(/^-:/, 'línea '));
  return { codigo: r.code, lineas };
}

// Trivy en modo "config": reglas de configuracion insegura del Dockerfile.
function trivyConfig(ruta) {
  const dir = join(RAIZ, ruta, '..');
  const archivo = ruta.split('/').pop();
  const r = docker(['run', '--rm', '-v', `${dir}:/src:ro`, '-v', 's08-docker-trivy-cache:/root/.cache', TRIVY,
    'config', '--quiet', '--format', 'json', '--file-patterns', `dockerfile:${archivo.replace(/\./g, '\\.')}$`, '/src']);
  try {
    const j = JSON.parse(r.out);
    const res = (j.Results ?? []).find((x) => x.Target === archivo);
    return (res?.Misconfigurations ?? []).map((x) => `${x.ID} (${x.Severity}): ${x.Title}`);
  } catch { return [`error: ${(r.err || r.out).slice(-200)}`]; }
}

dockerOk([...COMPOSE, 'up', '-d', '--wait', 'postgres']);
dockerOk([...COMPOSE, 'run', '--rm', 'migrate']);

const filas = [];
for (const a of ARCHIVOS) {
  const h = hadolint(a.ruta);
  const tc = trivyConfig(a.ruta);
  const img = `s08-docker/k7-${a.id}`;
  const b = docker(['build', '-q', '-f', join(RAIZ, a.ruta), '-t', img, ctx]);
  const fila = { ...a, h, tc, construye: b.code === 0, errorBuild: b.code === 0 ? null : (b.err.trim().split('\n').find((l) => /ERROR|error/.test(l)) ?? b.err.trim().split('\n').pop()) };
  if (fila.construye) {
    fila.t = tamanos(img);
    fila.usuario = dockerOk(['image', 'inspect', img, '--format', '{{.Config.User}}']).out.trim() || 'root';
    // ¿El proceso puede reescribir su propio codigo? (K3)
    docker(['rm', '-f', 's08-docker-k7']);
    dockerOk(['run', '-d', '--name', 's08-docker-k7', '--network', 's08-docker_default', '-p', '127.0.0.1:18103:3000',
      '-e', 'PGHOST=postgres', '-e', 'PGPASSWORD=demo', '-e', 'PGDATABASE=tienda', img]);
    fila.arranca = (await esperarHttp('http://127.0.0.1:18103/salud', 20000)) !== null;
    fila.escribeCodigo = docker(['exec', 's08-docker-k7', 'sh', '-c', 'echo "//x" >> dist/main.js']).code === 0;
    docker(['rm', '-f', 's08-docker-k7']);
    fila.trivy = trivy(img);
    fila.scout = scout(img);
  }
  filas.push(fila);
  console.log(a.id, 'hadolint:', h.lineas.length, 'trivy config:', tc.length, 'construye:', fila.construye, fila.errorBuild ?? '');
}

const sc = (s) => (!s ? '—' : s.error ? `error: ${s.error}` : `${s.C}C ${s.H}H ${s.M}M ${s.L}L`);
const tv = (t) => (!t ? '—' : t.error ? 'error' : `${t.total} (${t.CRITICAL}C ${t.HIGH}H ${t.MEDIUM}M ${t.LOW}L)`);
const md = `# K7. Un Dockerfile generado por IA, revisado con hadolint y Trivy

${cabecera(m)} hadolint 2.15.1 y Trivy 0.76.1 en contenedor (fijados por digest).

El mismo pedido ([\`ia/prompt.txt\`](../ia/prompt.txt)) a dos asistentes:

- **ai/smollm2** (361 M de parámetros, Docker Model Runner, local y sin costo), \`temperature: 0\`, \`max_tokens: 700\`. Respuesta cruda en [\`ia/respuesta-smollm2.json\`](../ia/respuesta-smollm2.json).
- **Gordon** (\`docker ai\`, Docker Desktop 4.96, CLI ${dockerOk(['ai', 'version']).out.trim().split(' ')[0]}). Gordon pidió permiso para listar y leer los archivos del proyecto; se le negó (corrió sin terminal), así que respondió solo con el texto del pedido. Respuesta cruda en [\`ia/respuesta-gordon.txt\`](../ia/respuesta-gordon.txt). Gordon usa un modelo en la nube que Docker no detalla en la CLI \`[por verificar]\`, y su respuesta cambia de una vez a otra.

Los Dockerfiles se copiaron tal cual ([\`antes/Dockerfile.ia-smollm2\`](../antes/Dockerfile.ia-smollm2), [\`antes/Dockerfile.ia-gordon\`](../antes/Dockerfile.ia-gordon)). Para comparar se revisan también el ingenuo de K1, la referencia y la versión de Gordon corregida a mano después de leer los avisos ([\`despues/Dockerfile.ia-gordon-revisado\`](../despues/Dockerfile.ia-gordon-revisado)).

| Dockerfile | Avisos de hadolint | Avisos de \`trivy config\` | ¿Construye? | Tamaño en disco | Usuario | ¿Arranca? | ¿El proceso puede reescribir su código? | Trivy (CVE en la imagen) | Docker Scout |
|---|---:|---:|---|---:|---|---|---|---|---|
${filas.map((f) => `| ${f.nombre} | ${f.h.lineas.length} | ${f.tc.length} | ${f.construye ? 'sí' : 'no'} | ${f.t?.disco ?? '—'} | ${f.usuario ?? '—'} | ${f.construye ? (f.arranca ? 'sí' : 'no') : '—'} | ${f.construye ? (f.escribeCodigo ? '**sí**' : 'no') : '—'} | ${tv(f.trivy)} | ${sc(f.scout)} |`).join('\n')}

## Lo que dijo cada herramienta

${filas.map((f) => `### ${f.nombre}

hadolint (código de salida ${f.h.codigo}):

\`\`\`
${f.h.lineas.join('\n') || '(sin avisos)'}
\`\`\`

\`trivy config\`: ${f.tc.length ? '\n\n' + f.tc.map((x) => `- ${x}`).join('\n') : 'sin avisos.'}
${f.construye ? '' : `\nBuild: **falla** — \`${f.errorBuild}\`\n`}`).join('\n')}

## Qué muestra

- **El modelo local chico no sirve para esto.** smollm2 inventó una imagen base que no existe (\`nest:v2.10.0\`) y repitió la misma línea hasta agotar los tokens; el build falla en la primera instrucción. Un modelo de 361 M sirve para probar la mecánica de E4 sin gastar tokens, no para generar infraestructura.
- **Gordon produjo algo razonable a primera vista**: multi-stage, Alpine, \`npm ci\`, \`--omit=dev\`, \`USER node\`, forma exec en \`CMD\`. Los problemas son los que no se ven sin revisar: base con etiqueta flotante (\`node:24-alpine\`) y sin digest, \`--chown=node:node\` en \`dist/\` (el proceso **puede reescribir su propio código**, lo contrario de K3) y la etapa final vuelve a ejecutar \`npm ci\` en lugar de copiar dependencias de una etapa ya construida. Como usa la misma base que la variante Alpine de K2, tiene las mismas 16 CVE: revisar no cambia eso, cambia el permiso de escritura y la reproducibilidad.
- **hadolint encontró poco de lo que importa.** En los cinco archivos solo dio avisos de forma: \`DL3059\` (varias \`RUN\` seguidas), \`DL3016\` (\`npm install -g\` sin versión) y \`DL3066\` (usuario no numérico: con un nombre, Kubernetes no puede comprobar \`runAsNonRoot\`). **No avisó** que el ingenuo corre como root (su regla \`DL3002\` solo salta si hay un \`USER root\` explícito), ni que \`node:24\` es una etiqueta flotante (\`DL3006\` solo salta si no hay etiqueta), ni que la base de smollm2 no existe, ni el \`--chown\`.
- **\`trivy config\` vio el root** (\`DS-0002\`, en el ingenuo y en el de smollm2) y la falta de \`HEALTHCHECK\` (\`DS-0026\`, en todos: aquí el healthcheck está en \`compose.yaml\`, así que ese aviso es esperable). **Trivy/Scout sobre la imagen** miran lo que quedó dentro (CVE de paquetes), no cómo se construyó.
- **Ninguna herramienta detectó el \`--chown\` sobre el código**: lo encuentra una persona que revisa o una prueba como la de K3. Lo generado por la IA se lee, se pasa por el linter y el escáner y se prueba, igual que un PR de un colega.
`;
guardar('K7_IA', md, { maquina: m, filas });
