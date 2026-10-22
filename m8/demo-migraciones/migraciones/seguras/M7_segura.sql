-- M7. Relleno de una columna nueva: un solo UPDATE frente a lotes (segura, lotes de 50000)
-- Columna nueva
ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
-- Rellenar por lotes de 50000
UPDATE pedidos SET region_codigo = CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END WHERE id >= 1 AND id < 50001;
