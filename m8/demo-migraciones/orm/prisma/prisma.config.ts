// Prisma 7 lee la conexión desde este archivo (ya no desde schema.prisma).
// `migrate diff` entre dos archivos de esquema no se conecta a la base, pero el motor exige un datasource.
import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://demo:demo@127.0.0.1:18543/orm_prisma',
  },
});
