// SD — SSRF (OWASP API7:2023). La API tiene un endpoint que descarga una URL dada por el usuario
// (el "webhook de destino"). antes la trae sin mirar; despues valida esquema y destino. Se prueban
// destinos internos (incluido el servicio interno simulado, que devuelve un "secreto") y uno público.
// TODO contra la propia demo local. Hay un solo servicio interno real escuchando en 127.0.0.1:18630.
import { Proc, waitUp, userAccessToken, environment, writeResult } from './lib/harness.ts';
import { API_PORT, INTERNAL_PORT, USERS } from '../src/lib/config.ts';

const BASE = `http://127.0.0.1:${API_PORT}`;

const TARGETS = [
  { nombre: 'servicio interno simulado (IP loopback)', url: `http://127.0.0.1:${INTERNAL_PORT}/secret`, clase: 'interno-vivo' },
  { nombre: 'servicio interno (nombre localhost)', url: `http://localhost:${INTERNAL_PORT}/secret`, clase: 'interno' },
  // "Esta red": 0.0.0.0 y su par IPv6 '::' llegan a la máquina local. Se agregaron tras la revisión:
  // la primera lista de bloqueo de despues no los incluía.
  { nombre: 'servicio interno (0.0.0.0)', url: `http://0.0.0.0:${INTERNAL_PORT}/secret`, clase: 'interno' },
  { nombre: 'servicio interno (IPv6 no especificada [::])', url: `http://[::]:${INTERNAL_PORT}/secret`, clase: 'interno' },
  { nombre: 'servicio interno (IPv4 mapeada [::ffff:127.0.0.1])', url: `http://[::ffff:127.0.0.1]:${INTERNAL_PORT}/secret`, clase: 'interno' },
  { nombre: 'metadatos de la nube', url: 'http://169.254.169.254/latest/meta-data/', clase: 'interno' },
  { nombre: 'IP privada', url: 'http://10.0.0.5/health', clase: 'interno' },
  { nombre: 'esquema file://', url: 'file:///etc/passwd', clase: 'interno' },
  { nombre: 'destino público (IP literal)', url: 'http://93.184.216.34/', clase: 'publico' },
];

async function fetchUrl(token: string, url: string): Promise<{ status: number; json: any }> {
  const r = await fetch(`${BASE}/fetch`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  let json: any = null; try { json = await r.json(); } catch { /* vacío */ }
  return { status: r.status, json };
}

async function measure(mode: 'antes' | 'despues') {
  const api = new Proc('dist/lib/main.js', { MODE: mode });
  await waitUp(`${BASE}/health`);
  try {
    const token = await userAccessToken('demo-cli', USERS.alice.username, USERS.alice.password);
    const rows: any[] = [];
    for (const t of TARGETS) {
      const res = await fetchUrl(token, t.url);
      const blocked = res.status === 400 && res.json?.blocked === true;
      const reached = res.json?.reached === true;
      const leaked = reached && typeof res.json?.body === 'string' && res.json.body.includes('TOKEN-INTERNO');
      rows.push({ ...t, status: res.status, blocked, reached, leaked });
    }
    return rows;
  } finally { await api.stop(); }
}

async function main() {
  const internal = new Proc('src/sim/internal.ts');
  await waitUp(`http://127.0.0.1:${INTERNAL_PORT}/health`);
  let antes: any[], despues: any[];
  try {
    antes = await measure('antes');
    despues = await measure('despues');
  } finally { await internal.stop(); }
  const env = await environment();
  const internos = TARGETS.filter((t) => t.clase !== 'publico').length;
  const cnt = (rows: any[], pred: (r: any) => boolean) => rows.filter(pred).length;
  const line = (r: any) => `| ${r.nombre} | ${r.clase === 'publico' ? 'público' : 'interno'} | ${r.blocked ? 'bloqueado (400)' : r.leaked ? '**secreto filtrado**' : r.reached ? `alcanzado (${r.status})` : 'no alcanzado'} |`;
  const md = `# SD — SSRF (descargar una URL del usuario)

${env}

La API recibe \`POST /fetch {url}\` y descarga esa URL. Solo hay un servicio interno real escuchando (127.0.0.1:${INTERNAL_PORT}, solo IPv4), que devuelve un "secreto". Cinco destinos apuntan a ese servicio escrito de cinco maneras (IP de loopback, \`localhost\`, \`0.0.0.0\`, \`[::]\` y la IPv4 mapeada \`[::ffff:127.0.0.1]\`); los demás destinos internos no tienen servidor vivo, así que miden si la API **intenta** alcanzarlos (antes) o los **bloquea antes de pedir** (despues). Qué formas llegan de verdad depende del sistema operativo y de la familia en la que escucha el servicio (aquí, solo IPv4); la tabla de antes muestra lo que pasó en esta máquina (\`${process.platform}\`).

## antes (descarga cualquier URL)

| Destino | Clase | Resultado |
|---|---|---|
${antes.map(line).join('\n')}

- Secreto interno filtrado: **${cnt(antes, (r) => r.leaked)}** destino(s). Bloqueados antes de pedir: **${cnt(antes, (r) => r.blocked)}** de ${internos}.

## despues (valida esquema y destino)

| Destino | Clase | Resultado |
|---|---|---|
${despues.map(line).join('\n')}

- Secreto interno filtrado: **${cnt(despues, (r) => r.leaked)}**. Destinos internos bloqueados antes de pedir: **${cnt(despues, (r) => r.blocked)}** de ${internos}. El destino público **no** se bloquea (pasa la validación; aquí no se alcanza porque la demo no tiene salida a internet): la defensa bloquea lo interno, no todo.

Corrección en \`src/despues/orders.controller.ts\` (\`fetch\`) + \`src/despues/safe-url.ts\`: solo \`http\`/\`https\`, se resuelve el host a IP y se rechaza loopback, «esta red» (\`0.0.0.0/8\` y \`::\`), privadas, CGNAT, enlace-local (metadatos 169.254.169.254), única-local IPv6, NAT64 y rangos reservados. Las IPv4 mapeadas (\`::ffff:a.b.c.d\`) caen por las reglas IPv4.
`;
  writeResult('SD_SSRF.md', md);
  console.log(`RESULT ${JSON.stringify({ scenario: 'SD', antesLeaked: cnt(antes, (r) => r.leaked), antesBlocked: cnt(antes, (r) => r.blocked), despuesLeaked: cnt(despues, (r) => r.leaked), despuesBlocked: cnt(despues, (r) => r.blocked), internos })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
