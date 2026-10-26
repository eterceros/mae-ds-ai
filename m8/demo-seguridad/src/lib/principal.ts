// Lo que la API necesita saber de quien hace la petición, sacado del token ya validado.
export type Principal = { sub: string; username: string; roles: string[] };

// Express pone aquí el principal para que el controlador lo lea.
import type { Request } from 'express';
export type AuthedRequest = Request & { principal?: Principal };
