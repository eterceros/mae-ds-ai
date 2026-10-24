// Borra todo lo que crea la demo: contenedores y volumenes del proyecto
// s08-docker, las imagenes s08-docker/*, la cache de Trivy y .tmp/.
// No toca nada que no sea de la demo.
import { rmSync } from 'node:fs';
import { COMPOSE, docker, join, RAIZ, TMP } from './lib/util.mjs';

docker([...COMPOSE, 'down', '-v', '--remove-orphans']);
docker(['compose', '-f', join(RAIZ, 'antes', 'compose.yaml'), 'down', '-v', '--remove-orphans']);
for (const c of ['s08-docker-k2', 's08-docker-k3-root', 's08-docker-k3-noroot', 's08-docker-k4', 's08-docker-k7']) docker(['rm', '-f', c]);
const imagenes = docker(['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', 's08-docker/*']).out.trim().split('\n').filter(Boolean);
if (imagenes.length) docker(['image', 'rm', '-f', ...imagenes]);
docker(['volume', 'rm', 's08-docker-trivy-cache']);
rmSync(TMP, { recursive: true, force: true });
console.log(`borradas ${imagenes.length} imagenes s08-docker/*, contenedores, volumenes y .tmp/`);
