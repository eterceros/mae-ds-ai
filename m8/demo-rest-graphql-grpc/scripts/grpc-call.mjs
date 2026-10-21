// Cliente gRPC minimo para la demo (no hace falta instalar grpcurl).
//   node scripts/grpc-call.mjs GetStudent '{"id":7}'
//   node scripts/grpc-call.mjs ListStudents '{"limit":2,"withCourses":true}'
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [method, json = '{}'] = process.argv.slice(2);
if (!method) {
  console.error("Uso: node scripts/grpc-call.mjs <GetStudent|ListStudents> '<json>'");
  process.exit(1);
}

const definition = protoLoader.loadSync(join(root, 'proto/students.proto'), { keepCase: false });
const { StudentService } = grpc.loadPackageDefinition(definition).students;
const client = new StudentService(`127.0.0.1:${process.env.GRPC_PORT ?? 50051}`, grpc.credentials.createInsecure());

client[method](JSON.parse(json), (err, reply) => {
  if (err) {
    console.error(`${grpc.status[err.code]}: ${err.details}`);
    process.exit(1);
  }
  console.log(JSON.stringify(reply, null, 2));
  client.close();
});
