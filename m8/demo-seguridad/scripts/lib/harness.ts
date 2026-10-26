// Piezas comunes de los scripts de medición: lanzar/parar procesos (la API y los servicios
// simulados), pedir tokens reales a Keycloak, fabricar tokens manipulados con jose, y escribir
// resultados. Todos los ataques se hacen SOLO contra esta demo local.
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import { SignJWT, generateKeyPair, exportSPKI, importJWK } from 'jose';
import { TOKEN_URL, JWKS_URL, ISSUER, sleep } from '../../src/lib/config.ts';

export { sleep };

export class Proc {
  child: ChildProcess;
  log: string[] = [];
  constructor(file: string, env: Record<string, string> = {}, args: string[] = []) {
    this.child = spawn(process.execPath, ['--no-warnings', file, ...args], {
      env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (d: Buffer) => { for (const l of d.toString().split('\n')) if (l.trim()) this.log.push(l.trimEnd()); };
    this.child.stdout!.on('data', keep);
    this.child.stderr!.on('data', keep);
  }
  exited() {
    return this.child.exitCode !== null ? Promise.resolve(this.child.exitCode) : new Promise<number | null>((r) => this.child.once('exit', r));
  }
  async stop() {
    if (this.child.exitCode !== null) return;
    const d = this.exited();
    this.child.kill();
    const killed = await Promise.race([d, sleep(2500).then(() => 'timeout' as const)]);
    if (killed === 'timeout') { this.child.kill('SIGKILL'); await d; }
  }
}

// Espera a que un servidor responda cualquier cosa (incluido 401): señal de que ya escucha.
export async function waitUp(url: string, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { await fetch(url); return; } catch { /* todavía no */ }
    await sleep(150);
  }
  throw new Error(`no responde: ${url}`);
}

// --- Tokens reales de Keycloak ---
export async function password(client: string, username: string, pass: string, scope = ''): Promise<any> {
  const body = new URLSearchParams({ grant_type: 'password', client_id: client, username, password: pass });
  if (scope) body.set('scope', scope);
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`token ${client}/${username}: ${r.status} ${await r.text()}`);
  return r.json();
}
export async function userAccessToken(client: string, username: string, pass: string): Promise<string> {
  return (await password(client, username, pass)).access_token;
}
export async function userIdToken(client: string, username: string, pass: string): Promise<string> {
  return (await password(client, username, pass, 'openid')).id_token;
}
export async function serviceToken(client: string, secret: string): Promise<string> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: client, client_secret: secret }),
  });
  if (!r.ok) throw new Error(`client_credentials ${client}: ${r.status}`);
  return (await r.json()).access_token;
}

export const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function decodePayload(token: string): any {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
}

// --- Tokens manipulados (se fabrican aquí, solo para atacarse a uno mismo) ---
// Base: el payload de un access token real, con aud=orders-api y exp en el futuro, para que el ÚNICO
// defecto sea el que anuncia cada variante.
export function basePayload(realToken: string) {
  const p = decodePayload(realToken);
  const now = Math.floor(Date.now() / 1000);
  return { iss: p.iss, sub: p.sub, preferred_username: p.preferred_username, realm_access: p.realm_access,
    aud: 'orders-api', azp: p.azp, typ: 'Bearer', iat: now, exp: now + 300 };
}

// alg=none: cabecera sin firma. Un verificador que respete el "alg" del token lo aceptaría sin clave.
export function forgeAlgNone(payload: object): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(payload)}.`;
}

// Confusión de claves: HS256 usando la clave PÚBLICA RSA del emisor (su PEM) como secreto compartido.
export async function keycloakPublicPem(): Promise<string> {
  const jwks = await (await fetch(JWKS_URL)).json();
  const sig = jwks.keys.find((k: any) => k.use === 'sig' && k.alg === 'RS256');
  const key = await importJWK(sig, 'RS256');
  return exportSPKI(key as CryptoKey);
}
export async function forgeHS256(payload: object, pem: string): Promise<string> {
  return new SignJWT(payload as any).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(new TextEncoder().encode(pem));
}

// Firmado por OTRA clave: un par RSA del atacante, con un kid que el JWKS no conoce.
export async function forgeWrongKey(payload: object): Promise<string> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  return new SignJWT(payload as any).setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'atacante' }).sign(privateKey);
}

// --- Utilidades de salida ---
export const median = (xs: number[]) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
export const range = (xs: number[], digits = 0) => {
  const f = (x: number) => x.toFixed(digits);
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? '—' : s[0] === s[s.length - 1] ? f(s[0]) : `${f(s[0])}-${f(s[s.length - 1])}`;
};

export async function environment() {
  const cpu = os.cpus()[0].model.trim();
  let docker = process.env.DOCKER_INFO ?? '';
  const kc = 'Keycloak 26.8.1 (start-dev), realm importado';
  return `Máquina: ${cpu}, ${os.cpus().length} hilos lógicos, ${Math.round(os.totalmem() / 2 ** 30)} GB de RAM, ` +
    `${os.type()} ${os.release()}, Node ${process.version}. ${kc}. ${docker ? docker + '. ' : ''}` +
    `Emisor: ${ISSUER}. API, precios, servicio interno y scripts en el anfitrión.`;
}

export function writeResult(file: string, md: string) {
  const dir = process.env.SMOKE ? 'results/raw/' : 'results/';
  const name = process.env.SMOKE ? `smoke-${file}` : file;
  mkdirSync(new URL(`../../${dir}`, import.meta.url), { recursive: true });
  writeFileSync(new URL(`../../${dir}${name}`, import.meta.url), md);
  console.log(`\n-> ${dir}${name}`);
}

export const today = () => new Date().toISOString().slice(0, 10);
