CREATE TABLE items (
  id     serial PRIMARY KEY,
  nombre text NOT NULL,
  precio numeric(10, 2) NOT NULL
);
INSERT INTO items (nombre, precio) VALUES
  ('Teclado', 120.00),
  ('Raton', 45.50),
  ('Monitor', 899.90);
