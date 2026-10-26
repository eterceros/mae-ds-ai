// SA — BOLA (OWASP API1:2023). ¿Cuántos de los 5 pedidos de Bob puede leer y modificar Alice,
// usando su propio token válido? antes: todos; despues: ninguno (404).
import { Proc, waitUp, userAccessToken, environment, writeResult, decodePayload } from './lib/harness.ts';
import { API_PORT, USERS } from '../src/lib/config.ts';

const BASE = `http://127.0.0.1:${API_PORT}`;
const BOB_ORDERS = ['ord-b-1', 'ord-b-2', 'ord-b-3', 'ord-b-4', 'ord-b-5'];
const ALICE_OWN = 'ord-a-1';
const RUNS = Number(process.env.RUNS ?? 3);

async function get(id: string, token: string) {
  const r = await fetch(`${BASE}/orders/${id}`, { headers: { authorization: `Bearer ${token}` } });
  return r.status;
}
async function patch(id: string, token: string, item: string) {
  const r = await fetch(`${BASE}/orders/${id}`, {
    method: 'PATCH', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ item }),
  });
  return r.status;
}

async function measure(mode: 'antes' | 'despues') {
  const api = new Proc('dist/lib/main.js', { MODE: mode });
  await waitUp(`${BASE}/health`);
  try {
    const token = await userAccessToken('demo-cli', USERS.alice.username, USERS.alice.password);
    // El dueño se guarda y se compara por "sub"; el id de Alice está fijado en el realm importado.
    const sub = decodePayload(token).sub;
    if (sub !== USERS.alice.sub) throw new Error(`sub de Alice inesperado: ${sub} (¿realm sin el id fijo?)`);
    const ownOk = (await get(ALICE_OWN, token)) === 200; // control: Alice sí ve lo suyo
    let read = 0, modified = 0;
    for (const id of BOB_ORDERS) {
      if ((await get(id, token)) === 200) read++;
      if ((await patch(id, token, 'HACKEADO-POR-ALICE')) === 200) modified++;
    }
    return { read, modified, ownOk };
  } finally { await api.stop(); }
}

async function main() {
  const runs = { antes: [] as any[], despues: [] as any[] };
  for (let i = 0; i < RUNS; i++) { runs.antes.push(await measure('antes')); runs.despues.push(await measure('despues')); }
  const env = await environment();
  const uniq = (xs: number[]) => [...new Set(xs)].join('/');
  const cells = (rs: any[]) => `${uniq(rs.map((r) => r.read))} de 5 | ${uniq(rs.map((r) => r.modified))} de 5`;
  const md = `# SA — BOLA (acceso a objetos de otro usuario)

${env}

Alice usa su token válido (cliente \`demo-cli\`) para pedir y modificar los 5 pedidos de Bob (\`ord-b-1..5\`). ${RUNS} corridas; el resultado es determinista. Control: Alice sí puede ver su propio pedido (\`ord-a-1\`). El dueño de cada pedido es el \`sub\` del usuario (su id en Keycloak, fijado en el realm importado: Alice \`${USERS.alice.sub}\`, Bob \`${USERS.bob.sub}\`); el script comprueba que el token de Alice lleve ese \`sub\`.

| Versión | Pedidos de Bob leídos por Alice | Pedidos de Bob modificados por Alice | Alice ve lo suyo |
|---|---|---|---|
| **antes** (sin comprobar dueño) | ${cells(runs.antes)} | ${runs.antes.every((r) => r.ownOk) ? 'sí' : 'no'} |
| **despues** (\`o.owner === principal.sub\`, 404) | ${cells(runs.despues)} | ${runs.despues.every((r) => r.ownOk) ? 'sí' : 'no'} |

- **antes**: ${runs.antes.map((r) => r.read).join(', ')} leídos y ${runs.antes.map((r) => r.modified).join(', ')} modificados (de 5) por corrida.
- **despues**: ${runs.despues.map((r) => r.read).join(', ')} leídos y ${runs.despues.map((r) => r.modified).join(', ')} modificados (de 5) por corrida.

La corrección está en \`src/despues/orders.controller.ts\` (\`// CORRECCIÓN:\` en \`get\` y \`patch\`): se comprueba que el dueño del pedido sea el \`sub\` del token (no \`preferred_username\`, que no es único ni estable) y, si no, se responde **404** (no 403) para no revelar que existe.
`;
  writeResult('SA_BOLA.md', md);
  console.log(`RESULT ${JSON.stringify({ scenario: 'SA', antes: runs.antes[0], despues: runs.despues[0] })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
