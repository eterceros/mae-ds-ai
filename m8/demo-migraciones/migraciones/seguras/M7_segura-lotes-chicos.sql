-- M7. Relleno de una columna nueva: un solo UPDATE frente a lotes (segura, lotes de 5000 y pausa de 20 ms)
-- Columna nueva
ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
-- Rellenar por lotes de 5000 con pausa
UPDATE pedidos SET region_codigo = CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END WHERE id >= 1 AND id < 5001;
