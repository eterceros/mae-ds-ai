-- Migracion con un error a proposito: la columna "stock" no existe.
-- Va en una transaccion: el ALTER que la precede se deshace tambien.
ALTER TABLE items ADD COLUMN categoria text;
UPDATE items SET categoria = 'perifericos' WHERE stock > 0;
