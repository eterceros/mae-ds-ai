-- M2. ADD COLUMN con DEFAULT: constante frente a volátil (volátil (segura))
-- Columna anulable sin default
ALTER TABLE pedidos ADD COLUMN token uuid;
-- Default solo para filas nuevas
ALTER TABLE pedidos ALTER COLUMN token SET DEFAULT gen_random_uuid();
-- Rellenar por lotes
UPDATE pedidos SET token = gen_random_uuid() WHERE id >= 1 AND id < 50001;
-- CHECK sin validar
ALTER TABLE pedidos ADD CONSTRAINT token_no_nulo CHECK (token IS NOT NULL) NOT VALID;
-- Validar el CHECK
ALTER TABLE pedidos VALIDATE CONSTRAINT token_no_nulo;
-- SET NOT NULL (usa el CHECK, no recorre)
ALTER TABLE pedidos ALTER COLUMN token SET NOT NULL;
-- Quitar el CHECK
ALTER TABLE pedidos DROP CONSTRAINT token_no_nulo;
