// Escribe las migraciones de cada escenario como archivos .sql (los que revisa Squawk en M9):
//   migraciones/ingenuas/Mx.sql  y  migraciones/seguras/Mx_<variante>.sql
// Los rellenos por lotes aparecen como UN lote de ejemplo; en la demo se repiten en un bucle (scripts/lib/escenarios.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { ESCENARIOS } from './lib/escenarios.mjs';

const RAIZ = path.join(import.meta.dirname, '..', 'migraciones');
for (const d of ['ingenuas', 'seguras']) {
  fs.rmSync(path.join(RAIZ, d), { recursive: true, force: true });
  fs.mkdirSync(path.join(RAIZ, d), { recursive: true });
}
for (const esc of ESCENARIOS) {
  for (const v of esc.variantes) {
    const ingenua = v.id === 'ingenua';
    const lineas = [`-- ${esc.id}. ${esc.titulo} (${v.nombre ?? v.id})`];
    for (const p of v.pasos) {
      if (p.noExportar) {
        lineas.push(`-- (en la demo, otra sesión mantiene abierta una transacción de lectura sobre pedidos)`);
        continue;
      }
      lineas.push(`-- ${p.nombre}`);
      for (const s of p.sqlArchivo ?? [p.sql]) lineas.push(s.trim().replace(/;?$/, ';'));
    }
    const archivo = ingenua ? path.join(RAIZ, 'ingenuas', `${esc.id}.sql`) : path.join(RAIZ, 'seguras', `${esc.id}_${v.id}.sql`);
    fs.writeFileSync(archivo, lineas.join('\n') + '\n');
    console.log(path.relative(path.join(RAIZ, '..'), archivo));
  }
}
