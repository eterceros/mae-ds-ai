-- M2. ADD COLUMN con DEFAULT: constante frente a volátil (volátil (ingenua))
-- DEFAULT volátil
ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
