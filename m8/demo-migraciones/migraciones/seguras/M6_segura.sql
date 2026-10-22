-- M6. Clave foránea directa frente a NOT VALID + VALIDATE (segura)
-- FK sin validar
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id) NOT VALID;
-- Validar la FK
ALTER TABLE pedidos VALIDATE CONSTRAINT pedidos_cliente_fk;
