-- Tablas de la versión mejorada del importador (solución del docente).
-- No hace falta ejecutarlo a mano: import-improved.ts e import_improved.py lo ejecutan al empezar
-- (todo es IF NOT EXISTS, así que correrlo muchas veces no cambia nada).

-- Registro de corridas: una fila por ejecución del importador, con sus cuentas.
CREATE TABLE IF NOT EXISTS import_runs (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  file         text        NOT NULL,
  tool         text        NOT NULL,              -- 'node' o 'python'
  started_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at  timestamptz,                       -- NULL = la corrida no terminó (se cayó o se cortó)
  rows_read    int,
  rejected     int,
  duplicates   int,
  inserted     int,
  updated      int,
  unchanged    int
);

-- Tabla intermedia (staging): las filas que pasaron la validación, tal como vienen, con su línea.
-- Sin UNIQUE a propósito: aquí pueden estar las repetidas; se deduplican al pasar a la final.
-- UNLOGGED: no escribe WAL (más rápida); si Postgres se cae se vacía, y no importa: se recarga del CSV.
CREATE UNLOGGED TABLE IF NOT EXISTS enrollments_staging (
  run_id       bigint        NOT NULL,
  line         int           NOT NULL,            -- línea del archivo donde empieza la fila
  external_id  text          NOT NULL,
  student_name text          NOT NULL,
  email        text          NOT NULL,
  course_code  text          NOT NULL,
  enrolled_on  date          NOT NULL,
  amount       numeric(10,2) NOT NULL
);

-- Para el paso a la final: recorrer por external_id y quedarse con la última línea de cada uno.
CREATE INDEX IF NOT EXISTS enrollments_staging_run_key
  ON enrollments_staging (run_id, external_id, line DESC);
