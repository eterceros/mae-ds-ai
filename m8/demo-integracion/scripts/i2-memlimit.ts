// I2, complemento: los dos importadores con el heap de V8 limitado (--max-old-space-size), 500 000 filas.
// Si la memoria depende del archivo, el proceso muere por falta de memoria; si depende del lote, termina.
import { makePool, SCHEMA_I2 } from '../src/lib/db.ts';
import { writeResult, today, environment } from './lib/harness.ts';
import { spawn } from 'node:child_process';

const SIZE = Number(process.env.SIZE ?? 500000);
const LIMITS = (process.env.LIMITS ?? '64,32').split(',').map(Number);
const RUNS = Number(process.env.RUNS ?? 3);
const pool = makePool(1);
const env = await environment(pool);

function run(limit: number, args: string[]) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const p = spawn(process.execPath, ['--no-warnings', `--max-old-space-size=${limit}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ code, out }));
  });
}

let md = `# I2, complemento: importar ${SIZE.toLocaleString('es')} filas con el heap limitado

Medido el ${today()}. ${env}

Cada importador se ejecuta con \`node --max-old-space-size=<MB>\` (límite del heap «viejo» de V8). \`antes\` con \`clientes-${SIZE}-validas.csv\` (para que no aborte en la línea 38), \`despues\` con \`clientes-${SIZE}.csv\`. Tablas vacías antes de cada corrida. ${RUNS} corridas por caso.

| Límite (MB) | Importador | Corrida | Resultado | Tiempo (s) | RSS pico (MB) | Heap pico (MB) |
|---:|---|---:|---|---:|---:|---:|
`;
for (const limit of LIMITS) {
  for (const v of ['antes', 'despues']) {
    for (let i = 1; i <= RUNS; i++) {
      await pool.query(SCHEMA_I2);
      const args = v === 'antes' ? ['src/antes/importer.ts', `data/clientes-${SIZE}-validas.csv`] : ['src/despues/importer.ts', `data/clientes-${SIZE}.csv`, 'out/r-memlimit.csv'];
      const t0 = performance.now();
      const r = await run(limit, args);
      const s = (performance.now() - t0) / 1000;
      const line = r.out.split('\n').find((l) => l.startsWith('RESULT '));
      const res = line ? JSON.parse(line.slice(7)) : null;
      const oom = /heap out of memory/.test(r.out);
      const what = res ? (v === 'antes' ? `terminó: ${res.inserted} filas` : `terminó: ${res.inserted} insertadas, ${res.rejected} rechazadas`) : oom ? `**murió: JavaScript heap out of memory** (código ${r.code})` : `falló (código ${r.code})`;
      md += `| ${limit} | ${v} | ${i} | ${what} | ${(res?.seconds ?? s).toFixed(1)} | ${res?.peakRssMB ?? '—'} | ${res?.peakHeapMB ?? '—'} |\n`;
      console.log(limit, v, i, what);
    }
  }
}
await pool.end();
md += `
Cuando el proceso muere no imprime sus cifras de memoria (— en la tabla); el tiempo es hasta la muerte. El «heap pico» de \`despues\` incluye basura que V8 aún no recolectó: lo que demuestra que la memoria viva está acotada es que termina con el límite más bajo.
`;
writeResult('I2_LIMITE_MEMORIA.md', md);
