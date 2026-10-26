// Shared helpers for the measurement scripts: kubectl against the demo cluster only, kube-linter
// through Docker, port-forward, a load Pod inside the cluster, medians and result files.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONTEXT = 'kind-s11-demo';     // never touch another cluster
export const NS = 's11';
export const KUBE_LINTER = 'stackrox/kube-linter:v0.8.3';
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function kubectl(args: string[], opts: { input?: string; allowFail?: boolean } = {}) {
  const r = spawnSync('kubectl', ['--context', CONTEXT, ...args], { input: opts.input, encoding: 'utf8', cwd: ROOT });
  const res = { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  if (res.code !== 0 && !opts.allowFail) throw new Error(`kubectl ${args.join(' ')}\n${res.err || res.out}`);
  return res;
}
export const kjson = (args: string[]) => JSON.parse(kubectl([...args, '-o', 'json']).out);

/** kube-linter in a container; `dir` is mounted read-only. Returns the findings (one per line). */
export function kubeLinter(dir: string, file = '') {
  const r = spawnSync('docker', ['run', '--rm', '-v', `${dir}:/m:ro`, KUBE_LINTER, 'lint', `/m/${file}`],
    { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  const lines = (r.stdout + '\n' + r.stderr).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('/m/'));
  return lines.map((l) => {
    const obj = l.match(/\(object: ([^)]*)\)/)?.[1] ?? '';
    const check = l.match(/\(check: ([^,]+),/)?.[1] ?? '';
    return { obj, check, line: l.replace(/ \(check: .*$/, '') };
  });
}

export function restarts(selector: string, ns = NS): number {
  const pods = kjson(['-n', ns, 'get', 'pods', '-l', selector]).items;
  return pods.reduce((n: number, p: any) => n + (p.status.containerStatuses ?? []).reduce((m: number, c: any) => m + c.restartCount, 0), 0);
}
export function readyEndpoints(service: string, ns = NS): number {
  const sl = kjson(['-n', ns, 'get', 'endpointslices', '-l', `kubernetes.io/service-name=${service}`]).items;
  return sl.reduce((n: number, s: any) => n + (s.endpoints ?? []).filter((e: any) => e.conditions?.ready).length, 0);
}
export async function waitFor(what: string, fn: () => boolean | Promise<boolean>, timeoutMs = 120_000, stepMs = 1000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (await fn()) return Date.now() - t0; await sleep(stepMs); }
  throw new Error(`timeout waiting for ${what}`);
}

/** `kubectl port-forward` in the background; resolves when the local port answers. */
export async function portForward(target: string, localPort: number, remotePort: number, ns = NS) {
  const child: ChildProcess = spawn('kubectl', ['--context', CONTEXT, '-n', ns, 'port-forward', target, `${localPort}:${remotePort}`, '--address', '127.0.0.1'], { stdio: 'ignore' });
  await waitFor(`port-forward ${target}`, async () => {
    try { await fetch(`http://127.0.0.1:${localPort}/`, { signal: AbortSignal.timeout(500) }); return true; } catch { return false; }
  }, 30_000, 300);
  return { stop: () => { child.kill(); } };
}

/** Runs app/api/carga.mjs as a Pod inside the cluster (it calls Services by name, like another pod would). */
export async function runLoad(name: string, url: string, rps: number, secs: number, ns = NS) {
  kubectl(['-n', ns, 'delete', 'pod', name, '--ignore-not-found', '--wait=true']);
  kubectl(['-n', ns, 'run', name, '--image=s11-demo/api:1.0', '--image-pull-policy=IfNotPresent', '--restart=Never',
    '--labels=rol=carga', '--command', '--', 'node', 'carga.mjs', url, String(rps), String(secs)]);
  return {
    async result() {
      await waitFor(`pod ${name}`, () => ['Succeeded', 'Failed'].includes(kjson(['-n', ns, 'get', 'pod', name]).status.phase), (secs + 60) * 1000, 1000);
      const log = kubectl(['-n', ns, 'logs', name]).out.split('\n');
      kubectl(['-n', ns, 'delete', 'pod', name, '--wait=false']);
      const sec = log.filter((l) => l.startsWith('SEC ')).map((l) => JSON.parse(l.slice(4)));
      const res = JSON.parse(log.find((l) => l.startsWith('RESULT '))!.slice(7));
      return { ...res, sec } as { total: number; ok: number; fail: number; reasons: Record<string, number>; sec: { s: number; ok: number; fail: number }[] };
    },
  };
}

export const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function environment() {
  const v = kjson(['version']);
  return `Medido el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${os.cpus()[0].model.trim()} (${os.cpus().length} hilos), ` +
    `${Math.round(os.totalmem() / 2 ** 30)} GB · ${os.type()} ${os.release()} · Node ${process.version} · ` +
    `kubectl ${v.clientVersion.gitVersion} · Kubernetes ${v.serverVersion.gitVersion} (kind, contexto ${CONTEXT})`;
}

export function writeResult(file: string, text: string) {
  const p = join(ROOT, 'results', file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  console.log(`-> results/${file}`);
}
