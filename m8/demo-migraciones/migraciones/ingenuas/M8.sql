-- M8. Cola de bloqueos: transacción larga + ALTER instantáneo (ingenua)
-- (en la demo, otra sesión mantiene abierta una transacción de lectura sobre pedidos)
-- ALTER sin lock_timeout
ALTER TABLE pedidos ADD COLUMN cupon text;
