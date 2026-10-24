// K6. Migraciones como servicio que corre una vez antes de la API:
// orden real de arranque, segunda vez (idempotente) y migracion con error.
import { cabecera, docker, dockerOk, guardar, maquina, mediana, rango } from './lib/util.mjs';

const m = maquina();
const N = Number(process.env.RONDAS ?? 3);
const BASE = ['compose', '-f', 'despues/compose.yaml'];
const FALLA = ['compose', '-f', 'despues/compose.yaml', '-f', 'despues/compose.migracion-con-error.yaml'];

function estado(dc, servicio) {
  const id = docker([...dc, 'ps', '-a', '-q', servicio]).out.trim();
  if (!id) return { existe: false };
  const j = JSON.parse(dockerOk(['inspect', id]).out)[0];
  const t = (s) => (s && !s.startsWith('0001') ? Date.parse(s) : null);
  const sano = (j.State.Health?.Log ?? []).find((l) => l.ExitCode === 0);
  return {
    existe: true, estado: j.State.Status, codigo: j.State.ExitCode,
    inicio: t(j.State.StartedAt), fin: t(j.State.FinishedAt), sano: sano ? Date.parse(sano.End) : null,
  };
}
const logs = (dc, s) => docker([...dc, 'logs', '--no-log-prefix', s]).out.trim();
const psql = (sql) => dockerOk([...BASE, 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'tienda', '-At', '-c', sql]).out.trim();

dockerOk([...BASE, 'build', 'migrate']);

// 1) Primera vez, volumen vacio: N corridas para la linea de tiempo.
const lineas = [];
for (let i = 1; i <= N; i++) {
  docker([...BASE, 'down', '-v']);
  const t0 = Date.now();
  const up = docker([...BASE, 'up', '-d', '--wait']);
  const total = Date.now() - t0;
  const pg = estado(BASE, 'postgres'), mi = estado(BASE, 'migrate'), api = estado(BASE, 'api');
  lineas.push({
    up: up.code, total,
    pgSano: pg.sano - pg.inicio, migInicio: mi.inicio - pg.inicio, migFin: mi.fin - pg.inicio,
    migCodigo: mi.codigo, apiInicio: api.inicio - pg.inicio, apiSana: api.sano - pg.inicio,
  });
  console.log(`primera vez #${i}:`, JSON.stringify(lineas.at(-1)));
}
const logPrimera = logs(BASE, 'migrate');
const items = await (await fetch('http://127.0.0.1:18100/items')).json();

// 2) Segunda vez sobre la misma base: migrate vuelve a correr y no aplica nada.
docker([...BASE, 'down']);
const up2 = docker([...BASE, 'up', '-d', '--wait']);
const logSegunda = logs(BASE, 'migrate');
const registro = psql('SELECT archivo FROM schema_migrations ORDER BY 1');

// 3) Migracion con error: migrate sale con 1 y la API no arranca.
docker([...BASE, 'down', '-v']);
const up3 = docker([...FALLA, 'up', '-d', '--wait']);
const mi3 = estado(FALLA, 'migrate'), api3 = estado(FALLA, 'api');
const logFalla = logs(FALLA, 'migrate');
const salidaUp3 = (up3.out + up3.err).trim().split('\n').filter((l) => /migrate|dependency|error/i.test(l)).slice(-3).join('\n');
const registro3 = psql('SELECT archivo FROM schema_migrations ORDER BY 1');
const columnas3 = psql("SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_name = 'items'");
docker([...FALLA, 'down', '-v']);

const med = (k) => { const xs = lineas.map((l) => l[k] / 1000); return `${mediana(xs).toFixed(2)} (${rango(xs)})`; };
const md = `# K6. Migraciones como servicio que corre una vez

${cabecera(m)}

[\`despues/compose.yaml\`](../despues/compose.yaml) tiene tres servicios: \`postgres\` (con healthcheck), \`migrate\` (la misma imagen que la API con \`command: ["node", "dist/migrate.js"]\`, \`depends_on: postgres: service_healthy\`) y \`api\` (\`depends_on: migrate: service_completed_successfully\`). El aplicador de migraciones ([\`api/src/migrate.ts\`](../api/src/migrate.ts)) lleva la cuenta en \`schema_migrations\` y aplica cada archivo en su propia transacción. Es el mismo patrón que en la S06 con Flyway o Prisma: aquí lo que importa es **cuándo** corre.

## 1. Primera vez (volumen vacío), ${N} corridas

Momentos medidos desde que arrancó el contenedor de Postgres (\`docker inspect\`: \`StartedAt\`, \`FinishedAt\` y el primer chequeo de salud correcto), en segundos; mediana y rango.

| Momento | s desde que arranca Postgres |
|---|---:|
| Postgres pasa su healthcheck | ${med('pgSano')} |
| \`migrate\` arranca | ${med('migInicio')} |
| \`migrate\` termina (código ${[...new Set(lineas.map((l) => l.migCodigo))].join(', ')}) | ${med('migFin')} |
| \`api\` arranca | ${med('apiInicio')} |
| \`api\` pasa su healthcheck | ${med('apiSana')} |
| \`docker compose up -d --wait\` devuelve (código ${[...new Set(lineas.map((l) => l.up))].join(', ')}) | ${med('total')} (desde que se lanzó el comando) |

En las ${N} corridas el orden fue el mismo: ${lineas.every((l) => l.migInicio >= l.pgSano && l.apiInicio >= l.migFin) ? 'migrate arrancó después del healthcheck de Postgres y la API después de que migrate terminó' : '**hubo corridas fuera de orden** (ver JSON)'}.

Salida de \`migrate\`:

\`\`\`
${logPrimera}
\`\`\`

\`GET /items\` devolvió ${items.length} filas creadas por la migración.

## 2. Segunda vez sobre la misma base

\`docker compose down\` (sin \`-v\`) y \`up -d --wait\` otra vez (código ${up2.code}). \`migrate\` vuelve a correr, ve que la migración ya está registrada y termina sin hacer nada:

\`\`\`
${logSegunda}
\`\`\`

\`schema_migrations\`: ${registro.split('\n').join(', ')}.

## 3. Una migración con error

Se suma [\`despues/compose.migracion-con-error.yaml\`](../despues/compose.migracion-con-error.yaml), que agrega [\`002_columna_rota.sql\`](../despues/migraciones-con-error/002_columna_rota.sql) (un \`ALTER TABLE ... ADD COLUMN\` y un \`UPDATE\` que usa una columna inexistente).

- \`docker compose up -d --wait\` termina con código **${up3.code}**:

  \`\`\`
  ${salidaUp3.replace(/\n/g, '\n  ')}
  \`\`\`
- \`migrate\`: estado \`${mi3.estado}\`, código de salida **${mi3.codigo}**. Su salida:

  \`\`\`
  ${logFalla.replace(/\n/g, '\n  ')}
  \`\`\`
- \`api\`: ${api3.existe ? `contenedor creado pero **nunca arrancó** (estado \`${api3.estado}\`${api3.inicio ? ', con fecha de inicio' : ', sin fecha de inicio'})` : 'el contenedor ni siquiera se creó'}.
- En la base quedó registrada solo \`${registro3}\` y la tabla \`items\` tiene las columnas \`${columnas3}\`: el \`ADD COLUMN categoria\` de la migración rota se deshizo junto con el \`UPDATE\`, porque iban en la misma transacción.

## Por qué

- **\`service_completed_successfully\`** hace que Compose espere a que \`migrate\` **termine con código 0** antes de arrancar la API. Si termina con otro código, el contenedor de la API queda creado pero no arranca y \`up --wait\` falla: nunca hay una API nueva corriendo sobre un esquema viejo o a medio migrar.
- **Una sola vez y antes**, en lugar de migrar dentro del arranque de la API: si hubiera varias réplicas de la API, todas intentarían migrar a la vez. Con un servicio aparte corre una sola instancia. (En Kubernetes el equivalente es un \`Job\` o un *init container*.)
- **Idempotente**: correr \`migrate\` de nuevo es seguro porque registra lo aplicado; por eso puede ir en cada \`up\`.
- **Transacción por archivo**: en Postgres el DDL es transaccional, así que una migración que falla a la mitad no deja el esquema a medias. Las migraciones que no pueden ir en transacción (\`CREATE INDEX CONCURRENTLY\`, S06) necesitan su propio archivo.
- **Detalle de Compose**: \`docker compose up --wait migrate\` (pedir solo el servicio que termina) devuelve error aunque \`migrate\` salga con 0, porque \`--wait\` espera servicios en ejecución. Para correrlo suelto: \`docker compose run --rm migrate\`.
`;
guardar('K6_MIGRACIONES', md, { maquina: m, lineas, up3: { code: up3.code, salida: salidaUp3 }, mi3, api3 });
