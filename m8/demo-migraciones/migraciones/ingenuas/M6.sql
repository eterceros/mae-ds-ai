-- M6. Clave foránea directa frente a NOT VALID + VALIDATE (ingenua)
-- Agregar FK
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
