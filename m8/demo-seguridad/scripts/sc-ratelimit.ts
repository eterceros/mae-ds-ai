// SC — límite por identidad. Alice y Bob están detrás de la misma IP (127.0.0.1). Alice agota su cupo
// (LIMIT peticiones) y luego Bob hace N. Con límite por IP (antes) Bob queda bloqueado por culpa de
// Alice; con límite por sub (despues), no. El algoritmo (ventana fija) es el de S05/S06; solo cambia
// la clave. Endpoint: GET /ping (requiere token).
import { Proc, waitUp, userAccessToken, environment, writeResult } from './lib/harness.ts';
import { API_PORT, USERS } from '../src/lib/config.ts';

const BASE = `http://127.0.0.1:${API_PORT}`;
const LIMIT = Number(process.env.RL_LIMIT ?? 20);
const N_BOB = Number(process.env.N_BOB ?? 10);
const WINDOW_MS = 60000; // una sola ventana durante toda la prueba
const RUNS = Number(process.env.RUNS ?? 3);

async function ping(token: string): Promise<number> {
  const r = await fetch(`${BASE}/ping`, { headers: { authorization: `Bearer ${token}` } });
  return r.status;
}

async function measure(mode: 'antes' | 'despues') {
  const api = new Proc('dist/lib/main.js', { MODE: mode, RL_LIMIT: String(LIMIT), RL_WINDOW_MS: String(WINDOW_MS) });
  await waitUp(`${BASE}/health`);
  try {
    const alice = await userAccessToken('demo-cli', USERS.alice.username, USERS.alice.password);
    const bob = await userAccessToken('demo-cli', USERS.bob.username, USERS.bob.password);
    let aliceOk = 0;
    for (let i = 0; i < LIMIT; i++) if ((await ping(alice)) === 200) aliceOk++; // Alice llena su cupo
    let bobOk = 0, bob429 = 0;
    for (let i = 0; i < N_BOB; i++) { const s = await ping(bob); if (s === 200) bobOk++; else if (s === 429) bob429++; }
    return { aliceOk, bobOk, bob429 };
  } finally { await api.stop(); }
}

async function main() {
  let antes: any, despues: any;
  for (let i = 0; i < RUNS; i++) {
    const a = await measure('antes'), d = await measure('despues');
    if (i === 0) { antes = a; despues = d; }
    else if (JSON.stringify(a) !== JSON.stringify(antes) || JSON.stringify(d) !== JSON.stringify(despues)) {
      throw new Error(`corrida ${i} no determinista`);
    }
  }
  const env = await environment();
  const md = `# SC — límite por identidad (IP vs sub)

${env}

Alice agota su cupo (${LIMIT} peticiones a \`GET /ping\`) y después Bob hace ${N_BOB}, todos desde la misma IP (127.0.0.1). Determinista en las ${RUNS} corridas.

| Versión | Alice OK | Bob OK | Bob bloqueado (429) |
|---|---|---|---|
| **antes** (clave = IP) | ${antes.aliceOk}/${LIMIT} | ${antes.bobOk}/${N_BOB} | **${antes.bob429}/${N_BOB}** |
| **despues** (clave = sub del token) | ${despues.aliceOk}/${LIMIT} | ${despues.bobOk}/${N_BOB} | **${despues.bob429}/${N_BOB}** |

Con la clave por IP, Alice consume el cupo compartido y Bob recibe ${antes.bob429} de ${N_BOB} \`429\` sin haber hecho nada: un usuario legítimo bloquea a otro. Con la clave por \`sub\`, cada uno tiene su propio cupo y Bob no se ve afectado (${despues.bob429}/${N_BOB}).

Corrección en \`src/despues/ratelimit.guard.ts\` (\`// CORRECCIÓN:\`): la clave es \`principal.sub\`, no \`req.ip\`. El algoritmo de ventana fija no cambia (es de S05/S06).
`;
  writeResult('SC_RATELIMIT.md', md);
  console.log(`RESULT ${JSON.stringify({ scenario: 'SC', antes, despues, limit: LIMIT, nBob: N_BOB })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
