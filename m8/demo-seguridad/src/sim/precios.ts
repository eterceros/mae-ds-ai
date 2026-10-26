// Servicio "precios": un servicio interno al que llama api (escenario SE, autenticación entre servicios).
// MODE=antes  -> no comprueba quién llama: responde a cualquiera (incluido sin token).
// MODE=despues-> exige un access token válido dirigido a precios (aud=precios-api), igual que la API
//                valida el del usuario: firma por JWKS, algoritmo fijo, iss y aud.
// Se ejecuta con Node 24 directamente (sin compilar). No usa decoradores.
import http from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { PRECIOS_PORT, JWKS_URL, ISSUER, PRECIOS_AUDIENCE } from '../lib/config.ts';

const MODE = (process.env.MODE ?? 'despues') as 'antes' | 'despues';
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

function priceFor(item: string): number {
  let h = 0;
  for (const c of item) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 1000 + (h % 90000); // céntimos, determinista por artículo
}

async function authorized(req: http.IncomingMessage): Promise<boolean> {
  if (MODE === 'antes') return true; // ANTES: sin comprobación.
  const token = String(req.headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  try {
    await jwtVerify(token, JWKS, { algorithms: ['RS256'], issuer: ISSUER, audience: PRECIOS_AUDIENCE, clockTolerance: 5 });
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PRECIOS_PORT}`);
  if (url.pathname === '/health') { res.writeHead(200).end('{"ok":true}'); return; }
  if (url.pathname !== '/precio') { res.writeHead(404).end(); return; }
  if (!(await authorized(req))) { res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"sin credenciales válidas"}'); return; }
  const item = url.searchParams.get('item') ?? '';
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ item, priceCents: priceFor(item) }));
});

server.listen(PRECIOS_PORT, '127.0.0.1', () => console.log(`RESULT ${JSON.stringify({ service: 'precios', mode: MODE, port: PRECIOS_PORT })}`));
