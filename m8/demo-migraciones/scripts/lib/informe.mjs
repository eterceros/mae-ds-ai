// Genera results/ESCENARIOS.md a partir de results/json/*.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { cfg, conexion } from './config.mjs';
import { ESCENARIOS } from './escenarios.mjs';
import { masFuerte, formatoModos } from './bloqueos.mjs';

const RAIZ = path.join(import.meta.dirname, '..', '..');
const DIR_JSON = path.join(RAIZ, 'results', 'json');

const s = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(ms < 100 ? 3 : 2));
const m = (ms) => (ms == null ? '—' : ms < 10 ? ms.toFixed(1) : ms.toFixed(0));

export async function entorno() {
  let pgVersion = '?';
  try {
    const c = new pg.Client(conexion('postgres'));
    await c.connect();
    pgVersion = (await c.query('SHOW server_version')).rows[0].server_version;
    await c.end();
  } catch {}
  let docker = '?';
  let dockerVm = '';
  try {
    docker = execSync('docker version --format "{{.Server.Version}}"').toString().trim();
    const info = execSync('docker info --format "{{.NCPU}} {{.MemTotal}}"').toString().trim().split(' ');
    dockerVm = `${info[0]} CPU y ${(Number(info[1]) / 2 ** 30).toFixed(0)} GB asignados a la VM de Docker`;
  } catch {}
  return {
    cpu: os.cpus()[0].model.trim(),
    hilos: os.cpus().length,
    ram: `${(os.totalmem() / 2 ** 30).toFixed(0)} GB`,
    so: `${os.type()} ${os.release()}`,
    node: process.version,
    pg: pgVersion,
    docker,
    dockerVm,
  };
}

// Bloqueo más fuerte sobre pedidos (o clientes) en un paso: el de la sonda si existe, si no el observado.
function modoPaso(p) {
  const fuente = p.sonda && typeof p.sonda === 'object' && !p.sonda.error ? p.sonda : p.observado?.concedido;
  let modo = null;
  for (const v of Object.values(fuente ?? {})) modo = masFuerte(modo, v);
  for (const v of Object.values(p.observado?.concedido ?? {})) modo = masFuerte(modo, v);
  return modo;
}

function bloqueoMasFuerte(r) {
  let modo = null;
  for (const p of r.pasos) modo = masFuerte(modo, modoPaso(p));
  if (!modo) return '—';
  const ms = r.pasos.filter((p) => modoPaso(p) === modo).reduce((a, p) => a + p.ms, 0);
  return `${modo.replace('Lock', '')}, ${s(ms)} s`;
}

// El paso que más tardó y el bloqueo que tomó (en M7, por ejemplo, el daño no lo hace el bloqueo más fuerte).
function pasoMasLargo(r) {
  const p = r.pasos.reduce((a, b) => (b.ms > a.ms ? b : a));
  return `${(modoPaso(p) ?? '—').replace('Lock', '')}, ${s(p.ms)} s`;
}

export async function escribirInforme() {
  if (!fs.existsSync(DIR_JSON)) return;
  const grupos = {};
  for (const f of fs.readdirSync(DIR_JSON).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(fs.readFileSync(path.join(DIR_JSON, f), 'utf8'));
    (grupos[`${r.escenario}-${r.variante}`] ??= []).push(r);
  }
  // Por variante: la ronda representativa (la de duración mediana) para el detalle por paso,
  // y la mediana y el rango de cada cifra entre rondas.
  const res = {};
  for (const [k, rs] of Object.entries(grupos)) {
    rs.sort((x, y) => x.duracionMs - y.duracionMs);
    const rep = rs[Math.floor((rs.length - 1) / 2)];
    const val = (f) => rs.map(f).filter((x) => x != null);
    const est = (f) => {
      const v = val(f).sort((x, y) => x - y);
      return { med: v.length ? v[Math.floor((v.length - 1) / 2)] : null, min: v[0], max: v.at(-1) };
    };
    res[k] = {
      ...rep,
      rondas: rs,
      agg: {
        dur: est((r) => r.duracionMs),
        bl: est((r) => r.desdeInicio.bloqueadasLectura),
        be: est((r) => r.desdeInicio.bloqueadasEscritura),
        bt: est((r) => r.desdeInicio.bloqueadas),
        pausa: est((r) => r.desdeInicio.max),
        p50a: est((r) => r.antes.p50),
        p50d: est((r) => r.durante.p50),
        p99a: est((r) => r.antes.p99),
        p99d: est((r) => r.durante.p99),
        errores: val((r) => r.desdeInicio.errores).reduce((x, y) => x + y, 0),
      },
    };
  }
  const lista = Object.values(res);
  if (!lista.length) return;
  const nRondas = Math.max(...lista.map((r) => r.rondas.length));
  // Lecturas / escrituras de la ronda cuyo total es la mediana.
  const blMed = (r) => {
    const x = [...r.rondas].sort((a, b) => a.desdeInicio.bloqueadas - b.desdeInicio.bloqueadas)[Math.floor((r.rondas.length - 1) / 2)];
    return `${x.desdeInicio.bloqueadasLectura} / ${x.desdeInicio.bloqueadasEscritura}`;
  };
  const rango = (e, f) => (e.min === e.max ? '' : ` (${f(e.min)}–${f(e.max)})`);
  const e = await entorno();
  const r0 = lista[0];
  const fechas = lista.flatMap((r) => r.rondas.map((x) => x.fecha.slice(0, 10))).sort();
  const L = [];
  L.push('# Resultados: migraciones de esquema con carga concurrente');
  L.push('');
  L.push(`Medido el ${fechas[0]}${fechas.at(-1) !== fechas[0] ? ` al ${fechas.at(-1)}` : ''} con \`npm run escenarios\`. Archivo generado; no editar a mano (los datos crudos están en \`results/json/\`).`);
  L.push('');
  L.push('## Máquina y versiones');
  L.push('');
  L.push(`- Equipo: ${e.cpu}, ${e.hilos} hilos lógicos, ${e.ram} de RAM, ${e.so}.`);
  L.push(`- Docker ${e.docker} (Docker Desktop con WSL2${e.dockerVm ? '; ' + e.dockerVm : ''}).`);
  L.push(`- PostgreSQL ${e.pg} (imagen \`postgres:17\`), con \`shared_buffers=2GB\`, \`max_wal_size=8GB\`, \`maintenance_work_mem=512MB\`.`);
  L.push(`- Node ${e.node}, driver \`pg\` 8.23.1. Cliente, servidor y Docker en la misma máquina.`);
  L.push('');
  L.push('## Cómo leer las tablas');
  L.push('');
  L.push(`- Tabla \`pedidos\` con **${r0.filas.toLocaleString('es')} filas** (≈1,2 GB con sus índices) y \`clientes\` con ${cfg.clientes.toLocaleString('es')}. Cada variante corre sobre una copia nueva de la misma base.`);
  L.push(`- Carga: **${r0.ritmo} peticiones/s a ritmo fijo** (70 % lecturas por id, 20 % UPDATE por id, 10 % INSERT), atendidas por un pool de **${r0.pool} conexiones**, como una aplicación. La latencia se cuenta desde que la petición debió salir: incluye la espera por una conexión libre.`);
  L.push(`- **Bloqueadas**: peticiones que tardaron más de ${r0.umbralBloqueo} ms, desde que empezó la migración hasta el final de la prueba (incluye la cola que queda al terminar). Se da la mediana del total, el rango entre rondas y cuántas fueron lecturas (L) y escrituras (E) en la ronda de la mediana. Sin migración, este número es 0 o casi 0.`);
  L.push('- **Pausa máx.**: la petición más lenta en ese mismo intervalo.');
  L.push(`- **p50 / p99 antes**: ${cfg.antes} s de línea base. **Durante**: peticiones que debían salir mientras corría la migración (como mínimo 1 s, para que las migraciones instantáneas tengan muestra).`);
  L.push('- **Bloqueo más fuerte**: el modo de bloqueo de tabla más fuerte que pidió la migración sobre `pedidos` (o `clientes`) y cuánto duraron los pasos que lo pidieron, **incluida la espera hasta obtenerlo** (en M8 casi todo ese tiempo es espera, y mientras se espera también se bloquea a los demás). **Paso más largo**: el bloqueo de tabla del paso que más tardó; en los rellenos (M7) el daño lo hacen los bloqueos de fila de un `UPDATE` largo, que `pg_locks` muestra como `RowExclusiveLock` sobre la tabla. Se lee de `pg_locks` de dos formas: ejecutando cada paso dentro de una transacción en una base de 1000 filas (sonda) y consultando `pg_locks` cada 20 ms durante la corrida real (observado).');
  L.push('');
  L.push('## Resumen');
  L.push('');
  L.push(`Cada variante se midió **${nRondas} veces** (rondas completas, una detrás de otra). Las cifras son la **mediana**; entre paréntesis, el rango entre rondas. Los bloqueos son los de la ronda de duración mediana.`);
  L.push('');
  L.push('| Escenario | Variante | Bloqueo más fuerte, tiempo de sus pasos | Paso más largo: bloqueo, tiempo | Duración (s) | Bloqueadas: total (rango) · L / E | Pausa máx. (ms) | p50 antes → durante (ms) | p99 antes → durante (ms) | Errores |');
  L.push('|---|---|---|---|---:|---:|---:|---:|---:|---:|');
  for (const esc of ESCENARIOS) {
    for (const v of esc.variantes) {
      const r = res[`${esc.id}-${v.id}`];
      if (!r) continue;
      const g = r.agg;
      L.push(
        `| ${esc.id} | ${r.nombreVariante} | ${bloqueoMasFuerte(r)} | ${pasoMasLargo(r)} | ${s(g.dur.med)}${rango(g.dur, s)} | ${g.bt.med}${rango(g.bt, String)} · ${blMed(r)} | ${m(g.pausa.med)}${rango(g.pausa, m)} | ${m(g.p50a.med)} → ${m(g.p50d.med)} | ${m(g.p99a.med)} → ${m(g.p99d.med)} | ${g.errores}${r.rondas.some((x) => x.error) ? ' (falló)' : ''} |`,
      );
    }
  }
  L.push('');
  for (const esc of ESCENARIOS) {
    const vs = esc.variantes.map((v) => res[`${esc.id}-${v.id}`]).filter(Boolean);
    if (!vs.length) continue;
    L.push(`## ${esc.id}. ${esc.titulo}`);
    L.push('');
    L.push(esc.ensena);
    L.push('');
    for (const r of vs) {
      L.push(`### ${esc.id} ${r.nombreVariante}`);
      L.push('');
      L.push('| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |');
      L.push('|---|---|---|---:|---:|');
      for (const p of r.pasos) {
        const sonda = p.sonda == null ? '—' : typeof p.sonda === 'string' ? p.sonda : p.sonda.error ? `error: ${p.sonda.error}` : formatoModos(p.sonda);
        let obs = formatoModos(p.observado.concedido);
        if (Object.keys(p.observado.espera).length) obs += `; esperó ${formatoModos(p.observado.espera)}`;
        const info = p.info ? ` (${Object.entries(p.info).map(([k, v]) => `${v} ${k}`).join(', ')})` : '';
        L.push(`| ${p.nombre}${info} | ${sonda} | ${obs} | ${p.maxEsperando} | ${s(p.ms)} |`);
      }
      L.push('');
      const d = r.desdeInicio;
      L.push(
        `Ronda representativa (${r.ronda ?? 1}): duración ${s(r.duracionMs)} s. Desde el inicio de la migración: ${d.n} peticiones, ${d.bloqueadas} bloqueadas (${d.bloqueadasLectura} lecturas, ${d.bloqueadasEscritura} escrituras), pausa máxima ${m(d.max)} ms, ${d.errores} errores${d.codigosError.length ? ' (' + d.codigosError.join(', ') + ')' : ''}. p50/p99 antes ${m(r.antes.p50)}/${m(r.antes.p99)} ms; durante ${m(r.durante.p50)}/${m(r.durante.p99)} ms (${r.durante.n} peticiones).${r.antes.bloqueadas ? ` En la línea base hubo ${r.antes.bloqueadas} peticiones de más de ${r.umbralBloqueo} ms (ruido de la máquina).` : ''}${r.error ? ` **Falló:** ${r.error}` : ''}`,
      );
      L.push('');
      if (r.rondas.length > 1) {
        L.push('Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):');
        L.push('');
        for (const x of [...r.rondas].sort((a, b) => a.ronda - b.ronda)) {
          L.push(`- Ronda ${x.ronda}: ${s(x.duracionMs)} s · ${x.desdeInicio.bloqueadas} · ${m(x.desdeInicio.max)} ms · ${m(x.antes.p99)} → ${m(x.durante.p99)} ms${x.antes.bloqueadas ? ` (${x.antes.bloqueadas} peticiones lentas ya en la línea base)` : ''}`);
        }
        L.push('');
      }
      L.push('```sql');
      L.push(r.pasos.map((p) => p.sql.trim().replace(/;?$/, ';')).join('\n'));
      L.push('```');
      L.push('');
    }
  }
  fs.writeFileSync(path.join(RAIZ, 'results', 'ESCENARIOS.md'), L.join('\n'));
  console.log('Escrito results/ESCENARIOS.md');
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) await escribirInforme();
