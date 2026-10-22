-- M4. CREATE INDEX frente a CREATE INDEX CONCURRENTLY (segura)
-- Crear índice CONCURRENTLY
CREATE INDEX CONCURRENTLY pedidos_producto_idx ON pedidos (producto_id);
