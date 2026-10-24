// Configuracion de la conexion a Postgres. Todo sale de variables de entorno
// (nada de credenciales dentro de la imagen; ver la S02 y el escenario K4).
import { Pool } from 'pg';

export function crearPool(): Pool {
  return new Pool({
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE ?? 'tienda',
    max: 5,
    connectionTimeoutMillis: 2000,
  });
}
