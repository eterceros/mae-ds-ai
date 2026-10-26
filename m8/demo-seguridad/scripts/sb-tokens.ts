// SB — tokens manipulados (OWASP API2:2023). Se fabrican 6 tokens, cada uno con UN solo defecto, y
// uno válido de control. Se mide cuántos acepta la API en antes vs despues, pidiendo un pedido propio
// de Alice (/orders/ord-a-1), de modo que el único motivo de rechazo posible es la autenticación.
// Los tokens "sin aud" y "expirado" son emitidos de verdad por Keycloak (clientes demo-noaud y
// demo-short) para aislar las comprobaciones de aud y exp; los demás se fabrican con jose.
import {
  Proc, waitUp, userAccessToken, userIdToken, password, basePayload,
  forgeAlgNone, forgeHS256, forgeWrongKey, keycloakPublicPem, sleep,
  environment, writeResult,
} from './lib/harness.ts';
import { API_PORT, USERS } from '../src/lib/config.ts';

const BASE = `http://127.0.0.1:${API_PORT}`;
const RUNS = Number(process.env.RUNS ?? 3);

async function buildTokens() {
  const real = await userAccessToken('demo-cli', USERS.alice.username, USERS.alice.password);
  const base = basePayload(real);
  const pem = await keycloakPublicPem();
  // El token expirado real: se pide con 1 s de vida y luego se espera a que caduque.
  const expiraPronto = (await password('demo-short', USERS.alice.username, USERS.alice.password)).access_token;
  const tokens: { nombre: string; defecto: string; token: string }[] = [
    { nombre: 'válido (control)', defecto: 'ninguno', token: real },
    { nombre: 'sin firma (alg=none)', defecto: 'algoritmo none', token: forgeAlgNone(base) },
    { nombre: 'confusión de claves (HS256 con la clave pública)', defecto: 'alg HS256', token: await forgeHS256(base, pem) },
    { nombre: 'firmado por otra clave', defecto: 'firma/kid desconocido', token: await forgeWrongKey(base) },
    { nombre: 'sin aud', defecto: 'falta aud=orders-api', token: (await password('demo-noaud', USERS.alice.username, USERS.alice.password)).access_token },
    { nombre: 'expirado', defecto: 'exp en el pasado', token: expiraPronto },
    { nombre: 'ID token como access token', defecto: 'aud=cliente, typ=ID', token: await userIdToken('demo-cli', USERS.alice.username, USERS.alice.password) },
  ];
  // despues admite 5 s de desfase de reloj (clockTolerance), así que hay que esperar más que eso:
  // vida de 1 s + 5 s de tolerancia + margen.
  await sleep(7000);
  return tokens;
}

async function hit(token: string): Promise<number> {
  const r = await fetch(`${BASE}/orders/ord-a-1`, { headers: { authorization: `Bearer ${token}` } });
  return r.status;
}

async function measure(mode: 'antes' | 'despues', tokens: { token: string }[]) {
  const api = new Proc('dist/lib/main.js', { MODE: mode });
  await waitUp(`${BASE}/health`);
  try { const out: number[] = []; for (const t of tokens) out.push(await hit(t.token)); return out; }
  finally { await api.stop(); }
}

async function main() {
  const tokens = await buildTokens();
  let antes: number[] = [], despues: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const a = await measure('antes', tokens), d = await measure('despues', tokens);
    if (i === 0) { antes = a; despues = d; }
    else if (JSON.stringify(a) !== JSON.stringify(antes) || JSON.stringify(d) !== JSON.stringify(despues)) {
      throw new Error(`corrida ${i} no determinista: ${a} / ${d}`);
    }
  }
  const env = await environment();
  const manip = tokens.map((_, i) => i).filter((i) => i !== 0);
  const antesAcc = manip.filter((i) => antes[i] === 200).length;
  const despAcc = manip.filter((i) => despues[i] === 200).length;
  const rows = tokens.map((t, i) =>
    `| ${t.nombre} | ${t.defecto} | ${antes[i]} ${antes[i] === 200 ? '(aceptado)' : '(rechazado)'} | ${despues[i]} ${despues[i] === 200 ? '(aceptado)' : '(rechazado)'} |`).join('\n');
  const md = `# SB — tokens manipulados

${env}

Resultado determinista, idéntico en las ${RUNS} corridas. Se pide \`GET /orders/ord-a-1\` (un pedido de la propia Alice) con cada token; el único motivo de rechazo posible es la autenticación.

| Token | Defecto | antes | despues |
|---|---|---|---|
${rows}

**Manipulados aceptados: ${antesAcc} de ${manip.length} en \`antes\`; ${despAcc} de ${manip.length} en \`despues\`.** El token válido lo aceptan ambos (${antes[0]} / ${despues[0]}).

- \`antes\` (\`src/antes/auth.guard.ts\`): decodifica el payload sin verificar nada → acepta cualquier token con un \`sub\` dentro.
- \`despues\` (\`src/despues/auth.guard.ts\`): \`jose.jwtVerify\` con JWKS, \`algorithms:['RS256']\`, \`issuer\`, \`audience:'orders-api'\` y \`exp\`; además rechaza \`typ !== 'Bearer'\`. Cada defecto cae en una de esas comprobaciones.
`;
  writeResult('SB_TOKENS.md', md);
  console.log(`RESULT ${JSON.stringify({ scenario: 'SB', antesAccepted: antesAcc, despuesAccepted: despAcc, total: manip.length, antes, despues })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
