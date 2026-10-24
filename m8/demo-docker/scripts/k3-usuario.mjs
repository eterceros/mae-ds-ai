// K3. Usuario root frente a no root: que ve y que puede hacer el proceso
// de la API dentro del contenedor.
import { COMPOSE, RAIZ, cabecera, contextoLimpio, docker, dockerOk, esperarHttp, guardar, join, maquina } from './lib/util.mjs';

const m = maquina();
const ctx = contextoLimpio('k3');
dockerOk([...COMPOSE, 'up', '-d', '--wait', 'postgres']);
dockerOk([...COMPOSE, 'run', '--rm', 'migrate']);

const VARIANTES = [
  { id: 'root', nombre: 'Ingenua (sin USER: root)', dockerfile: 'antes/Dockerfile', img: 's08-docker/k3-root' },
  { id: 'noroot', nombre: 'Referencia (USER node)', dockerfile: 'despues/Dockerfile', img: 's08-docker/k3-noroot' },
];

// Decodifica la mascara de capacidades efectivas de /proc/1/status.
function capacidades(hex) {
  const n = BigInt('0x' + hex);
  let c = 0;
  for (let b = n; b > 0n; b >>= 1n) if (b & 1n) c++;
  return c;
}

const filas = [];
for (const v of VARIANTES) {
  dockerOk(['build', '-q', '-f', join(RAIZ, v.dockerfile), '-t', v.img, ctx]);
  const nombre = `s08-docker-k3-${v.id}`;
  docker(['rm', '-f', nombre]);
  dockerOk(['run', '-d', '--name', nombre, '--network', 's08-docker_default', '-p', '127.0.0.1:18102:3000',
    '-e', 'PGHOST=postgres', '-e', 'PGPASSWORD=demo', '-e', 'PGDATABASE=tienda', v.img]);
  const ok = (await esperarHttp('http://127.0.0.1:18102/salud', 20000)) !== null;
  const ex = (cmd) => docker(['exec', nombre, 'sh', '-c', cmd]);
  const idOut = ex('id').out.trim();
  // Lista de procesos leyendo /proc (la imagen slim no trae ps); se omite el propio sh de la consulta.
  const ps = ex('for p in /proc/[0-9]*; do echo "$(stat -c %U $p) $(basename $p) $(tr "\\0" " " < $p/cmdline)"; done')
    .out.trim().split('\n').filter((l) => !l.includes('/proc/')).join('\n');
  const capHex = ex("grep CapEff /proc/1/status | awk '{print $2}'").out.trim();
  // Intentos de escritura: el codigo de la app, la configuracion del sistema y un binario.
  const prueba = (cmd) => (ex(cmd).code === 0 ? 'sí' : 'no (permiso denegado)');
  const escribeCodigo = prueba('echo "// modificado" >> /app/dist/main.js');
  const escribeEtc = prueba('echo "intruso:x:0:0::/root:/bin/sh" >> /etc/passwd');
  const escribeBin = prueba('cp /bin/sh /usr/local/bin/puerta && chmod +s /usr/local/bin/puerta');
  // Lo que puede hacer quien controla Docker igual: exec -u root.
  const comoRoot = docker(['exec', '-u', 'root', nombre, 'id', '-un']).out.trim();
  docker(['rm', '-f', nombre]);
  filas.push({ ...v, ok, idOut, ps, capHex, caps: capacidades(capHex || '0'), escribeCodigo, escribeEtc, escribeBin, comoRoot });
  console.log(v.id, idOut, capHex, escribeCodigo, escribeEtc, escribeBin);
}

const md = `# K3. Usuario root frente a no root

${cabecera(m)}

Dos imágenes de la misma API: la ingenua de K1 (no declara \`USER\`, así que el proceso corre como root) y la de referencia (\`USER node\`, uid 1000; los archivos de \`/app\` quedan de root). Cada una se arrancó contra el Postgres del stack (responde \`/salud\`: ${filas.map((f) => `${f.id} ${f.ok ? 'sí' : 'no'}`).join(', ')}) y se probó con \`docker exec\` lo que puede hacer **un proceso con los permisos de la API**: lo mismo que podría hacer quien aprovechara una vulnerabilidad de la API para ejecutar comandos.

| | ${filas.map((f) => f.nombre).join(' | ')} |
|---|---|---|
| \`docker exec <c> id\` | ${filas.map((f) => `\`${f.idOut}\``).join(' | ')} |
| Capacidades efectivas del PID 1 (\`CapEff\`) | ${filas.map((f) => `\`${f.capHex}\` (${f.caps} capacidades)`).join(' | ')} |
| Modificar el código de la app (\`/app/dist/main.js\`) | ${filas.map((f) => f.escribeCodigo).join(' | ')} |
| Agregar un usuario a \`/etc/passwd\` | ${filas.map((f) => f.escribeEtc).join(' | ')} |
| Dejar un binario setuid en \`/usr/local/bin\` | ${filas.map((f) => f.escribeBin).join(' | ')} |
| \`docker exec -u root <c> id -un\` | ${filas.map((f) => f.comoRoot).join(' | ')} |

Procesos dentro de cada contenedor (usuario, PID, comando):

${filas.map((f) => `**${f.nombre}**\n\n\`\`\`\n${f.ps}\n\`\`\``).join('\n\n')}

## Por qué

- **Root dentro del contenedor es el uid 0 del kernel**, con un conjunto reducido de capacidades (Docker quita varias por defecto, pero deja ${filas[0].caps}). Si alguien logra ejecutar comandos a través de la API, como root puede reescribir el código, tocar la configuración del sistema del contenedor y dejar herramientas; y si el contenedor tiene montado un directorio del host o el socket de Docker, lo que escriba allí lo escribe como root. Con \`USER node\` el mismo ataque queda limitado a lo que el uid 1000 pueda tocar: ninguna de las tres escrituras de la tabla.
- **Los archivos de la app son de root y el proceso no**, por eso ni siquiera puede modificar su propio código: es un efecto de copiar sin \`--chown\` en el Dockerfile de referencia.
- **La ingenua además tiene \`npm\` como PID 1** (\`CMD ["npm", "run", "start"]\`): npm lanza un \`sh\` que lanza \`node\`. Ese detalle (señales y apagado) se vio en la S02.
- **No root no protege del operador**: quien controla el demonio de Docker entra como root con \`docker exec -u root\`. Protege del proceso comprometido, que es lo que importa.
`;
guardar('K3_USUARIO', md, { maquina: m, filas });
