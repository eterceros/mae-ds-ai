// Cliente de carga: simula una aplicación que recibe peticiones a ritmo fijo (llegadas abiertas)
// y las atiende con un pool de conexiones, como haría un backend real.
// La latencia se mide desde el instante en que la petición DEBIÓ salir, así que el tiempo
// esperando una conexión libre del pool también cuenta (eso es lo que siente el usuario).
import pg from 'pg';
import { cfg, conexion, sleep } from './config.mjs';

// Generador pseudoaleatorio con semilla (mulberry32): la secuencia de peticiones es reproducible.
export function prng(semilla) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ESTADOS = ['nuevo', 'pagado', 'enviado', 'entregado', 'cancelado'];
const REGIONES = ['andina', 'valles', 'llanos'];

export class Carga {
  constructor(database) {
    this.pool = new pg.Pool({ ...conexion(database), max: cfg.pool, application_name: 'carga' });
    this.pool.on('error', () => {});
    this.rnd = prng(cfg.semilla);
    this.registros = []; // { t: ms programado (relativo a t0), lat: ms, tipo: 'L'|'E', err }
    this.enVuelo = new Set();
    this.activo = false;
  }

  async calentar() {
    // Abre todas las conexiones del pool antes de medir.
    const cs = await Promise.all(Array.from({ length: cfg.pool }, () => this.pool.connect()));
    cs.forEach((c) => c.release());
  }

  peticion(tProgramado) {
    const r = this.rnd();
    const id = 1 + Math.floor(this.rnd() * cfg.filas);
    let tipo, sql, params;
    if (r < 0.7) {
      tipo = 'L';
      sql = 'SELECT id, estado, total FROM pedidos WHERE id = $1';
      params = [id];
    } else if (r < 0.9) {
      tipo = 'E';
      sql = 'UPDATE pedidos SET estado = $2 WHERE id = $1';
      params = [id, ESTADOS[Math.floor(this.rnd() * ESTADOS.length)]];
    } else {
      tipo = 'E';
      sql = `INSERT INTO pedidos (cliente_id, producto_id, estado, total, region, creado_en)
             VALUES ($1, $2, 'nuevo', $3, $4, now())`;
      params = [
        1 + Math.floor(this.rnd() * cfg.clientes),
        1 + Math.floor(this.rnd() * 5000),
        (this.rnd() * 1000).toFixed(2),
        REGIONES[Math.floor(this.rnd() * 3)],
      ];
    }
    const p = this.pool
      .query(sql, params)
      .then(
        () => null,
        (e) => e.code ?? e.message,
      )
      .then((err) => {
        this.registros.push({ t: tProgramado, lat: performance.now() - this.t0 - tProgramado, tipo, err });
        this.enVuelo.delete(p);
      });
    this.enVuelo.add(p);
  }

  // Lanza peticiones a ritmo fijo hasta que se llame a detener().
  iniciar() {
    this.t0 = performance.now();
    this.activo = true;
    const intervalo = 1000 / cfg.ritmo;
    let n = 0;
    const tick = () => {
      if (!this.activo) return;
      const ahora = performance.now() - this.t0;
      while (n * intervalo <= ahora) {
        this.peticion(n * intervalo);
        n++;
      }
      // setImmediate y no setTimeout: en Windows setTimeout tiene una resolución de ~15 ms,
      // lo que retrasaría las salidas y sumaría latencia falsa. Ocupa un núcleo del cliente.
      setImmediate(tick);
    };
    tick();
  }

  ahora() {
    return performance.now() - this.t0;
  }

  async detener() {
    this.activo = false;
    while (this.enVuelo.size) await Promise.allSettled([...this.enVuelo]);
    await this.pool.end();
  }
}

export function percentil(valores, p) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}

export { sleep };
