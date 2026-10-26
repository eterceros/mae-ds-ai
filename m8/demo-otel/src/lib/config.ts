// Configuración común: todo llega por variables de entorno (las pone docker-compose.yml).
export const PORT = Number(process.env.PORT ?? 3000);
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:demo@127.0.0.1:18545/pedidos';
export const SCHEMA = process.env.DB_SCHEMA ?? 'despues';     // antes y despues comparten Postgres, cada uno en su esquema
export const AMQP_URL = process.env.AMQP_URL ?? 'amqp://demo:demo@127.0.0.1:18540';
export const PRECIOS_URL = process.env.PRECIOS_URL ?? 'http://127.0.0.1:18556';
export const QUEUE = process.env.QUEUE ?? 'pedidos.creados';
// precios: 1 de cada SLOW_EVERY peticiones tarda SLOW_MS (el problema que hay que encontrar en OA).
export const SLOW_EVERY = Number(process.env.SLOW_EVERY ?? 10);
export const SLOW_MS = Number(process.env.SLOW_MS ?? 600);
// worker: tiempo de trabajo simulado por mensaje (p. ej. enviar el correo de confirmación).
export const WORK_MS = Number(process.env.WORK_MS ?? 20);
