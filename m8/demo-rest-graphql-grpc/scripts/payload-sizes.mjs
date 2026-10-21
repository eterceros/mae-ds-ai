// Mide, para cada escenario, cuantos bytes viajan por el cable, cuantas peticiones hacen falta
// y cuantas consultas a la "base de datos" provoca cada estilo (REST, GraphQL, gRPC).
// Uso: node scripts/payload-sizes.mjs   (con el servidor levantado)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTTP = `http://127.0.0.1:${process.env.HTTP_PORT ?? 3000}`;
const GRPC = `127.0.0.1:${process.env.GRPC_PORT ?? 50051}`;

const definition = protoLoader.loadSync(join(root, 'proto/students.proto'), { keepCase: false });
const { StudentService } = grpc.loadPackageDefinition(definition).students;
const grpcClient = new grpc.Client(GRPC, grpc.credentials.createInsecure());

// Cuenta bytes de cuerpo (sin cabeceras) y las peticiones hechas.
let tally;
const reset = () => (tally = { requests: 0, bytes: 0, gzip: 0 });
const add = (buf) => {
  tally.requests += 1;
  tally.bytes += buf.length;
  tally.gzip += gzipSync(buf).length;
};

async function rest(path) {
  const res = await fetch(`${HTTP}${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  add(buf);
  return JSON.parse(buf.toString());
}

async function graphql(query) {
  const res = await fetch(`${HTTP}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  add(buf);
  return JSON.parse(buf.toString());
}

function grpcCall(method, request) {
  const def = StudentService.service[method];
  return new Promise((resolve, reject) => {
    // Deserializador identidad: queremos los bytes protobuf tal cual viajaron.
    grpcClient.makeUnaryRequest(def.path, def.requestSerialize, (b) => b, request, (err, buf) => {
      if (err) return reject(err);
      add(buf);
      resolve(def.responseDeserialize(buf));
    });
  });
}

async function dbQueriesOf(fn) {
  await fetch(`${HTTP}/stats/reset`, { method: 'POST' });
  reset();
  await fn();
  const { dbQueries } = await (await fetch(`${HTTP}/stats`)).json();
  return { ...tally, dbQueries };
}

const scenarios = {
  'A. Un estudiante (el cliente solo necesita el nombre)': {
    'REST': () => rest('/students/7'),
    'GraphQL': () => graphql('{ student(id: 7) { name } }'),
    'gRPC': () => grpcCall('GetStudent', { id: 7 }),
  },
  'B. Lista de 2000 estudiantes (id, nombre, correo, carrera)': {
    'REST': () => rest('/students?limit=2000'),
    'GraphQL': () => graphql('{ students(limit: 2000) { id name email career } }'),
    'gRPC': () => grpcCall('ListStudents', { limit: 2000 }),
  },
  'C. 50 estudiantes con sus cursos': {
    'REST ingenuo (1 lista + 50 llamadas a /courses)': async () => {
      const list = await rest('/students?limit=50');
      for (const s of list) await rest(`/students/${s.id}/courses`);
    },
    'REST con ?expand=courses': () => rest('/students?limit=50&expand=courses'),
    'GraphQL con dataloader': () => graphql('{ students(limit: 50) { id name email career courses { code title } } }'),
    'GraphQL sin dataloader (N+1)': () => graphql('{ students(limit: 50) { id name email career coursesNaive { code title } } }'),
    'gRPC': () => grpcCall('ListStudents', { limit: 50, withCourses: true }),
  },
};

const lines = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};

out('# Tamano de las respuestas, peticiones y consultas a la base');
out();
out('Bytes de **cuerpo** (sin cabeceras HTTP ni de gRPC). "gzip" es el mismo cuerpo comprimido, para comparar justo con REST/GraphQL comprimidos.');
out();
for (const [title, variants] of Object.entries(scenarios)) {
  out(`## ${title}`);
  out();
  out('| Estilo | Peticiones | Bytes | Bytes con gzip | Consultas a la base |');
  out('|---|---:|---:|---:|---:|');
  for (const [name, fn] of Object.entries(variants)) {
    const r = await dbQueriesOf(fn);
    out(`| ${name} | ${r.requests} | ${r.bytes.toLocaleString('en-US')} | ${r.gzip.toLocaleString('en-US')} | ${r.dbQueries} |`);
  }
  out();
}

mkdirSync(join(root, 'results'), { recursive: true });
writeFileSync(join(root, 'results/PAYLOADS.md'), lines.join('\n') + '\n');
grpcClient.close();
