// M9: corre Squawk (linter de migraciones de Postgres) sobre las migraciones ingenuas y las seguras
// y guarda su salida en results/SQUAWK.md: una tabla por conjunto (desde --reporter json) y la salida
// de consola completa de las ingenuas.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RAIZ = path.join(import.meta.dirname, '..');
const bin = path.join(RAIZ, 'node_modules', '.bin', process.platform === 'win32' ? 'squawk.cmd' : 'squawk');

function correr(args) {
  const cmd = [`"${bin}"`, ...args].join(' ');
  const r = spawnSync(cmd, { cwd: RAIZ, encoding: 'utf8', shell: true, env: { ...process.env, NO_COLOR: '1' } });
  const salida = (r.stdout + r.stderr)
    .replace(/\x1b\]8;;[^\x1b\x07]*(\x1b\\|\x07)/g, '') // hipervínculos OSC 8
    .replace(/\x1b\[[0-9;]*m/g, '') // colores
    .trimEnd();
  return { codigo: r.status, salida };
}

// Reglas que avisan en casi todo archivo; se cuentan aparte para que no tapen las importantes.
const GENERICAS = new Set(['require-statement-timeout', 'prefer-robust-stmts']);

function tabla(archivos) {
  const r = correr(['--pg-version=17.0', '--reporter', 'json', ...archivos]);
  const avisos = JSON.parse(r.salida || '[]');
  const lineasDe = {};
  const filas = [];
  const genericas = {};
  for (const a of avisos) {
    const f = a.file.replace(/\\/g, '/');
    if (GENERICAS.has(a.rule_name)) {
      genericas[a.rule_name] = (genericas[a.rule_name] ?? 0) + 1;
      continue;
    }
    lineasDe[f] ??= fs.readFileSync(path.join(RAIZ, f), 'utf8').split('\n');
    let sent = (lineasDe[f][a.line] ?? '').trim();
    if (sent.length > 70) sent = sent.slice(0, 67) + '...';
    filas.push(`| \`${path.basename(f)}\`:${a.line + 1} | \`${sent.replace(/\|/g, '\\|')}\` | \`${a.rule_name}\` | ${a.message.replace(/\|/g, '\\|')} |`);
  }
  const L = [`Código de salida ${r.codigo}. ${avisos.length} avisos en total.`, ''];
  if (filas.length) L.push('| Archivo:línea | Sentencia | Regla | Mensaje de Squawk |', '|---|---|---|---|', ...filas, '');
  else L.push('Ningún aviso fuera de las reglas genéricas.', '');
  const g = Object.entries(genericas);
  if (g.length) L.push(`Además: ${g.map(([k, v]) => `\`${k}\` ×${v}`).join(', ')} (avisan en casi toda sentencia; ver el README).`, '');
  return L;
}

const glob = (d) => fs.readdirSync(path.join(RAIZ, d)).filter((f) => f.endsWith('.sql')).sort().map((f) => `${d}/${f}`);
const ingenuas = glob('migraciones/ingenuas');
const seguras = glob('migraciones/seguras');

const version = correr(['--version']).salida;
const L = [
  '# M9. Squawk sobre las migraciones de la demo',
  '',
  `Salida real de \`${version}\` (paquete npm \`squawk-cli\`), con \`--pg-version=17.0\`, generada con \`npm run squawk\` el ${new Date().toISOString().slice(0, 10)}.`,
  'Los archivos `.sql` se generan con `npm run sql` a partir de los mismos escenarios que se midieron en `results/ESCENARIOS.md`.',
  '',
  '## Migraciones ingenuas',
  '',
  ...tabla(ingenuas),
  '## Migraciones seguras',
  '',
  ...tabla(seguras),
  '## Migraciones seguras con `--assume-in-transaction`',
  '',
  'Como si la herramienta de migraciones envolviera cada archivo en una transacción (lo que hace Flyway por defecto en Postgres).',
  '',
  ...tabla(['--assume-in-transaction', ...seguras]),
  '## Salida de consola completa (ingenuas)',
  '',
  `\`npx squawk --pg-version=17.0 migraciones/ingenuas/*.sql\``,
  '',
  '```text',
  correr(['--pg-version=17.0', ...ingenuas]).salida,
  '```',
  '',
];
fs.writeFileSync(path.join(RAIZ, 'results', 'SQUAWK.md'), L.join('\n'));
console.log('Escrito results/SQUAWK.md');
