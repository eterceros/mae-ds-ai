-- M7. Relleno de una columna nueva: un solo UPDATE frente a lotes (ingenua)
-- Columna nueva
ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
-- Rellenar en un UPDATE
UPDATE pedidos SET region_codigo = CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END;
