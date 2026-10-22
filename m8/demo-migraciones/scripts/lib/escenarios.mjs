// Escenarios M1–M8: cada uno tiene una variante ingenua y una o más seguras.
// Un paso es SQL (una sentencia) o una función `run` cuando hace falta lógica (lotes, reintentos, transacción).
// `sql` es lo que se muestra en los resultados y lo que se exporta a migraciones/*.sql para Squawk.
import pg from 'pg';
import { cfg, conexion, sleep } from './config.mjs';

const paso = (nombre, sql, extra = {}) => ({ nombre, sql, ...extra });

// Ejecuta una sentencia con lock_timeout: si no consigue el bloqueo en `ms`, falla en vez de hacer cola.
const conLockTimeout = (nombre, sql, ms) => ({
  nombre,
  sql: `SET lock_timeout = '${ms}ms';\n${sql};\nRESET lock_timeout`,
  sqlArchivo: [`SET lock_timeout = '${ms}ms'`, sql],
  async run(c) {
    await c.query(`SET lock_timeout = '${ms}ms'`);
    try {
      await c.query(sql);
    } finally {
      await c.query('RESET lock_timeout');
    }
  },
});

// Relleno por lotes de `lote` filas por rango de id, cada lote en su propia transacción (autocommit).
const porLotes = (nombre, plantilla, condicionPendiente, { lote = cfg.lote, pausaMs = 0 } = {}) => ({
  nombre,
  sql:
    `-- repetir para a = 1, 1+${lote}, ... hasta max(id), cada lote en su propia transacción` +
    (pausaMs ? `, con ${pausaMs} ms de pausa entre lotes` : '') +
    `:
${plantilla(':a', `:a + ${lote}`)}${condicionPendiente ? ` AND ${condicionPendiente}` : ''}`,
  sqlArchivo: [plantilla(1, 1 + lote)],
  async run(c) {
    const { rows } = await c.query('SELECT max(id) AS m FROM pedidos');
    const max = Number(rows[0].m);
    let lotes = 0;
    for (let a = 1; a <= max; a += lote) {
      await c.query(plantilla(a, a + lote) + (condicionPendiente ? ` AND ${condicionPendiente}` : ''));
      lotes++;
      if (pausaMs) await sleep(pausaMs);
    }
    return { lotes };
  },
});

const CASE_REGION = `CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END`;

// M8: una transacción larga (un reporte, o una sesión "idle in transaction") que retiene AccessShareLock.
const SEG_TX_LARGA = 8;
const transaccionLarga = {
  nombre: `Otra sesión abre una transacción que lee pedidos y no termina en ${SEG_TX_LARGA} s`,
  sql: `-- sesión 2 (por ejemplo, un reporte)\nBEGIN;\nSELECT count(*) FROM pedidos WHERE id < 1000;  -- toma AccessShareLock hasta el COMMIT\n-- ... ${SEG_TX_LARGA} s después: COMMIT;`,
  sonda: false,
  noExportar: true,
  async run(_c, ctx) {
    const r = new pg.Client({ ...conexion(ctx.database), application_name: 'reporte' });
    await r.connect();
    await r.query('BEGIN');
    await r.query('SELECT count(*) FROM pedidos WHERE id < 1000');
    ctx.pendientes.push(
      sleep(SEG_TX_LARGA * 1000).then(async () => {
        await r.query('COMMIT');
        await r.end();
      }),
    );
  },
};

export const ESCENARIOS = [
  {
    id: 'M1',
    titulo: 'ADD COLUMN anulable, sin valor por defecto',
    ensena: 'Es instantáneo (solo cambia el catálogo), pero igual toma AccessExclusiveLock: por eso importa M8.',
    variantes: [
      { id: 'ingenua', pasos: [paso('Agregar columna', 'ALTER TABLE pedidos ADD COLUMN cupon text')] },
      { id: 'segura', pasos: [conLockTimeout('Agregar columna con lock_timeout', 'ALTER TABLE pedidos ADD COLUMN cupon text', 2000)] },
    ],
  },
  {
    id: 'M2',
    titulo: 'ADD COLUMN con DEFAULT: constante frente a volátil',
    ensena: 'Desde Postgres 11 un DEFAULT constante no reescribe la tabla; uno volátil (gen_random_uuid(), clock_timestamp()) sí.',
    variantes: [
      {
        id: 'constante',
        pasos: [paso('DEFAULT constante', 'ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0')],
      },
      {
        id: 'ingenua',
        nombre: 'volátil (ingenua)',
        pasos: [paso('DEFAULT volátil', 'ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid()')],
      },
      {
        id: 'segura',
        nombre: 'volátil (segura)',
        pasos: [
          paso('Columna anulable sin default', 'ALTER TABLE pedidos ADD COLUMN token uuid'),
          paso('Default solo para filas nuevas', 'ALTER TABLE pedidos ALTER COLUMN token SET DEFAULT gen_random_uuid()'),
          porLotes('Rellenar por lotes', (a, b) => `UPDATE pedidos SET token = gen_random_uuid() WHERE id >= ${a} AND id < ${b}`, 'token IS NULL'),
          paso('CHECK sin validar', 'ALTER TABLE pedidos ADD CONSTRAINT token_no_nulo CHECK (token IS NOT NULL) NOT VALID'),
          paso('Validar el CHECK', 'ALTER TABLE pedidos VALIDATE CONSTRAINT token_no_nulo'),
          paso('SET NOT NULL (usa el CHECK, no recorre)', 'ALTER TABLE pedidos ALTER COLUMN token SET NOT NULL'),
          paso('Quitar el CHECK', 'ALTER TABLE pedidos DROP CONSTRAINT token_no_nulo'),
        ],
      },
    ],
  },
  {
    id: 'M3',
    titulo: 'Cambiar el tipo de la clave primaria: integer → bigint',
    ensena: 'ALTER COLUMN TYPE reescribe la tabla y todos sus índices con AccessExclusiveLock. La vía segura es una columna nueva, un trigger, relleno por lotes, índice CONCURRENTLY y un intercambio corto.',
    variantes: [
      { id: 'ingenua', pasos: [paso('Cambiar el tipo', 'ALTER TABLE pedidos ALTER COLUMN id TYPE bigint')] },
      {
        id: 'segura',
        pasos: [
          paso('Columna nueva', 'ALTER TABLE pedidos ADD COLUMN id_nuevo bigint'),
          paso(
            'Función que copia id',
            `CREATE FUNCTION pedidos_copiar_id() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.id_nuevo := NEW.id; RETURN NEW; END $$`,
          ),
          paso('Trigger para filas nuevas y modificadas', 'CREATE TRIGGER pedidos_copiar_id BEFORE INSERT OR UPDATE ON pedidos FOR EACH ROW EXECUTE FUNCTION pedidos_copiar_id()'),
          porLotes('Rellenar por lotes', (a, b) => `UPDATE pedidos SET id_nuevo = id WHERE id >= ${a} AND id < ${b}`, 'id_nuevo IS NULL'),
          paso('Índice único sin bloquear escrituras', 'CREATE UNIQUE INDEX CONCURRENTLY pedidos_id_nuevo_key ON pedidos (id_nuevo)', { transaccional: false }),
          paso('CHECK sin validar', 'ALTER TABLE pedidos ADD CONSTRAINT id_nuevo_no_nulo CHECK (id_nuevo IS NOT NULL) NOT VALID'),
          paso('Validar el CHECK', 'ALTER TABLE pedidos VALIDATE CONSTRAINT id_nuevo_no_nulo'),
          {
            nombre: 'Intercambio en una transacción corta',
            sql: `BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE pedidos ALTER COLUMN id DROP IDENTITY;
ALTER TABLE pedidos DROP CONSTRAINT pedidos_pkey;
ALTER TABLE pedidos RENAME COLUMN id TO id_viejo;
ALTER TABLE pedidos RENAME COLUMN id_nuevo TO id;
ALTER TABLE pedidos ALTER COLUMN id SET NOT NULL;            -- no recorre: usa el CHECK validado
ALTER TABLE pedidos ADD CONSTRAINT pedidos_pkey PRIMARY KEY USING INDEX pedidos_id_nuevo_key;
ALTER TABLE pedidos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH <max(id)+1>);
DROP TRIGGER pedidos_copiar_id ON pedidos;
ALTER TABLE pedidos DROP COLUMN id_viejo;                    -- instantáneo: solo marca la columna
ALTER TABLE pedidos DROP CONSTRAINT id_nuevo_no_nulo;
COMMIT;`,
            sqlArchivo: [
              "SET lock_timeout = '2s'",
              'ALTER TABLE pedidos ALTER COLUMN id DROP IDENTITY',
              'ALTER TABLE pedidos DROP CONSTRAINT pedidos_pkey',
              'ALTER TABLE pedidos RENAME COLUMN id TO id_viejo',
              'ALTER TABLE pedidos RENAME COLUMN id_nuevo TO id',
              'ALTER TABLE pedidos ALTER COLUMN id SET NOT NULL',
              'ALTER TABLE pedidos ADD CONSTRAINT pedidos_pkey PRIMARY KEY USING INDEX pedidos_id_nuevo_key',
              'ALTER TABLE pedidos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH 10000001)',
              'DROP TRIGGER pedidos_copiar_id ON pedidos',
              'ALTER TABLE pedidos DROP COLUMN id_viejo',
              'ALTER TABLE pedidos DROP CONSTRAINT id_nuevo_no_nulo',
            ],
            async run(c, ctx) {
              await c.query('BEGIN');
              try {
                await c.query("SET LOCAL lock_timeout = '2s'");
                await c.query('ALTER TABLE pedidos ALTER COLUMN id DROP IDENTITY');
                await c.query('ALTER TABLE pedidos DROP CONSTRAINT pedidos_pkey');
                await c.query('ALTER TABLE pedidos RENAME COLUMN id TO id_viejo');
                await c.query('ALTER TABLE pedidos RENAME COLUMN id_nuevo TO id');
                await c.query('ALTER TABLE pedidos ALTER COLUMN id SET NOT NULL');
                await c.query('ALTER TABLE pedidos ADD CONSTRAINT pedidos_pkey PRIMARY KEY USING INDEX pedidos_id_nuevo_key');
                const { rows } = await c.query('SELECT coalesce(max(id), 0) + 1 AS s FROM pedidos');
                await c.query(`ALTER TABLE pedidos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH ${rows[0].s})`);
                await c.query('DROP TRIGGER pedidos_copiar_id ON pedidos');
                await c.query('ALTER TABLE pedidos DROP COLUMN id_viejo');
                await c.query('ALTER TABLE pedidos DROP CONSTRAINT id_nuevo_no_nulo');
                if (ctx.antesDeCommit) await ctx.antesDeCommit(c);
                await c.query('COMMIT');
              } catch (e) {
                await c.query('ROLLBACK');
                throw e;
              }
            },
            propiaTransaccion: true,
          },
        ],
      },
    ],
  },
  {
    id: 'M4',
    titulo: 'CREATE INDEX frente a CREATE INDEX CONCURRENTLY',
    ensena: 'CREATE INDEX toma ShareLock: las lecturas siguen, pero toda escritura espera. CONCURRENTLY toma ShareUpdateExclusiveLock y tarda más, sin cortar escrituras.',
    variantes: [
      { id: 'ingenua', pasos: [paso('Crear índice', 'CREATE INDEX pedidos_producto_idx ON pedidos (producto_id)')] },
      {
        id: 'segura',
        pasos: [paso('Crear índice CONCURRENTLY', 'CREATE INDEX CONCURRENTLY pedidos_producto_idx ON pedidos (producto_id)', { transaccional: false })],
      },
    ],
  },
  {
    id: 'M5',
    titulo: 'SET NOT NULL directo frente a CHECK NOT VALID + VALIDATE + SET NOT NULL',
    ensena: 'SET NOT NULL recorre toda la tabla con AccessExclusiveLock. Con un CHECK validado antes (ShareUpdateExclusiveLock), Postgres 12+ se salta el recorrido.',
    variantes: [
      { id: 'ingenua', pasos: [paso('SET NOT NULL', 'ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL')] },
      {
        id: 'segura',
        pasos: [
          paso('CHECK sin validar', 'ALTER TABLE pedidos ADD CONSTRAINT region_no_nula CHECK (region IS NOT NULL) NOT VALID'),
          paso('Validar el CHECK', 'ALTER TABLE pedidos VALIDATE CONSTRAINT region_no_nula'),
          paso('SET NOT NULL (usa el CHECK)', 'ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL'),
          paso('Quitar el CHECK', 'ALTER TABLE pedidos DROP CONSTRAINT region_no_nula'),
        ],
      },
    ],
  },
  {
    id: 'M6',
    titulo: 'Clave foránea directa frente a NOT VALID + VALIDATE',
    ensena: 'ADD FOREIGN KEY valida todas las filas con ShareRowExclusiveLock en ambas tablas: bloquea escrituras. NOT VALID es instantáneo y VALIDATE solo toma ShareUpdateExclusiveLock.',
    variantes: [
      {
        id: 'ingenua',
        pasos: [paso('Agregar FK', 'ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id)')],
      },
      {
        id: 'segura',
        pasos: [
          paso('FK sin validar', 'ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id) NOT VALID'),
          paso('Validar la FK', 'ALTER TABLE pedidos VALIDATE CONSTRAINT pedidos_cliente_fk'),
        ],
      },
    ],
  },
  {
    id: 'M7',
    titulo: 'Relleno de una columna nueva: un solo UPDATE frente a lotes',
    ensena: 'Un UPDATE de toda la tabla bloquea cada fila hasta el COMMIT: las escrituras de la aplicación sobre esas filas esperan y agotan el pool. Por lotes, cada bloqueo dura una fracción de segundo.',
    variantes: [
      {
        id: 'ingenua',
        pasos: [
          paso('Columna nueva', 'ALTER TABLE pedidos ADD COLUMN region_codigo smallint'),
          paso('Rellenar en un UPDATE', `UPDATE pedidos SET region_codigo = ${CASE_REGION}`),
        ],
      },
      {
        id: 'segura',
        nombre: `segura, lotes de ${cfg.lote}`,
        pasos: [
          paso('Columna nueva', 'ALTER TABLE pedidos ADD COLUMN region_codigo smallint'),
          porLotes(`Rellenar por lotes de ${cfg.lote}`, (a, b) => `UPDATE pedidos SET region_codigo = ${CASE_REGION} WHERE id >= ${a} AND id < ${b}`, 'region_codigo IS NULL'),
        ],
      },
      {
        id: 'segura-lotes-chicos',
        nombre: 'segura, lotes de 5000 y pausa de 20 ms',
        pasos: [
          paso('Columna nueva', 'ALTER TABLE pedidos ADD COLUMN region_codigo smallint'),
          porLotes(
            'Rellenar por lotes de 5000 con pausa',
            (a, b) => `UPDATE pedidos SET region_codigo = ${CASE_REGION} WHERE id >= ${a} AND id < ${b}`,
            'region_codigo IS NULL',
            { lote: 5000, pausaMs: 20 },
          ),
        ],
      },
    ],
  },
  {
    id: 'M8',
    titulo: 'Cola de bloqueos: transacción larga + ALTER instantáneo',
    ensena: `El ALTER (instantáneo) espera AccessExclusiveLock detrás de una transacción de ${SEG_TX_LARGA} s; mientras espera, todas las peticiones nuevas hacen cola detrás de él. Con lock_timeout y reintentos, el ALTER se rinde rápido y la aplicación sigue.`,
    variantes: [
      {
        id: 'ingenua',
        pasos: [transaccionLarga, paso('ALTER sin lock_timeout', 'ALTER TABLE pedidos ADD COLUMN cupon text')],
      },
      {
        id: 'segura',
        pasos: [
          transaccionLarga,
          {
            nombre: 'ALTER con lock_timeout = 200 ms y reintentos cada 500 ms',
            sql: `SET lock_timeout = '200ms';\n-- reintentar ante el error 55P03 (lock_not_available), esperando 500 ms entre intentos:\nALTER TABLE pedidos ADD COLUMN cupon text;\nRESET lock_timeout;`,
            sqlArchivo: ["SET lock_timeout = '200ms'", 'ALTER TABLE pedidos ADD COLUMN cupon text'],
            async run(c) {
              await c.query("SET lock_timeout = '200ms'");
              let intentos = 0;
              try {
                for (;;) {
                  intentos++;
                  try {
                    await c.query('ALTER TABLE pedidos ADD COLUMN cupon text');
                    return { intentos };
                  } catch (e) {
                    if (e.code !== '55P03' || intentos >= 100) throw e;
                    await sleep(500);
                  }
                }
              } finally {
                await c.query('RESET lock_timeout');
              }
            },
          },
        ],
      },
    ],
  },
];
