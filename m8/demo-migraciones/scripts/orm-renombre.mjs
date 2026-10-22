// M10: qué SQL generan las herramientas para "renombrar una columna".
//   Prisma 7: se renombra el campo en schema.prisma y `prisma migrate diff` genera la migración.
//   Flyway 13: no genera nada; aplica el SQL versionado que uno escribe (orm/flyway/.../V2__renombrar_telefono.sql).
// En ambos casos se aplica la migración a una base real con 3 filas y se mira qué pasó con los datos.
// Escribe orm/prisma/generado/*.sql y results/ORM.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { cfg, conexion } from './lib/config.mjs';

const RAIZ = path.join(import.meta.dirname, '..');
const DIR_PRISMA = path.join(RAIZ, 'orm', 'prisma');
const DIR_GEN = path.join(DIR_PRISMA, 'generado');
fs.mkdirSync(DIR_GEN, { recursive: true });
const URL_PRISMA = `postgresql://${cfg.user}:${cfg.password}@${cfg.host}:${cfg.port}/orm_prisma`;

function prisma(args) {
  const r = spawnSync(process.execPath, [path.join(RAIZ, 'node_modules', 'prisma', 'build', 'index.js'), ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: URL_PRISMA, NO_COLOR: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  if (r.status !== 0) throw new Error(`prisma ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout.replace(/^Loaded Prisma config.*\n/m, '').trim();
}

const diff = (desde, hasta) =>
  prisma(['migrate', 'diff', '--config', 'orm/prisma/prisma.config.ts', ...desde, ...hasta, '--script']);

async function base(nombre) {
  const a = new pg.Client(conexion('postgres'));
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${nombre}`);
  await a.end();
  const c = new pg.Client(conexion(nombre));
  await c.connect();
  return c;
}

const tabla = (rows) => {
  if (!rows.length) return '(sin filas)';
  const cols = Object.keys(rows[0]);
  return [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${cols.map((k) => r[k] ?? 'NULL').join(' | ')} |`)].join('\n');
};

const L = ['# M10. Renombrar una columna: qué SQL generan Prisma y Flyway', ''];
L.push(`Generado con \`npm run orm\` el ${new Date().toISOString().slice(0, 10)}. Prisma ${prisma(['--version']).match(/prisma\s+:\s+(\S+)/)[1]}; Flyway 13.11.1 (flyway-maven-plugin) con Maven y Java de la máquina.`, '');

// ---------- Prisma ----------
const c = await base('orm_prisma');
const sqlInicial = diff(['--from-empty'], ['--to-schema', 'orm/prisma/1_antes.prisma']);
fs.writeFileSync(path.join(DIR_GEN, '1_inicial.sql'), sqlInicial + '\n');
await c.query(sqlInicial);
await c.query(`INSERT INTO cliente (nombre, telefono) VALUES ('Ana', '70000001'), ('Luis', '70000002'), ('Rosa', NULL)`);
const antesP = (await c.query('SELECT * FROM cliente ORDER BY id')).rows;

const sqlRenombre = diff(['--from-schema', 'orm/prisma/1_antes.prisma'], ['--to-schema', 'orm/prisma/2_renombrar.prisma']);
fs.writeFileSync(path.join(DIR_GEN, '2_renombrar.sql'), sqlRenombre + '\n');
const sqlMap = diff(['--from-schema', 'orm/prisma/1_antes.prisma'], ['--to-schema', 'orm/prisma/3_renombrar_con_map.prisma']);
fs.writeFileSync(path.join(DIR_GEN, '3_renombrar_con_map.sql'), sqlMap + '\n');
await c.query(sqlRenombre);
const despuesP = (await c.query('SELECT * FROM cliente ORDER BY id')).rows;
await c.end();

L.push('## Prisma', '');
L.push('En `orm/prisma/1_antes.prisma` el modelo `Cliente` tiene `telefono`. En `2_renombrar.prisma` el campo se llama `celular`. Comando:', '');
L.push('```', 'npx prisma migrate diff --config orm/prisma/prisma.config.ts --from-schema orm/prisma/1_antes.prisma --to-schema orm/prisma/2_renombrar.prisma --script', '```', '');
L.push('SQL generado (`orm/prisma/generado/2_renombrar.sql`):', '', '```sql', sqlRenombre, '```', '');
L.push('Prisma no puede saber que es un renombre: ve una columna que desaparece y otra que aparece. Datos antes de aplicarlo:', '', tabla(antesP), '', 'Después de aplicarlo:', '', tabla(despuesP), '');
L.push('**Los teléfonos se perdieron.**', '');
L.push('`prisma migrate dev` sí avisa antes de crear la migración cuando hay datos (comprobado a mano con Prisma 7.10.1 sobre una base con 2 filas; no lo corre este script porque el comando es interactivo y en una terminal no interactiva se detiene con un error):', '');
L.push('```text', '⚠️  Warnings for the current datasource:', '', '  • You are about to drop the column `telefono` on the `cliente` table, which still contains 2 non-null values.', '```', '');
L.push('Ese aviso aparece una vez, en la máquina de quien genera la migración. `prisma migrate deploy` en CI o en producción aplica el archivo sin preguntar, y un asistente de IA que genera y aplica la migración puede no mostrarlo.', '');
L.push('Si solo se quiere otro nombre en el código, `@map` conserva la columna (`3_renombrar_con_map.prisma`). SQL generado:', '', '```sql', sqlMap || '(vacío)', '```', '');
L.push('Si de verdad hay que renombrar la columna en la base, se edita a mano la migración generada (`ALTER TABLE "cliente" RENAME COLUMN "telefono" TO "celular";`) y se hace en pasos expand/contract si hay versiones de la aplicación que usan el nombre viejo.', '');

// ---------- Flyway ----------
const f = await base('orm_flyway');
await f.end();
const dirFly = path.join(RAIZ, 'orm', 'flyway');
const urlJdbc = `jdbc:postgresql://${cfg.host}:${cfg.port}/orm_flyway`;
const mvn = spawnSync(`mvn -B --no-transfer-progress -Dflyway.url=${urlJdbc} flyway:migrate flyway:info`, {
  cwd: dirFly,
  encoding: 'utf8',
  shell: true,
});
const salidaCompleta = (mvn.stdout + mvn.stderr).replace(/\x1b\[[0-9;]*m/g, '');
// Solo las líneas de Flyway (sin el ruido de Maven).
const salidaMvn = salidaCompleta
  .split(/\r?\n/)
  .filter((l) => /^(\[(INFO|WARNING|ERROR)\]|[|+])/.test(l)) // la tabla de flyway:info sale sin prefijo
  .map((l) => l.replace(/^\[INFO\] ?/, ''))
  .filter((l) => l.trim() && !/^(-{3,}|Scanning for projects|Building |\s*from pom\.xml|BUILD SUCCESS|Total time|Finished at|--- |-+< |-+\[ pom \]-+)/.test(l))
  .join('\n')
  .trim();
if (mvn.status !== 0) {
  console.error(salidaCompleta);
  throw new Error('mvn flyway:migrate falló');
}
const f2 = new pg.Client(conexion('orm_flyway'));
await f2.connect();
const despuesF = (await f2.query('SELECT * FROM cliente ORDER BY id')).rows;
const historia = (
  await f2.query(`SELECT installed_rank, version, description, type, script, success FROM flyway_schema_history ORDER BY installed_rank`)
).rows;
await f2.end();

L.push('## Flyway', '');
L.push('Flyway no genera SQL: aplica, en orden de versión y una sola vez, los archivos `V<n>__<descripción>.sql` que uno escribe, y lo registra en `flyway_schema_history`. Para el renombre, el SQL es el que decide quien escribe la migración (`orm/flyway/src/main/resources/db/migration/V2__renombrar_telefono.sql`):', '');
L.push('```sql', fs.readFileSync(path.join(dirFly, 'src/main/resources/db/migration/V2__renombrar_telefono.sql'), 'utf8').trim(), '```', '');
L.push('Comando (desde `orm/flyway`):', '', '```', `mvn -Dflyway.url=${urlJdbc} flyway:migrate flyway:info`, '```', '');
L.push('Salida:', '', '```text', salidaMvn || '(sin salida)', '```', '');
L.push('Datos después de V2 (los teléfonos siguen ahí):', '', tabla(despuesF), '', '`flyway_schema_history`:', '', tabla(historia), '');
L.push('## Qué enseña', '');
L.push('- Las herramientas que **generan** migraciones a partir del modelo comparan dos esquemas, y en un esquema no hay "renombres": hay una columna que falta y otra que sobra. Prisma (medido aquí) genera borrar + agregar. drizzle-kit, en cambio, pregunta en la terminal si la columna nueva es un renombre (no se ejecutó en esta demo porque la pregunta es interactiva). En todos los casos hay que **leer el SQL generado** antes de aplicarlo; Squawk en CI ayuda (M9).');
L.push('- Las herramientas que **aplican** SQL escrito a mano (Flyway, Liquibase con SQL, golang-migrate) no se equivocan así, pero tampoco protegen: el SQL es responsabilidad de quien lo escribe.');
L.push('- `RENAME COLUMN` es instantáneo (solo catálogo) pero toma `AccessExclusiveLock` (por eso el `lock_timeout`, ver M8) y rompe a las instancias de la aplicación que aún usan el nombre viejo durante un despliegue gradual: en producción se hace con expand/contract (columna nueva, escribir en ambas, rellenar, cambiar lecturas, borrar la vieja).');
L.push('');
fs.writeFileSync(path.join(RAIZ, 'results', 'ORM.md'), L.join('\n'));
console.log('Escrito results/ORM.md');
