// Utilidades comunes de los escenarios: ejecutar comandos, medir tiempos,
// tamaños de imagen, mediana y escritura de resultados. Solo usa la stdlib de Node.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const API = join(RAIZ, 'api');
export const TMP = join(RAIZ, '.tmp');
export const PROYECTO = 's08-docker';
// Compose del stack corregido (despues/compose.yaml), usado por varios escenarios.
export const COMPOSE = ['compose', '-f', join(RAIZ, 'despues', 'compose.yaml')];
export const RONDAS = Number(process.env.RONDAS ?? 3);

// Ejecuta un comando y devuelve { code, out, err, ms }. No lanza excepcion.
export function sh(cmd, args, opts = {}) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    cwd: opts.cwd ?? RAIZ,
    env: { ...process.env, ...(opts.env ?? {}) },
    input: opts.input,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (opts.log) console.log(`$ ${cmd} ${args.join(' ')}  (${(ms / 1000).toFixed(1)} s, codigo ${r.status})`);
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', ms };
}

// Igual que sh, pero termina el script si el comando falla.
export function must(cmd, args, opts = {}) {
  const r = sh(cmd, args, opts);
  if (r.code !== 0) {
    console.error(r.out, r.err);
    throw new Error(`fallo: ${cmd} ${args.join(' ')}`);
  }
  return r;
}

export const docker = (args, opts) => sh('docker', args, opts);
export const dockerOk = (args, opts) => must('docker', args, opts);

export function mediana(xs) {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
export const rango = (xs) => `${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)}`;
export const seg = (ms) => (ms / 1000).toFixed(1);

// Copia api/ a un directorio temporal limpio (sin node_modules ni dist):
// el contexto de build es siempre el mismo y se puede modificar sin tocar el repo.
export function contextoLimpio(nombre) {
  const dir = join(TMP, nombre);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(API, dir, {
    recursive: true,
    filter: (src) => !/[\/](node_modules|dist)([\/]|$)/.test(src.slice(API.length)),
  });
  return dir;
}

// Tamaño en disco (descomprimido) y tamaño del contenido (capas comprimidas,
// lo que se descarga) tal como los informa "docker image ls" con el almacen containerd.
export function tamanos(imagen) {
  const r = dockerOk(['image', 'ls', imagen]);
  const fila = r.out.trim().split('\n')[1] ?? '';
  const cols = fila.split(/\s{2,}/);
  // Columnas: IMAGE  ID  DISK USAGE  CONTENT SIZE  EXTRA
  const capas = JSON.parse(dockerOk(['image', 'inspect', imagen, '--format', '{{json .RootFS.Layers}}']).out).length;
  const bytes = Number(dockerOk(['image', 'inspect', imagen, '--format', '{{.Size}}']).out.trim());
  return { disco: cols[2], contenido: cols[3], bytes, capas };
}

export function maquina() {
  const v = (args) => sh('docker', args).out.trim();
  return {
    fecha: new Date().toISOString(),
    cpu: os.cpus()[0]?.model.trim(),
    hilos: os.cpus().length,
    ramGB: Math.round(os.totalmem() / 2 ** 30),
    so: `${os.type()} ${os.release()}`,
    node: process.version,
    docker: v(['version', '--format', '{{.Server.Version}}']),
    compose: v(['compose', 'version', '--short']),
    buildx: v(['buildx', 'version']).split(' ')[1],
    vm: (() => {
      const [so, cpu, mem] = v(['info', '--format', '{{.OperatingSystem}}|{{.NCPU}}|{{.MemTotal}}']).split('|');
      return `${so} sobre WSL2, VM con ${cpu} CPU y ${Math.round(Number(mem) / 2 ** 30)} GB, almacén de imágenes containerd`;
    })(),
  };
}

export function cabecera(m) {
  return `Medido el ${m.fecha.slice(0, 10)}. Máquina: ${m.cpu}, ${m.hilos} hilos lógicos, ${m.ramGB} GB de RAM, ${m.so}, Node ${m.node}. ` +
    `Docker Engine ${m.docker} (${m.vm}), Compose ${m.compose}, buildx ${m.buildx}.`;
}

// Con VERIFICAR=1 los resultados van a .tmp/verificacion/ y no pisan los
// publicados en results/ (sirve para comprobar que un escenario sigue andando).
export function guardar(nombre, md, json) {
  const dir = process.env.VERIFICAR ? join(TMP, 'verificacion') : join(RAIZ, 'results');
  mkdirSync(join(dir, 'json'), { recursive: true });
  writeFileSync(join(dir, `${nombre}.md`), md);
  if (json) writeFileSync(join(dir, 'json', `${nombre}.json`), JSON.stringify(json, null, 2));
  console.log(`escrito ${dir}/${nombre}.md`);
}

export const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Espera hasta que una URL responda 200 (o se acabe el plazo). Devuelve ms o null.
export async function esperarHttp(url, plazoMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < plazoMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return Date.now() - t0;
    } catch {}
    await espera(100);
  }
  return null;
}

export { existsSync, join };
