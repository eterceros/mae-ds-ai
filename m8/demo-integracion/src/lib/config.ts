// Configuración común. Los valores por defecto apuntan al contenedor de docker-compose.yml
// visto desde el anfitrión (puerto 18432 en 127.0.0.1) y a los procesos que lanzan los scripts.
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://postgres:demo@127.0.0.1:18432/integ';
export const RECEIVER_PORT = Number(process.env.RECEIVER_PORT ?? 18410);       // receptor del webhook (I1)
export const THIRD_PARTY_PORT = Number(process.env.THIRD_PARTY_PORT ?? 18420); // «tercero» simulado (I3)
export const THIRD_PARTY_URL = process.env.THIRD_PARTY_URL ?? `http://127.0.0.1:${THIRD_PARTY_PORT}`;

// Secreto compartido del webhook, con el formato de Standard Webhooks: "whsec_" + clave en base64.
// En un sistema real viene de un gestor de secretos o de una variable de entorno, nunca del código.
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_c2VjcmV0by1kZS1kZW1vLXNvbG8tcGFyYS1jbGFzZQ==';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
