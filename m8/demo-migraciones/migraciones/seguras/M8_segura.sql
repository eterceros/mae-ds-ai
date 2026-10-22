-- M8. Cola de bloqueos: transacción larga + ALTER instantáneo (segura)
-- (en la demo, otra sesión mantiene abierta una transacción de lectura sobre pedidos)
-- ALTER con lock_timeout = 200 ms y reintentos cada 500 ms
SET lock_timeout = '200ms';
ALTER TABLE pedidos ADD COLUMN cupon text;
