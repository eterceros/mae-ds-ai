// Crea dos bases plantilla:
//   demo_base  -> FILAS filas (por defecto 10 M); cada variante de cada escenario corre en una copia nueva.
//   demo_sonda -> 1000 filas con el mismo esquema; se usa para leer en pg_locks qué bloqueo toma cada sentencia.
import pg from 'pg';
import { cfg, conexion } from './lib/config.mjs';
import { sqlEsquema, sqlDatos } from './lib/esquema.mjs';

async function crear(nombre, filas, clientes) {
  const admin = new pg.Client(conexion('postgres'));
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${nombre}`);
  await admin.end();
  const c = new pg.Client(conexion(nombre));
  await c.connect();
  const t0 = performance.now();
  // Una sentencia por llamada: VACUUM no puede ir dentro del bloque implícito de varias sentencias.
  // setseed y los INSERT van en la misma sesión, así que la semilla vale para todos.
  const sentencias = (sqlEsquema() + sqlDatos(filas, clientes, cfg.semilla)).split(/;\s*\n/);
  for (const sql of sentencias) {
    if (sql.replace(/--.*$/gm, '').trim()) await c.query(sql);
  }
  const { rows } = await c.query(
    `SELECT pg_size_pretty(pg_total_relation_size('pedidos')) AS tam, (SELECT count(*) FROM pedidos) AS n`,
  );
  await c.end();
  console.log(`${nombre}: ${rows[0].n} filas en pedidos, ${rows[0].tam} con índices, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}

await crear('demo_sonda', 1000, 100);
await crear('demo_base', cfg.filas, cfg.clientes);
