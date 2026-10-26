// Configuración común de la demo de seguridad (M8, S12).
// Todo escucha solo en 127.0.0.1 y en el rango 18600-18649. Proyecto Compose: s12-sec.
// Nada de esto son secretos de verdad: Keycloak corre en start-dev con un realm de juguete.

export const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://127.0.0.1:18600';
export const REALM = process.env.REALM ?? 'demo';
export const ISSUER = `${KEYCLOAK_URL}/realms/${REALM}`;
export const JWKS_URL = `${ISSUER}/protocol/openid-connect/certs`;
export const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;

// Clientes del realm (ver keycloak/realm-export.json):
//  - spa-demo:  público, PKCE S256, authorization code (es el del dibujo del flujo).
//  - demo-cli:  público, direct access grants: los scripts piden tokens reales de A y B sin navegador.
//  - api:       confidencial, service accounts (client credentials) para api -> precios.
export const SPA_CLIENT = process.env.SPA_CLIENT ?? 'spa-demo';
export const CLI_CLIENT = process.env.CLI_CLIENT ?? 'demo-cli';
export const API_CLIENT = process.env.API_CLIENT ?? 'api';
export const API_CLIENT_SECRET = process.env.API_CLIENT_SECRET ?? 'api-secret-demo-solo-clase';

// El recurso que protege la API: despues/ exige que el access token traiga este aud.
export const API_AUDIENCE = process.env.API_AUDIENCE ?? 'orders-api';
// El recurso que protege precios: solo acepta tokens con este aud (client credentials de api).
export const PRECIOS_AUDIENCE = process.env.PRECIOS_AUDIENCE ?? 'precios-api';

export const API_PORT = Number(process.env.API_PORT ?? 18610);
export const PRECIOS_PORT = Number(process.env.PRECIOS_PORT ?? 18620);
export const INTERNAL_PORT = Number(process.env.INTERNAL_PORT ?? 18630);
export const PRECIOS_URL = process.env.PRECIOS_URL ?? `http://127.0.0.1:${PRECIOS_PORT}`;
export const INTERNAL_URL = process.env.INTERNAL_URL ?? `http://127.0.0.1:${INTERNAL_PORT}`;

// antes | despues. Lo lee src/lib/main.ts para elegir qué módulo de NestJS arranca.
export const MODE = (process.env.MODE ?? 'despues') as 'antes' | 'despues';

// Usuarios del realm. Las contraseñas están en el realm importado; de juguete.
// "sub" es el id del usuario en Keycloak, fijado en realm-export.json para que sea el mismo en cada
// importación: es el claim estable con el que se guarda y se compara el dueño de un recurso.
export const USERS = {
  alice: { username: 'alice', password: 'alice123', sub: '00000000-0000-4000-8000-0000000a11ce' },
  bob: { username: 'bob', password: 'bob123', sub: '00000000-0000-4000-8000-000000000b0b' },
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
