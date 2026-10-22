-- M1. ADD COLUMN anulable, sin valor por defecto (segura)
-- Agregar columna con lock_timeout
SET lock_timeout = '2000ms';
ALTER TABLE pedidos ADD COLUMN cupon text;
