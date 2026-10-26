// Generates the lab CSV of course enrollments with a fixed seed.
// The Python version (../python/generate.py) produces the SAME bytes for the same arguments.
//
//   node generate.ts                      -> ../data/enrollments.csv, 50 000 rows, seed 2026
//   node generate.ts --rows 500000 --out ../data/enrollments-500k.csv
//   node generate.ts --clean              -> no invalid rows and no duplicates
//
// About 3 % of the rows are invalid (bad date, bad email, negative amount, empty field,
// extra column) and about 1 % repeat the external_id of an earlier row.
import { openSync, writeSync, closeSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const ROWS = Number(arg('--rows', '50000'));
const SEED = Number(arg('--seed', '2026'));
const CLEAN = process.argv.includes('--clean');
const OUT = resolve(arg('--out', resolve(here, '..', 'data', CLEAN ? 'enrollments-clean.csv' : 'enrollments.csv')));

// mulberry32: small 32-bit PRNG, easy to port exactly to other languages.
let state = SEED >>> 0;
function nextU32(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
  t = ((t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0)) >>> 0) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}
const rnd = (n: number) => nextU32() % n;

const FIRST: [string, string][] = [
  ['Ana', 'ana'], ['Bruno', 'bruno'], ['Carla', 'carla'], ['Diego', 'diego'], ['Elena', 'elena'],
  ['Fernando', 'fernando'], ['Gabriela', 'gabriela'], ['Hugo', 'hugo'], ['Inés', 'ines'], ['Javier', 'javier'],
  ['Karen', 'karen'], ['Luis', 'luis'], ['María', 'maria'], ['Nicolás', 'nicolas'], ['Olga', 'olga'],
  ['Pablo', 'pablo'], ['Rocío', 'rocio'], ['Sergio', 'sergio'], ['Tania', 'tania'], ['Víctor', 'victor'],
];
const LAST: [string, string][] = [
  ['Rojas', 'rojas'], ['Vargas', 'vargas'], ['Mamani', 'mamani'], ['Quispe', 'quispe'], ['Gutiérrez', 'gutierrez'],
  ['Flores', 'flores'], ['Pérez', 'perez'], ['Torrez', 'torrez'], ['Choque', 'choque'], ['Soliz', 'soliz'],
  ['Montaño', 'montano'], ['Arce', 'arce'], ['Salazar', 'salazar'], ['Camacho', 'camacho'], ['Zeballos', 'zeballos'],
  ['Ríos', 'rios'], ['Medina', 'medina'], ['Antezana', 'antezana'], ['Ugarte', 'ugarte'], ['Villca', 'villca'],
];
const DOMAINS = ['example.edu', 'example.org', 'example.com'];
// course code and base price in cents
const COURSES: [string, number][] = [
  ['ARQ-101', 35000], ['API-201', 42050], ['BD-110', 38000], ['PRG-105', 30000], ['RED-220', 39900],
  ['SEG-130', 45000], ['ING-140', 36075], ['EST-150', 28000], ['GES-160', 33000], ['MAT-170', 27500],
];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31]; // Jan..Oct 2026

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const money = (cents: number) => `${Math.floor(cents / 100)}.${pad(cents % 100, 2)}`;

type Row = { id: string; name: string; email: string; course: string; date: string; cents: number; first: string; last: string };

function baseRow(seq: number): Row {
  const f = FIRST[rnd(FIRST.length)];
  const l1 = LAST[rnd(LAST.length)];
  const l2 = LAST[rnd(LAST.length)];
  const n = rnd(100);
  const d = DOMAINS[rnd(DOMAINS.length)];
  const c = COURSES[rnd(COURSES.length)];
  const discount = rnd(4) * 2500;
  const m = rnd(10);
  const day = rnd(DAYS[m]) + 1;
  return {
    id: `INS-${pad(seq, 7)}`,
    name: `${f[0]} ${l1[0]} ${l2[0]}`,
    email: `${f[1]}.${l1[1]}${n}@${d}`,
    course: c[0],
    date: `2026-${pad(m + 1, 2)}-${pad(day, 2)}`,
    cents: c[1] - discount,
    first: f[0],
    last: `${l1[0]} ${l2[0]}`,
  };
}

const line = (r: Row, amount = money(r.cents)) => [r.id, r.name, r.email, r.course, r.date, amount].join(',');

const stats = { rows: 0, valid: 0, duplicates: 0, bad_date: 0, bad_email: 0, negative_amount: 0, empty_field: 0, extra_column: 0 };
const emitted: Row[] = []; // valid rows already written (candidates for duplicates)
let seq = 0;

mkdirSync(dirname(OUT), { recursive: true });
const fd = openSync(OUT, 'w');
let buf: string[] = ['external_id,student_name,email,course_code,enrolled_on,amount'];
const flush = () => { writeSync(fd, buf.join('\n') + '\n'); buf = []; };

for (let i = 0; i < ROWS; i++) {
  const r = rnd(1000);
  if (!CLEAN && r < 10 && emitted.length > 0) {
    // ~1 %: same external_id as an earlier row; half exact copies, half with another amount
    const prev = emitted[rnd(emitted.length)];
    buf.push(rnd(2) === 0 ? line(prev) : line(prev, money(prev.cents + 5000)));
    stats.duplicates++;
  } else {
    seq++;
    const row = baseRow(seq);
    if (!CLEAN && r >= 10 && r < 40) {
      // ~3 %: invalid row, five kinds
      const kind = rnd(5);
      if (kind === 0) {
        const [y, mo, d] = row.date.split('-');
        const v = rnd(4);
        row.date = v === 0 ? `${d}/${mo}/${y}` : v === 1 ? `${y}-02-30` : v === 2 ? `${y}-13-${d}` : `${y}/${mo}/${d}`;
        stats.bad_date++;
        buf.push(line(row));
      } else if (kind === 1) {
        const v = rnd(3);
        row.email = v === 0 ? row.email.replace('@', '.') : v === 1 ? row.email.split('@')[0] + '@' : row.email.replace('@', '@@');
        stats.bad_email++;
        buf.push(line(row));
      } else if (kind === 2) {
        stats.negative_amount++;
        buf.push(line(row, '-' + money(row.cents)));
      } else if (kind === 3) {
        const v = rnd(5);
        if (v === 0) row.name = '';
        else if (v === 1) row.email = '';
        else if (v === 2) row.course = '';
        else if (v === 3) row.date = '';
        stats.empty_field++;
        buf.push(v === 4 ? line(row, '') : line(row));
      } else {
        // "Last Last, First": an unquoted comma inside the name -> 7 columns
        row.name = `${row.last}, ${row.first}`;
        stats.extra_column++;
        buf.push(line(row));
      }
    } else {
      stats.valid++;
      emitted.push(row);
      buf.push(line(row));
    }
  }
  stats.rows++;
  if (buf.length >= 10000) flush();
}
flush();
closeSync(fd);
console.error(`${OUT}\n${JSON.stringify(stats)}`);
