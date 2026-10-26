// SF — prepara un repositorio TEMPORAL para correr /security-review sobre el código inseguro.
//
// Por qué hace falta: /security-review revisa solo los commits de la rama actual que todavía no están
// en origin/HEAD (`git diff origin/HEAD...`). En mae-ds-ai el código de src/antes/ ya está confirmado,
// así que el diff no lo contiene. Además, los comentarios de src/antes/ y los archivos de al lado
// (results/, DIFERENCIAS.md, ia/, src/despues/) nombran cada fallo: la IA leería las respuestas.
//
// Qué hace (sin dependencias, solo Node 24 y git):
//   1. Crea FUERA de mae-ds-ai un repositorio nuevo (por defecto %TEMP%\s12-ia-revision).
//   2. Commit inicial vacío en `main`, que se marca como origin/main y origin/HEAD (no hay remoto real).
//   3. Rama `revision`: copia src/antes/ + src/lib/ (aplanados en src/), SIN comentarios, sin el
//      selector antes/despues, sin el servicio interno simulado, y sin results/, DIFERENCIAS.md, ia/ ni
//      src/despues/. Lo confirma en `revision`, de modo que es el cambio pendiente de la rama frente a
//      origin/HEAD: exactamente lo que lee /security-review.
//   4. Comprueba que ningún archivo copiado contenga palabras que delaten los fallos; si alguno las
//      tiene, se detiene sin confirmar.
//
// Uso (desde m8/demo-seguridad):   node ia/preparar-revision.mjs [carpeta-destino]
// Si la carpeta ya existe y la creó este script, la borra y la vuelve a crear; si no, se detiene.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = resolve(process.argv[2] ?? join(tmpdir(), 's12-ia-revision'));
const MARKER = join(TARGET, '.git', 's12-ia-revision');

const git = (args, cwd = TARGET) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// --- 0. El destino tiene que estar fuera del repositorio de la demo ---
const repoRoot = resolve(git(['rev-parse', '--show-toplevel'], DEMO));
const rel = relative(repoRoot, TARGET);
if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
  console.error(`El destino ${TARGET} está dentro de ${repoRoot}. Elijan una carpeta fuera del repositorio.`);
  process.exit(1);
}
if (existsSync(TARGET)) {
  if (!existsSync(MARKER)) {
    console.error(`${TARGET} ya existe y no la creó este script. Bórrenla a mano o pasen otra carpeta.`);
    process.exit(1);
  }
  rmSync(TARGET, { recursive: true, force: true });
}

// --- 1. Quitar comentarios de un archivo TypeScript (respeta cadenas y plantillas) ---
function stripComments(text) {
  // las líneas que son solo un comentario desaparecen enteras (no dejan una línea en blanco)
  const src = text.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += src[i++];
      while (i < n && src[i] !== q) { if (src[i] === '\\') out += src[i++]; out += src[i++]; }
      out += src[i++] ?? '';
      continue;
    }
    out += src[i++];
  }
  // líneas que quedaron vacías por un comentario, espacios al final y blancos repetidos
  return out.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n*$/, '\n');
}

// Rutas aplanadas: src/antes/x.ts y src/lib/x.ts pasan a src/x.ts.
const fixImports = (s) => s.replace(/'\.\.\/lib\//g, "'./");

const FILES = [
  ['src/antes/app.module.ts', 'src/app.module.ts'],
  ['src/antes/auth.guard.ts', 'src/auth.guard.ts'],
  ['src/antes/orders.controller.ts', 'src/orders.controller.ts'],
  ['src/antes/precios.client.ts', 'src/precios.client.ts'],
  ['src/antes/ratelimit.guard.ts', 'src/ratelimit.guard.ts'],
  ['src/lib/config.ts', 'src/config.ts'],
  ['src/lib/orders.ts', 'src/orders.ts'],
  ['src/lib/principal.ts', 'src/principal.ts'],
];

// Ajustes puntuales que, sin comentarios, aún delatarían que hay una versión "antes" y otra "después".
const TWEAKS = {
  'src/config.ts': (s) => s
    .replace(/^export const MODE[^\n]*\n/m, '')
    .replace(/^export const INTERNAL_[^\n]*\n/gm, ''),
  'src/orders.controller.ts': (s) => s.replace(/, mode: 'antes'/g, ''),
};

const MAIN_TS = `import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PORT } from './config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(API_PORT, '127.0.0.1');
}
bootstrap();
`;

const pkg = JSON.parse(readFileSync(join(DEMO, 'package.json'), 'utf8'));
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));
const PACKAGE_JSON = JSON.stringify({
  name: 'orders-api',
  version: '0.1.0',
  private: true,
  description: 'API de pedidos en NestJS. Tokens emitidos por Keycloak (realm demo). Consulta precios a un servicio interno.',
  scripts: { build: 'tsc -p tsconfig.json', start: 'node dist/main.js' },
  dependencies: pick(pkg.dependencies, ['@nestjs/common', '@nestjs/core', '@nestjs/platform-express', 'reflect-metadata', 'rxjs']),
  devDependencies: pick(pkg.devDependencies, ['@types/express', '@types/node', 'typescript']),
}, null, 2) + '\n';

const tsconfig = JSON.parse(readFileSync(join(DEMO, 'tsconfig.api.json'), 'utf8'));
tsconfig.include = ['src'];
const TSCONFIG = JSON.stringify(tsconfig, null, 2) + '\n';

const OUT = new Map();
for (const [from, to] of FILES) {
  let s = fixImports(stripComments(readFileSync(join(DEMO, from), 'utf8')));
  if (TWEAKS[to]) s = TWEAKS[to](s);
  OUT.set(to, s);
}
OUT.set('src/main.ts', MAIN_TS);
OUT.set('package.json', PACKAGE_JSON);
OUT.set('tsconfig.json', TSCONFIG);
OUT.set('.gitignore', 'node_modules\ndist\n');

// --- 2. Nada que delate los fallos ---
const DELATORES = /\b(bola|ssrf|owasp|api[0-9]:20|antes|despu[eé]s|correcci[oó]n|vulnerab\w*|insegur\w*|ataque|atacante|hack\w*|cve|demo-seguridad|s1[12]\b|token-interno)/i;
const hits = [];
for (const [f, s] of OUT) s.split('\n').forEach((l, k) => { if (DELATORES.test(l)) hits.push(`${f}:${k + 1}: ${l.trim()}`); });
if (hits.length) {
  console.error('Se encontraron palabras que delatan los fallos; no se crea el repositorio:\n' + hits.join('\n'));
  process.exit(1);
}

// --- 3. Repositorio: main (vacío) = origin/HEAD; rama revision con el código ---
mkdirSync(TARGET, { recursive: true });
git(['init', '-q', '-b', 'main']);
writeFileSync(MARKER, 'creado por m8/demo-seguridad/ia/preparar-revision.mjs\n');
git(['config', 'user.name', 'Docente']);
git(['config', 'user.email', 'docente@example.invalid']);
git(['config', 'commit.gpgsign', 'false']);
git(['commit', '-q', '--allow-empty', '-m', 'Inicio']);
git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
git(['switch', '-q', '-c', 'revision']);
for (const [f, s] of OUT) {
  const p = join(TARGET, ...f.split('/'));
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
}
git(['add', '-A']);
git(['commit', '-q', '-m', 'API de pedidos: autenticación, pedidos, límite de peticiones, descarga de URL y precios']);

const changed = git(['diff', '--name-only', 'origin/HEAD...']).split('\n').filter(Boolean);
console.log(`Repositorio listo: ${TARGET}`);
console.log(`Rama: ${git(['branch', '--show-current'])} · cambios frente a origin/HEAD: ${changed.length} archivos`);
for (const f of changed) console.log(`  ${f}`);
console.log(`\nSiguiente paso (en otra terminal):\n  cd "${TARGET}"\n  claude\n  /security-review`);
