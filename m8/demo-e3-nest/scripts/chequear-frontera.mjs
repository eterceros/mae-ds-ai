// Regla de frontera: fuera de src/precios/, de precios solo se importa el contrato
// (precios.port) y el módulo (precios.module). Un import de una clase interna haría
// imposible extraer el módulo sin reescribir a quien lo usa.
//   npm run frontera     (también corre en npm run build)
// En su proyecto: cambien MODULO por el suyo. Es un chequeo de texto, simple a propósito;
// una herramienta como dependency-cruiser hace lo mismo con más reglas (tests de arquitectura del M4).
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const MODULO = join(SRC, 'precios'); // el módulo que se quiere poder extraer
const PERMITIDOS = ['precios.port', 'precios.module']; // lo único visible desde fuera

// Los puntos de entrada (main*.ts) quedan fuera: arman la aplicación y main-precios.ts
// tiene que arrancar el módulo extraído (precios-servicio.module).
const archivos = readdirSync(SRC, { recursive: true })
  .map((f) => join(SRC, String(f)))
  .filter((f) => f.endsWith('.ts') && !f.startsWith(MODULO + sep) && !basename(f).startsWith('main'));

const violaciones = [];
for (const archivo of archivos) {
  const texto = readFileSync(archivo, 'utf8');
  for (const m of texto.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const destino = resolve(dirname(archivo), m[1]).replace(/\.(ts|js)$/, '');
    if (!destino.startsWith(MODULO + sep)) continue;
    const dentro = relative(MODULO, destino).split(sep).join('/');
    if (!PERMITIDOS.includes(dentro)) violaciones.push(`${relative(SRC, archivo).split(sep).join('/')} importa '${m[1]}'`);
  }
}

if (violaciones.length) {
  console.error('Frontera de precios rota: fuera de precios/ solo se importan', PERMITIDOS.join(' y '));
  for (const v of violaciones) console.error('  -', v);
  process.exit(1);
}
console.log(`Frontera de precios OK (${archivos.length} archivos fuera de precios/ revisados)`);
