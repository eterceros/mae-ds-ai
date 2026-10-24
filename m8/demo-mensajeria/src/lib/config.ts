// Configuración común. Los valores por defecto apuntan a los contenedores de docker-compose.yml
// vistos desde el anfitrión (puertos 183xx en 127.0.0.1).
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:demo@127.0.0.1:18332/shop';
export const AMQP_URL = process.env.AMQP_URL ?? 'amqp://demo:demo@127.0.0.1:18372';
export const MGMT_URL = process.env.MGMT_URL ?? 'http://127.0.0.1:18373';

// Matar el proceso de golpe (como un `kill -9` o un corte de luz): sin `finally`, sin cerrar conexiones.
// Sirve para inyectar la caída exactamente en el punto crítico.
export function crashNow(where: string): never {
  console.error(`[crash] ${process.pid} muere en: ${where}`);
  process.kill(process.pid, 'SIGKILL');
  throw new Error('unreachable');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
