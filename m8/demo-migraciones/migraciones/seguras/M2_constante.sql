-- M2. ADD COLUMN con DEFAULT: constante frente a volátil (constante)
-- DEFAULT constante
ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0;
