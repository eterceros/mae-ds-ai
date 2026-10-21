// Servicio en un contenedor Docker con una red limitada (retardo y ancho de banda con `tc netem`).
// `tc netem` se aplica a lo que SALE del contenedor (las respuestas) desde un contenedor auxiliar
// (nicolaka/netshoot, que solo aporta `tc`) que comparte su red. Lo usan network-bench y stream-bench.
import { execFileSync } from 'node:child_process';

export const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function removeContainer(name) {
  try {
    docker('rm', '-f', name);
  } catch {}
}

// Arranca el servicio en un contenedor y espera a que responda. Falla si ya existe un contenedor con ese nombre
// (no se toca un contenedor ajeno). Arrancar tarda ~1 min porque node_modules se lee desde un volumen de Windows.
export async function startContainer({ root, name, httpPort, grpcPort }) {
  if (docker('ps', '-a', '--filter', `name=^${name}$`, '--format', '{{.Names}}')) {
    throw new Error(`Ya existe un contenedor llamado ${name}; borrelo (docker rm -f ${name}) o cambie el nombre.`);
  }
  const ports = ['-p', `127.0.0.1:${httpPort}:3000`, '-p', `127.0.0.1:${grpcPort}:50051`];
  const env = ['-e', 'HTTP_PORT=3000', '-e', 'GRPC_PORT=50051', '-e', 'HOST=0.0.0.0', '-e', 'HTTP_COMPRESSION=on'];
  docker('run', '-d', '--rm', '--name', name, ...ports, '-v', `${root.replaceAll('\\', '/')}:/app`, '-w', '/app', ...env,
    'node:22-alpine', 'node', 'dist/main.js');
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${httpPort}/stats`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  removeContainer(name); // solo llegamos aqui con un contenedor que acabamos de crear nosotros
  throw new Error('el servicio del contenedor no arranco');
}

export function applyNetem(name, { delayMs, rate }) {
  docker('run', '--rm', '--net', `container:${name}`, '--cap-add', 'NET_ADMIN', 'nicolaka/netshoot',
    'tc', 'qdisc', 'add', 'dev', 'eth0', 'root', 'netem', 'delay', `${delayMs}ms`, 'rate', rate);
}
