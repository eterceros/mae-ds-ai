-- Flyway no genera SQL: ejecuta, en orden y una sola vez, el SQL que uno escribe.
-- El renombre lo decide quien escribe la migración: RENAME COLUMN conserva los datos y es instantáneo,
-- pero rompe a cualquier versión de la aplicación que todavía use el nombre viejo (ver expand/contract).
SET lock_timeout = '2s';
ALTER TABLE cliente RENAME COLUMN telefono TO celular;
