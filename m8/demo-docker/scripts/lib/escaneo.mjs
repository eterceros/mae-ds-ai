// Escaneo de vulnerabilidades con Trivy (en contenedor, version fijada por
// digest; ver el incidente de marzo de 2026 en el README) y con Docker Scout.
import { docker } from './util.mjs';

export const TRIVY = 'aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c';
const VOL = ['-v', '/var/run/docker.sock:/var/run/docker.sock', '-v', 's08-docker-trivy-cache:/root/.cache'];

// Devuelve conteos por severidad, cuantas tienen version corregida y cuantos
// paquetes del sistema operativo hay en la imagen.
export function trivy(imagen) {
  const r = docker(['run', '--rm', ...VOL, TRIVY, 'image', '--scanners', 'vuln', '--list-all-pkgs', '--quiet', '--format', 'json', imagen]);
  if (r.code !== 0) return { error: r.err.slice(-500) };
  const j = JSON.parse(r.out);
  const sev = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  let corregibles = 0, so = 0, node = 0, app = 0, paquetesSO = 0;
  const altasApp = new Set();
  const sistema = j.Metadata?.OS ? `${j.Metadata.OS.Family} ${j.Metadata.OS.Name}` : 'no detectado';
  for (const res of j.Results ?? []) {
    if (res.Class === 'os-pkgs') paquetesSO += (res.Packages ?? []).length;
    for (const v of res.Vulnerabilities ?? []) {
      sev[v.Severity] = (sev[v.Severity] ?? 0) + 1;
      if (v.FixedVersion) corregibles++;
      if (res.Class === 'os-pkgs') so++;
      else if ((v.PkgPath ?? '').startsWith('app/')) {
        // Dependencia de la propia aplicacion (/app/node_modules)
        app++;
        if (v.Severity === 'HIGH' || v.Severity === 'CRITICAL') altasApp.add(`${v.PkgName} ${v.InstalledVersion}`);
      } else node++; // paquetes que trae la base (p. ej. el npm incluido en la imagen)
    }
  }
  const total = Object.values(sev).reduce((a, b) => a + b, 0);
  return { total, ...sev, corregibles, so, node, app, altasApp: [...altasApp], paquetesSO, sistema };
}

export function trivyVersion() {
  const r = docker(['run', '--rm', ...VOL, TRIVY, 'version', '--format', 'json']);
  try {
    const j = JSON.parse(r.out);
    return { version: j.Version, db: j.VulnerabilityDB?.UpdatedAt?.slice(0, 10) };
  } catch { return { version: '0.76.1', db: '?' }; }
}

// Docker Scout: linea "Target" del quickview (C/H/M/L). Requiere sesion en Docker Hub.
export function scout(imagen) {
  const r = docker(['scout', 'quickview', imagen]);
  const txt = r.out + r.err;
  const m = txt.match(/Target\s+│[^│]*│\s+(\d+)C\s+(\d+)H\s+(\d+)M\s+(\d+)L/);
  if (!m) return { error: (txt.trim().split('\n').pop() ?? '').slice(0, 200) };
  return { C: +m[1], H: +m[2], M: +m[3], L: +m[4] };
}

export function scoutVersion() {
  const r = docker(['scout', 'version']);
  return (r.out.match(/version:\s*(v[\d.]+)/) ?? [])[1] ?? '?';
}
