// Direcciones y parametros comunes. Todo en 127.0.0.1 y en puertos altos (ver docker-compose.yml).
export const PG_URL = process.env.PG_URL ?? 'postgres://postgres:demo@127.0.0.1:18432/shop';
export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:18379';
export const VALKEY_URL = process.env.VALKEY_URL ?? 'redis://127.0.0.1:18380';
export const API_PORTS = (process.env.API_PORTS ?? '18500,18501').split(',').map(Number);
export const PRODUCTS = Number(process.env.PRODUCTS ?? 5000);
export const ORDERS = Number(process.env.ORDERS ?? 3_000_000);
