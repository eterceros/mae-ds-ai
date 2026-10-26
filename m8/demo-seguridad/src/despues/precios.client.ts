// DESPUES — api se autentica ante precios con client credentials.
// CORRECCIÓN: en vez de llamar a precios sin credenciales (o de reenviar el token del usuario, que no
// va dirigido a precios), api pide su propio token de servicio (grant client_credentials) y lo manda.
// Ese token lleva aud=precios-api y azp=api; precios lo valida igual que la API valida el del usuario.
import { PRECIOS_URL, TOKEN_URL, API_CLIENT, API_CLIENT_SECRET } from '../lib/config';

let cached: { token: string; exp: number } | null = null;

async function serviceToken(): Promise<string> {
  if (cached && Date.now() < cached.exp) return cached.token;
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: API_CLIENT,
      client_secret: API_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`no se pudo obtener el token de servicio: ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in - 30) * 1000 };
  return cached.token;
}

export async function fetchPrecio(item: string): Promise<{ status: number; body: unknown }> {
  const token = await serviceToken();
  const r = await fetch(`${PRECIOS_URL}/precio?item=${encodeURIComponent(item)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: r.status, body: r.ok ? await r.json() : await r.text() };
}
