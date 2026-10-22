// Corre los escenarios M1–M8. Para cada variante:
//   1. Copia la plantilla demo_base (FILAS filas) a una base nueva, y demo_sonda (1000 filas) a otra.
//   2. En la sonda ejecuta cada paso dentro de una transacción y lee en pg_locks qué bloqueo tomó.
//   3. En la copia grande arranca la carga (lecturas y escrituras a ritmo fijo), mide una línea base,
//      ejecuta la migración paso a paso mientras un monitor consulta pg_locks, y sigue unos segundos.
//   4. Guarda results/json/<escenario>-<variante>.json y regenera results/ESCENARIOS.md.
// Uso: npm run escenarios            (todos)
//      ESCENARIOS=M4,M8 npm run escenarios
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { cfg, conexion, sleep } from './lib/config.mjs';
import { Carga, percentil } from './lib/carga.mjs';
import { Monitor, bloqueosPropios } from './lib/bloqueos.mjs';
import { ESCENARIOS } from './lib/escenarios.mjs';
import { escribirInforme } from './lib/informe.mjs';

const DIR_JSON = path.join(import.meta.dirname, '..', 'results', 'json');
fs.mkdirSync(DIR_JSON, { recursive: true });

async function admin(sql) {
  const c = new pg.Client(conexion('postgres'));
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

async function ejecutar(p, c, ctx) {
  if (p.run) return (await p.run(c, ctx)) ?? null;
  await c.query(p.sql);
  return null;
}

// Paso 2: qué bloqueo toma cada sentencia (en una base pequeña, dentro de una transacción).
async function sondear(variante, dbSonda) {
  const c = new pg.Client({ ...conexion(dbSonda), application_name: 'sonda' });
  await c.connect();
  const res = [];
  for (const p of variante.pasos) {
    try {
      if (p.sonda === false) {
        res.push(null);
      } else if (p.transaccional === false) {
        await ejecutar(p, c, { database: dbSonda, pendientes: [] });
        res.push('no transaccional');
      } else if (p.propiaTransaccion) {
        let modos = null;
        await ejecutar(p, c, { database: dbSonda, pendientes: [], antesDeCommit: async (cc) => (modos = await bloqueosPropios(cc)) });
        res.push(modos);
      } else {
        await c.query('BEGIN');
        await ejecutar(p, c, { database: dbSonda, pendientes: [] });
        res.push(await bloqueosPropios(c));
        await c.query('COMMIT');
      }
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      res.push({ error: e.message });
    }
  }
  await c.end();
  return res;
}

function resumen(regs) {
  const lat = regs.map((r) => r.lat);
  const bloq = regs.filter((r) => r.lat > cfg.umbralBloqueo);
  return {
    n: regs.length,
    p50: percentil(lat, 50),
    p99: percentil(lat, 99),
    max: lat.length ? Math.max(...lat) : null,
    bloqueadas: bloq.length,
    bloqueadasLectura: bloq.filter((r) => r.tipo === 'L').length,
    bloqueadasEscritura: bloq.filter((r) => r.tipo === 'E').length,
    errores: regs.filter((r) => r.err).length,
    codigosError: [...new Set(regs.filter((r) => r.err).map((r) => r.err))],
  };
}

async function correrVariante(esc, variante, ronda) {
  const db = `m8_${esc.id}_${variante.id}`.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  const dbSonda = `${db}_sonda`;
  console.log(`\n== ronda ${ronda} · ${esc.id} ${variante.nombre ?? variante.id}`);
  await admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await admin(`DROP DATABASE IF EXISTS ${dbSonda} WITH (FORCE)`);
  await admin(`CREATE DATABASE ${db} TEMPLATE demo_base STRATEGY FILE_COPY`);
  await admin(`CREATE DATABASE ${dbSonda} TEMPLATE demo_sonda STRATEGY FILE_COPY`);

  const sonda = await sondear(variante, dbSonda);

  // La copia nueva empieza con la caché fría: se carga la tabla y sus índices en shared_buffers
  // para que la línea base no mida lecturas de disco.
  {
    const c = new pg.Client(conexion(db));
    await c.connect();
    await c.query('CREATE EXTENSION IF NOT EXISTS pg_prewarm');
    await c.query(`SELECT pg_prewarm(c.oid::regclass) FROM pg_class c
                    WHERE c.relname IN ('pedidos', 'pedidos_pkey', 'pedidos_cliente_idx', 'pedidos_creado_idx', 'clientes', 'clientes_pkey')`);
    // CHECKPOINT antes de medir, para que la escritura pendiente de la copia no caiga en la línea base.
    await c.query('CHECKPOINT');
    await c.end();
    await sleep(3000);
  }

  const carga = new Carga(db);
  await carga.calentar();
  const mig = new pg.Client({ ...conexion(db), application_name: 'migracion' });
  await mig.connect();
  const monitor = new Monitor(db);
  await monitor.iniciar();
  monitor.pidMigracion = (await mig.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;

  carga.iniciar();
  await sleep(1000 + cfg.antes * 1000); // 1 s de calentamiento que se descarta + línea base
  const ctx = { database: db, pendientes: [] };
  const tIni = carga.ahora();
  const pasos = [];
  let error = null;
  for (const [i, p] of variante.pasos.entries()) {
    monitor.reiniciarPaso();
    const t = performance.now();
    let info = null;
    try {
      info = await ejecutar(p, mig, ctx);
    } catch (e) {
      error = `${p.nombre}: ${e.message}`;
    }
    const ms = performance.now() - t;
    await monitor.muestrear().catch(() => {});
    pasos.push({
      nombre: p.nombre,
      sql: p.sql,
      ms,
      sonda: sonda[i],
      observado: { concedido: monitor.paso.concedido, espera: monitor.paso.espera },
      maxEsperando: monitor.paso.maxEsperando,
      info,
    });
    console.log(`  ${p.nombre}: ${(ms / 1000).toFixed(2)} s${info ? ' ' + JSON.stringify(info) : ''}${error ? ' ERROR ' + error : ''}`);
    if (error) break;
  }
  const tFin = carga.ahora();
  await Promise.all(ctx.pendientes);
  await sleep(cfg.despues * 1000);
  await carga.detener();
  await monitor.detener();
  await mig.end();

  const regs = carga.registros;
  const antes = resumen(regs.filter((r) => r.t >= 1000 && r.t < tIni));
  const durante = resumen(regs.filter((r) => r.t >= tIni && r.t <= Math.max(tFin, tIni + 1000)));
  const afectadas = resumen(regs.filter((r) => r.t >= tIni));
  const resultado = {
    escenario: esc.id,
    variante: variante.id,
    ronda,
    nombreVariante: variante.nombre ?? variante.id,
    filas: cfg.filas,
    ritmo: cfg.ritmo,
    pool: cfg.pool,
    umbralBloqueo: cfg.umbralBloqueo,
    duracionMs: tFin - tIni,
    pasos,
    antes,
    durante,
    desdeInicio: afectadas,
    maxEsperandoLock: monitor.maxEsperando,
    error,
    fecha: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(DIR_JSON, `${esc.id}-${variante.id}-r${ronda}.json`), JSON.stringify(resultado, null, 2));
  console.log(
    `  duración ${(resultado.duracionMs / 1000).toFixed(2)} s · bloqueadas ${afectadas.bloqueadas} (L ${afectadas.bloqueadasLectura} / E ${afectadas.bloqueadasEscritura})` +
      ` · pausa máx ${afectadas.max?.toFixed(0)} ms · p99 antes ${antes.p99?.toFixed(1)} → durante ${durante.p99?.toFixed(1)} ms · errores ${afectadas.errores}`,
  );

  await admin(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  await admin(`DROP DATABASE IF EXISTS ${dbSonda} WITH (FORCE)`);
}

// Ronda por ronda (y no variante por variante), para que una perturbación pasajera de la máquina
// no caiga en todas las mediciones de la misma variante.
for (let ronda = 1; ronda <= cfg.rondas; ronda++) {
  for (const esc of ESCENARIOS) {
    if (cfg.escenarios && !cfg.escenarios.includes(esc.id)) continue;
    for (const v of esc.variantes) await correrVariante(esc, v, ronda);
  }
}
await escribirInforme();
