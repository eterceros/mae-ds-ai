// Anexo de SB — rotación del refresh token en Keycloak. Medición corta: ¿un refresh token ya usado
// (R1) sirve otra vez? ¿Y el que lo reemplazó (R2), después de que alguien reusó R1?
// Se mide con la opción del realm "Revoke Refresh Token" apagada (el valor por defecto de Keycloak)
// y encendida (con "Refresh Token Max Reuse" = 0, como la deja keycloak/realm-export.json), más una
// fila de control encendida sin reuso. El script cambia la opción por la API de administración
// (admin/admin, solo esta demo local) y al final la deja como en el realm importado (encendida).
import { password, environment, writeResult } from './lib/harness.ts';
import { KEYCLOAK_URL, REALM, TOKEN_URL, USERS } from '../src/lib/config.ts';

type Res = { status: number; rt?: string; error?: string };

async function adminToken(): Promise<string> {
  const r = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  });
  if (!r.ok) throw new Error(`admin token: ${r.status}`);
  return (await r.json()).access_token;
}

async function setRevoke(on: boolean) {
  const r = await fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}`, {
    method: 'PUT', headers: { authorization: `Bearer ${await adminToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ revokeRefreshToken: on, refreshTokenMaxReuse: 0 }),
  });
  if (r.status !== 204) throw new Error(`no se pudo cambiar revokeRefreshToken: ${r.status}`);
}

async function refresh(rt: string): Promise<Res> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'demo-cli', refresh_token: rt }),
  });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, rt: j.refresh_token, error: j.error_description ?? j.error };
}

async function measure(on: boolean, reuseR1 = true) {
  await setRevoke(on);
  const r1 = (await password('demo-cli', USERS.alice.username, USERS.alice.password)).refresh_token as string;
  const first = await refresh(r1);                          // uso legítimo de R1 -> R2
  const reuse = reuseR1 ? await refresh(r1) : null;          // alguien vuelve a usar R1 (lo robó)
  const r2: Res = first.rt ? await refresh(first.rt) : { status: 0 }; // el dueño legítimo usa R2
  return { on, reuseR1, first, reuse, r2 };
}

const fmt = (x: Res) => x.status === 200 ? '**200** (acepta)' : `**${x.status}** (${x.error ?? 'rechaza'})`;

async function main() {
  let rows: Awaited<ReturnType<typeof measure>>[];
  try {
    rows = [await measure(false), await measure(true), await measure(true, false)];
  } finally {
    await setRevoke(true); // como en realm-export.json
  }
  const env = await environment();
  const label = (r: (typeof rows)[number]) =>
    (r.on ? 'encendido (Max reuse = 0)' : 'apagado (por defecto en Keycloak)') + (r.reuseR1 ? '' : ', **control sin reuso**');
  const [off, on, ctrl] = rows;
  const md = `# Anexo de SB — rotación del refresh token en Keycloak

${env}

Una sola pasada (sin tiempos; el resultado depende solo de la configuración). Cliente público \`demo-cli\`, usuaria Alice. R1 es el refresh token del login; R2, el que Keycloak entrega al usar R1.

| «Revoke Refresh Token» del realm | 1) usar R1 (legítimo) | 2) volver a usar R1 (reuso) | 3) usar R2 |
|---|---|---|---|
${rows.map((r) => `| ${label(r)} | ${fmt(r.first)} | ${r.reuse ? fmt(r.reuse) : '(no se reusa)'} | ${fmt(r.r2)} |`).join('\n')}

- **Apagado** (valor por defecto de Keycloak): R1 ${off.reuse?.status === 200 ? 'sigue valiendo después de usarse; la «rotación» no protege de un refresh token robado' : 'no vale después de usarse'}.
- **Encendido**: Keycloak ${on.reuse?.status === 200 ? 'acepta' : 'rechaza'} el segundo uso de R1, y después del reuso el R2 ya emitido ${on.r2.status === 200 ? 'sigue valiendo (no se invalida la «familia»)' : 'también queda rechazado'}.
- **Control** (encendido, sin reuso): R2 ${ctrl.r2.status === 200 ? 'vale, así que el rechazo de R2 en la fila anterior lo causa el reuso de R1' : 'tampoco vale sin reuso: el rechazo no se puede atribuir al reuso'}.
${on.r2.status !== 200 && on.r2.error ? `- El mensaje con el que Keycloak rechaza R2 («${on.r2.error}») sugiere que, al detectar el reuso, saca a este cliente de la sesión del usuario, y con eso cae todo refresh token de esa sesión para ese cliente. Es una lectura del mensaje, no de la documentación.\n` : ''}- Medido en Keycloak 26.8.1 con un cliente público y direct grants; no se comprobó con otros flujos ni otras versiones, ni qué pasa con el access token vigente (sigue valiendo hasta su \`exp\`: es un JWT que la API valida sin consultar a Keycloak).

El realm de la demo (\`keycloak/realm-export.json\`) lo deja **encendido** (\`revokeRefreshToken: true\`, \`refreshTokenMaxReuse: 0\`); este script lo apaga para la primera fila y lo vuelve a encender al terminar.
`;
  writeResult('SB_REFRESH.md', md);
  console.log(`RESULT ${JSON.stringify({ scenario: 'SB-refresh', rows: rows.map((r) => ({ on: r.on, reuseR1: r.reuseR1, first: r.first.status, reuse: r.reuse?.status ?? null, reuseErr: r.reuse?.error ?? null, r2: r.r2.status, r2Err: r.r2.error ?? null })) })}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
