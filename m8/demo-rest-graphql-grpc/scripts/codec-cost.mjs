// Cuanto cuesta serializar y decodificar en Node (JSON frente a protobuf), solo CPU: sin red ni servidores.
// Escribe results/CODEC.md. Uso: node scripts/codec-cost.mjs (hace falta haber corrido npm run build)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const lines = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};

const definition = protoLoader.loadSync(join(root, 'proto/students.proto'), { keepCase: false });
const { StudentService } = grpc.loadPackageDefinition(definition).students;
const listDef = StudentService.service.ListStudents;

// Los mismos datos que sirve el servicio.
const { DataService } = createRequire(import.meta.url)(join(root, 'dist/data.service.js'));
const data = new DataService();

function msPerOp(n, fn) {
  for (let i = 0; i < 20; i++) fn(); // calentamiento
  const t = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn();
  return Number(process.hrtime.bigint() - t) / 1e6 / n;
}

out('# Costo de serializar y decodificar (solo CPU de Node)');
out();
out('Milisegundos por operacion, promedio de 300 repeticiones tras calentar.');
out();
out('| Respuesta | JSON.stringify | protobuf codificar | JSON.parse | protobuf decodificar |');
out('|---|---:|---:|---:|---:|');
for (const n of [50, 2000]) {
  data.latencyMs = 0;
  const students = await data.listStudents(n);
  const reply = { students };
  const json = JSON.stringify(reply);
  const pb = listDef.responseSerialize(reply);
  const row = [
    msPerOp(300, () => JSON.stringify(reply)),
    msPerOp(300, () => listDef.responseSerialize(reply)),
    msPerOp(300, () => JSON.parse(json)),
    msPerOp(300, () => listDef.responseDeserialize(pb)),
  ];
  out(`| ${n} estudiantes | ${row.map((v) => v.toFixed(3)).join(' | ')} |`);
}
out();

mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(join(root, 'results/CODEC.md'), lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
