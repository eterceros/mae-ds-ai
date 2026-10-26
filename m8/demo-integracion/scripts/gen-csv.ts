// Genera el CSV de clientes de I2 con semilla fija (el mismo archivo en cualquier máquina).
//   node scripts/gen-csv.ts [filas=50000] [semilla=42]
// Escribe en data/:
//   clientes-<filas>.csv           el archivo "sucio": ~3 % de filas inválidas de 7 tipos y ~1 % duplicadas
//   clientes-<filas>-validas.csv   las mismas filas sin las inválidas (con las duplicadas), para src/antes/
//   clientes-<filas>.manifest.json lo que se espera: cuántas inválidas de cada tipo, duplicadas, ids distintos
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../src/lib/rng.ts';

const ROWS = Number(process.argv[2] ?? 50_000);
const SEED = Number(process.argv[3] ?? 42);
const INVALID_RATE = 0.03;
const DUP_RATE = 0.01;
const rnd = mulberry32(SEED);
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const FIRST = ['Ana', 'Luis', 'María', 'Jorge', 'Lucía', 'Carlos', 'Sofía', 'Diego', 'Valeria', 'Andrés', 'Camila', 'Mateo', 'Paola', 'Rodrigo', 'Elena'];
const LAST = ['Quispe', 'Mamani', 'Rojas', 'Vargas', 'Flores', 'Gutiérrez', 'Choque', 'Torrez', 'Mendoza', 'Rivera', 'Pérez', 'Castro'];
const COUNTRIES = ['BO', 'BO', 'BO', 'PE', 'AR', 'CL', 'BR', 'PY', 'CO', 'EC', 'MX', 'UY'];
const INVALID_KINDS = ['email_vacio', 'email_invalido', 'monto_no_numerico', 'monto_negativo', 'fecha_invalida', 'pais_desconocido', 'columnas_faltantes'] as const;

mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
const base = fileURLToPath(new URL(`../data/clientes-${ROWS}`, import.meta.url));
const dirty = createWriteStream(`${base}.csv`);
const valid = createWriteStream(`${base}-validas.csv`);
const HEADER = 'external_id,email,full_name,country,amount_cents,signup_date\n';

async function write(s: typeof dirty, line: string) { if (!s.write(line)) await once(s, 'drain'); }

const invalidByKind: Record<string, number> = Object.fromEntries(INVALID_KINDS.map((k) => [k, 0]));
const validLines: string[] = [];   // solo para elegir duplicados (se guarda una muestra acotada)
let nextId = 1, invalid = 0, dups = 0, validRows = 0;

await write(dirty, HEADER); await write(valid, HEADER);
for (let i = 0; i < ROWS; i++) {
  const r = rnd();
  let line: string;
  let isValid = true;
  if (r < DUP_RATE && validLines.length > 0) {
    line = pick(validLines);   // copia exacta de una fila válida anterior
    dups++;
  } else {
    const id = `C${String(nextId++).padStart(7, '0')}`;
    const first = pick(FIRST), last = pick(LAST);
    const email = `${first}.${last}.${id}@example.com`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const y = 2015 + Math.floor(rnd() * 11), m = 1 + Math.floor(rnd() * 12), d = 1 + Math.floor(rnd() * 28);
    let f = [id, email, `${first} ${last}`, pick(COUNTRIES), String(Math.floor(rnd() * 5_000_000)),
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`];
    if (r < DUP_RATE + INVALID_RATE) {
      const kind = pick([...INVALID_KINDS]);
      invalidByKind[kind]++; invalid++; isValid = false;
      if (kind === 'email_vacio') f[1] = '';
      if (kind === 'email_invalido') f[1] = f[1].replace('@', ' at ');
      if (kind === 'monto_no_numerico') f[4] = pick(['12,5', 'N/A', 'abc', '1.000']).replace(',', ';');
      if (kind === 'monto_negativo') f[4] = '-' + f[4];
      if (kind === 'fecha_invalida') f[5] = pick([`${y}-02-30`, `${y}-13-01`, `31/12/${y}`]);
      if (kind === 'pais_desconocido') f[3] = pick(['XX', 'Bolivia', 'ZZ']);
      if (kind === 'columnas_faltantes') f = f.slice(0, 5);
    }
    line = f.join(',') + '\n';
    if (isValid && (validLines.length < 5000 || rnd() < 0.01)) {
      if (validLines.length < 5000) validLines.push(line); else validLines[Math.floor(rnd() * 5000)] = line;
    }
  }
  await write(dirty, line);
  if (isValid) { await write(valid, line); validRows++; }
}
dirty.end(); valid.end();
await Promise.all([once(dirty, 'finish'), once(valid, 'finish')]);

const manifest = {
  rows: ROWS, seed: SEED, invalid, invalidByKind, duplicates: dups,
  validRows, distinctValidIds: validRows - dups,
};
writeFileSync(`${base}.manifest.json`, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest));
