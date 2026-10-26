// SE — autenticación entre servicios (api -> precios). Dos mediciones:
//  (1) En el borde de precios: qué acepta precios ante "sin token", "token de usuario" (aud=orders-api,
//      no va dirigido a precios) y "token de servicio" (client credentials, aud=precios-api).
//  (2) De extremo a extremo: api/antes (no manda token) vs api/despues (client credentials) contra
//      precios/despues.
import { Proc, waitUp, userAccessToken, serviceToken, environment, writeResult } from './lib/harness.ts';
import { API_PORT, PRECIOS_PORT, PRECIOS_URL, API_CLIENT, API_CLIENT_SECRET, USERS } from '../src/lib/config.ts';

const PRECIO = `${PRECIOS_URL}/precio?item=Monitor%2027%22`;

async function callPrecios(auth?: string): Promise<number> {
  const r = await fetch(PRECIO, auth ? { headers: { authorization: `Bearer ${auth}` } } : undefined);
  return r.status;
}

async function boundary(mode: 'antes' | 'despues', userTok: string, svcTok: string) {
  const precios = new Proc('src/sim/precios.ts', { MODE: mode });
  await waitUp(`${PRECIOS_URL}/health`);
  try {
    return { sinToken: await callPrecios(), usuario: await callPrecios(userTok), servicio: await callPrecios(svcTok) };
  } finally { await precios.stop(); }
}

// Extremo a extremo: api (en modo dado) llama a precios/despues a través de GET /orders/ord-a-1/precio.
async function endToEnd(apiMode: 'antes' | 'despues', userTok: string) {
  const precios = new Proc('src/sim/precios.ts', { MODE: 'despues' });
  await waitUp(`${PRECIOS_URL}/health`);
  const api = new Proc('dist/lib/main.js', { MODE: apiMode });
  await waitUp(`http://127.0.0.1:${API_PORT}/health`);
  try {
    const r = await fetch(`http://127.0.0.1:${API_PORT}/orders/ord-a-1/precio`, { headers: { authorization: `Bearer ${userTok}` } });
    const j: any = await r.json();
    return { apiStatus: r.status, preciosStatus: j?.precios?.status };
  } finally { await api.stop(); await precios.stop(); }
}

async function main() {
  const userTok = await userAccessToken('demo-cli', USERS.alice.username, USERS.alice.password);
  const svcTok = await serviceToken(API_CLIENT, API_CLIENT_SECRET);
  const bAntes = await boundary('antes', userTok, svcTok);
  const bDespues = await boundary('despues', userTok, svcTok);
  const eeAntes = await endToEnd('antes', userTok);
  const eeDespues = await endToEnd('despues', userTok);
  const env = await environment();
  const ok = (s: number) => `${s} ${s === 200 ? '(aceptado)' : '(rechazado)'}`;
  const md = `# SE — autenticación entre servicios (api -> precios)

${env}

## Borde de precios: qué acepta según el token

| Llamada a precios | precios **antes** (sin comprobar) | precios **despues** (valida aud=precios-api) |
|---|---|---|
| sin token | ${ok(bAntes.sinToken)} | ${ok(bDespues.sinToken)} |
| token de usuario (aud=orders-api) | ${ok(bAntes.usuario)} | ${ok(bDespues.usuario)} |
| token de servicio (client credentials, aud=precios-api) | ${ok(bAntes.servicio)} | ${ok(bDespues.servicio)} |

precios/despues rechaza el token del usuario aunque sea válido: no va dirigido a precios (su \`aud\` es \`orders-api\`). Solo acepta el token de servicio del cliente \`api\`.

## Extremo a extremo (api -> precios/despues)

| Versión de api | api responde | precios respondió |
|---|---|---|
| **antes** (no manda token a precios) | ${eeAntes.apiStatus} | ${ok(eeAntes.preciosStatus)} |
| **despues** (client credentials) | ${eeDespues.apiStatus} | ${ok(eeDespues.preciosStatus)} |

Corrección en \`src/despues/precios.client.ts\`: api pide su propio token con \`grant_type=client_credentials\` (cliente confidencial \`api\`, \`aud=precios-api\`) y lo manda en \`Authorization\`. No propaga el token del usuario (que no va dirigido a precios).
`;
  writeResult('SE_SERVICIOS.md', md);
  console.log(`RESULT ${JSON.stringify({ scenario: 'SE', boundaryAntes: bAntes, boundaryDespues: bDespues, e2eAntes: eeAntes, e2eDespues: eeDespues })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
