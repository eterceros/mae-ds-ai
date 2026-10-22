// Lectura de pg_locks: qué bloqueo de tabla toma cada sentencia y cuántas sesiones quedan esperando.
import pg from 'pg';
import { conexion } from './config.mjs';

// Modos de bloqueo de tabla de Postgres, de más débil a más fuerte.
export const MODOS = [
  'AccessShareLock',
  'RowShareLock',
  'RowExclusiveLock',
  'ShareUpdateExclusiveLock',
  'ShareLock',
  'ShareRowExclusiveLock',
  'ExclusiveLock',
  'AccessExclusiveLock',
];
const fuerza = (m) => MODOS.indexOf(m);
export const masFuerte = (a, b) => (!a ? b : !b ? a : fuerza(b) > fuerza(a) ? b : a);

const TABLAS = ['pedidos', 'clientes'];

// Bloqueos de tabla (pedidos/clientes) que tiene la sesión actual. Se usa dentro de una transacción abierta.
export async function bloqueosPropios(client) {
  const { rows } = await client.query(
    `SELECT c.relname, l.mode
       FROM pg_locks l JOIN pg_class c ON c.oid = l.relation
      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND c.relname = ANY($1)`,
    [TABLAS],
  );
  const res = {};
  for (const r of rows) res[r.relname] = masFuerte(res[r.relname], r.mode);
  return res;
}

// Monitor que consulta pg_locks cada `cadaMs` mientras corre la migración.
// Registra el bloqueo más fuerte que tuvo la sesión de la migración (concedido o en espera)
// y el máximo de sesiones de la carga esperando un bloqueo sobre pedidos.
export class Monitor {
  constructor(database, cadaMs = 20) {
    this.database = database;
    this.cadaMs = cadaMs;
  }

  async iniciar() {
    this.c = new pg.Client({ ...conexion(this.database), application_name: 'monitor' });
    await this.c.connect();
    this.pidMigracion = null;
    this.reiniciarPaso();
    this.maxEsperando = 0;
    this.activo = true;
    this.bucle = (async () => {
      while (this.activo) {
        try {
          await this.muestrear();
        } catch {
          /* la base puede estar ocupada; se intenta de nuevo */
        }
        await new Promise((r) => setTimeout(r, this.cadaMs));
      }
    })();
  }

  reiniciarPaso() {
    this.paso = { concedido: {}, espera: {}, maxEsperando: 0 };
  }

  async muestrear() {
    const { rows } = await this.c.query(
      `SELECT l.pid, c.relname, l.mode, l.granted, a.application_name
         FROM pg_locks l
         JOIN pg_class c ON c.oid = l.relation
         JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'relation' AND c.relname = ANY($1)`,
      [TABLAS],
    );
    const esperando = new Set();
    for (const r of rows) {
      if (r.pid === this.pidMigracion) {
        const dest = r.granted ? this.paso.concedido : this.paso.espera;
        dest[r.relname] = masFuerte(dest[r.relname], r.mode);
      } else if (!r.granted && r.application_name === 'carga') {
        esperando.add(r.pid);
      }
    }
    this.paso.maxEsperando = Math.max(this.paso.maxEsperando, esperando.size);
    this.maxEsperando = Math.max(this.maxEsperando, esperando.size);
  }

  async detener() {
    this.activo = false;
    await this.bucle;
    await this.c.end();
  }
}

export function formatoModos(m) {
  const partes = Object.entries(m ?? {}).map(([t, modo]) => `${modo} (${t})`);
  return partes.length ? partes.join(', ') : '—';
}
