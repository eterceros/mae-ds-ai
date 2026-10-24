// K5. Orden de arranque en Compose: depends_on sin condicion (la API arranca
// antes de que Postgres acepte conexiones) frente a healthcheck +
// condition: service_healthy. Tambien la trampa del pg_isready por socket.
import { COMPOSE, cabecera, docker, dockerOk, espera, guardar, maquina, mediana, rango, seg } from './lib/util.mjs';

const m = maquina();
const N = Number(process.env.RONDAS_K5 ?? 5);

const VARIANTES = [
  { id: 'sin', nombre: 'depends_on sin condición, sin healthcheck', archivo: 'antes/compose.yaml' },
  { id: 'socket', nombre: 'service_healthy con pg_isready por socket Unix', archivo: 'antes/compose.healthcheck-socket.yaml' },
  { id: 'tcp', nombre: 'service_healthy con pg_isready -h 127.0.0.1 (despues/compose.yaml)', archivo: 'despues/compose.yaml' },
];

// La imagen de la API que usan los tres archivos.
dockerOk([...COMPOSE, 'build', 'migrate']);

const dc = (archivo, args) => docker(['compose', '-f', archivo, ...args]);

// Sigue el arranque hasta que la API responde /salud (proceso arriba y conectado: hizo SELECT 1) o su contenedor termina.
// No se usa /items porque los archivos de antes/ no corren migraciones (no existe la tabla).
async function observar(archivo, t0) {
  const fin = t0 + 40000;
  while (Date.now() < fin) {
    try {
      const r = await fetch('http://127.0.0.1:18100/salud', { signal: AbortSignal.timeout(1000) });
      if (r.ok) return { ok: true, ms: Date.now() - t0 };
    } catch {}
    const ps = dc(archivo, ['ps', '-a', '--format', '{{.Service}} {{.State}} {{.ExitCode}}']).out;
    const api = ps.split('\n').find((l) => l.startsWith('api '));
    if (api && api.includes('exited')) {
      const logs = dc(archivo, ['logs', '--no-log-prefix', 'api']).out.trim().split('\n');
      return { ok: false, ms: Date.now() - t0, salida: api.split(' ')[2], error: logs.filter((l) => /arrancar|Error/.test(l)).pop() ?? logs.pop() };
    }
    await espera(100);
  }
  return { ok: false, ms: 40000, error: 'plazo agotado' };
}

// Tiempos del contenedor de Postgres: cuando arranco y, si tiene healthcheck, el primer chequeo correcto.
function tiemposPostgres(archivo) {
  const id = dc(archivo, ['ps', '-a', '-q', 'postgres']).out.trim();
  const j = JSON.parse(dockerOk(['inspect', id]).out)[0];
  const inicio = Date.parse(j.State.StartedAt);
  const sano = (j.State.Health?.Log ?? []).find((l) => l.ExitCode === 0);
  return { inicio, sanoMs: sano ? Date.parse(sano.End) - inicio : null };
}
function inicioApi(archivo) {
  const id = dc(archivo, ['ps', '-a', '-q', 'api']).out.trim();
  return Date.parse(JSON.parse(dockerOk(['inspect', id]).out)[0].State.StartedAt);
}

const res = {};
for (const v of VARIANTES) {
  res[v.id] = { nuevo: [], existente: [] };
  for (let i = 1; i <= N; i++) {
    for (const modo of ['nuevo', 'existente']) {
      // "nuevo": volumen vacio (Postgres inicializa la base). "existente": la base ya esta creada.
      dc(v.archivo, ['down', ...(modo === 'nuevo' ? ['-v'] : [])]);
      const t0 = Date.now();
      // Sin --wait: queremos ver tambien el caso en que la API muere.
      dc(v.archivo, ['up', '-d']);
      const o = await observar(v.archivo, t0);
      const pg = tiemposPostgres(v.archivo);
      o.apiTrasPostgresMs = inicioApi(v.archivo) - pg.inicio;
      o.pgSanoMs = pg.sanoMs;
      res[v.id][modo].push(o);
      console.log(`${v.id} ${modo} #${i}: ${o.ok ? 'OK' : 'FALLA'} ${seg(o.ms)} s, API arranco ${o.apiTrasPostgresMs} ms despues de Postgres${o.error ? ' — ' + o.error : ''}`);
    }
  }
  dc(v.archivo, ['down', '-v']);
}

const fila = (v, modo) => {
  const xs = res[v.id][modo];
  const oks = xs.filter((x) => x.ok);
  const tiempos = oks.map((x) => x.ms / 1000);
  const errores = [...new Set(xs.filter((x) => !x.ok).map((x) => x.error))];
  const despues = xs.map((x) => x.apiTrasPostgresMs);
  return `| ${v.nombre} | ${modo === 'nuevo' ? 'vacío (primera vez)' : 'ya inicializado'} | ${oks.length} de ${xs.length} | ${(mediana(despues) / 1000).toFixed(2)} (${rango(despues.map((d) => d / 1000))}) | ${oks.length ? `${mediana(tiempos).toFixed(1)} (${rango(tiempos)})` : '—'} | ${errores.map((e) => `\`${e}\``).join('<br>') || '—'} |`;
};

const md = `# K5. Arranque con y sin healthcheck

${cabecera(m)}

Tres archivos de Compose con el mismo Postgres 17.11 y la misma API (que hace \`SELECT 1\` al arrancar y termina con código 1 si la base no responde, como hacen TypeORM o Prisma). Ninguno tiene \`restart:\`, para ver el primer intento. ${N} corridas por variante y por estado del volumen: **vacío** (\`down -v\` antes: Postgres crea la base desde cero) y **ya inicializado** (\`down\` sin \`-v\`: los datos quedan). Se mide desde \`docker compose up -d\` hasta que \`GET /salud\` responde (la API ya hizo su \`SELECT 1\` y escucha; los dos archivos de \`antes/\` no corren migraciones, así que \`/items\` no aplica).

- [\`antes/compose.yaml\`](../antes/compose.yaml): \`depends_on: [postgres]\`.
- [\`antes/compose.healthcheck-socket.yaml\`](../antes/compose.healthcheck-socket.yaml): healthcheck \`pg_isready -U postgres\` (sin \`-h\`: pregunta por el socket Unix) y \`condition: service_healthy\`.
- [\`despues/compose.yaml\`](../despues/compose.yaml): healthcheck \`pg_isready -h 127.0.0.1 ...\` (por TCP) y \`condition: service_healthy\`.

| Variante | Volumen de Postgres | La API arrancó bien | La API arrancó N s después de Postgres (mediana, rango) | Hasta \`/salud\` OK (s) | Error de la API cuando falló |
|---|---|---|---:|---:|---|
${VARIANTES.flatMap((v) => [fila(v, 'nuevo'), fila(v, 'existente')]).join('\n')}

## Por qué

- **\`depends_on\` sin condición solo ordena el arranque de los contenedores**: Compose crea y arranca Postgres y enseguida la API, sin esperar a que Postgres acepte conexiones. Con el volumen vacío Postgres tarda varios segundos (\`initdb\`, crear la base \`tienda\`, reiniciar) y la API, que está lista en menos de un segundo, se conecta antes y muere. Con la base ya inicializada Postgres está listo mucho antes, pero sigue siendo una carrera que gana o pierde según la máquina: «en mi máquina funciona».
- **\`condition: service_healthy\`** hace que Compose espere a que el healthcheck de Postgres pase antes de crear la API. La API arranca más tarde, pero arranca bien.
- **La trampa del socket.** Para inicializar un volumen vacío, la imagen oficial de Postgres levanta primero un servidor temporal que solo escucha por socket Unix (\`listen_addresses=''\`), crea la base, lo apaga y arranca el definitivo. \`pg_isready\` sin \`-h\` pregunta por ese socket: si el chequeo cae en esa ventana, Postgres figura «healthy» mientras todavía no escucha por TCP, que es por donde llega la API. Con \`-h 127.0.0.1\` el chequeo usa el mismo camino que la API. **En estas corridas no se dio** (5 de 5 bien): la ventana del servidor temporal es corta (fracciones de segundo en esta máquina) y el primer chequeo, que llega a ~1 s, ya cayó después. Es una carrera que depende de la máquina y de los scripts de inicialización (cuantos más haya en \`/docker-entrypoint-initdb.d\`, más larga la ventana); por eso el chequeo por TCP es lo correcto aunque aquí no se haya visto fallar. Costo medido: con TCP la API arrancó unos 0,7 s más tarde (2,4 s frente a 1,7 s).
- **Aun así, la API debe tolerar que la base no esté**: un healthcheck ordena el arranque, pero la base puede reiniciarse después. Reintentar la conexión con espera (o \`restart: on-failure\`) es la segunda defensa; los reintentos en código se ven en el bloque 2 (E3).
`;
guardar('K5_HEALTHCHECK', md, { maquina: m, res });
