-- M5. SET NOT NULL directo frente a CHECK NOT VALID + VALIDATE + SET NOT NULL (segura)
-- CHECK sin validar
ALTER TABLE pedidos ADD CONSTRAINT region_no_nula CHECK (region IS NOT NULL) NOT VALID;
-- Validar el CHECK
ALTER TABLE pedidos VALIDATE CONSTRAINT region_no_nula;
-- SET NOT NULL (usa el CHECK)
ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
-- Quitar el CHECK
ALTER TABLE pedidos DROP CONSTRAINT region_no_nula;
