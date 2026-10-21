// Servidor independiente (sin NestJS) para medir SOLO el costo de la capa de conexion: TLS y conexiones nuevas.
// Levanta cuatro oyentes sobre los mismos 2000 estudiantes de src/data.service.ts, sin base simulada ni latencia:
//   REST (HTTP/1.1) sin TLS y con TLS, gRPC (HTTP/2) sin TLS y con TLS.
// El certificado es autofirmado (SAN: localhost y 127.0.0.1), solo para esta demo local; se genera con openssl
// en scripts/tls/certs/ si falta. Imprime "LISTO" cuando los cuatro oyentes estan arriba.
// Variables: TLS_REST_PORT (18900), TLS_REST_TLS_PORT (18901), TLS_GRPC_PORT (18902), TLS_GRPC_TLS_PORT (18903).
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const certDir = join(here, 'certs');
const keyFile = join(certDir, 'key.pem');
const certFile = join(certDir, 'cert.pem');

export const PORTS = {
  rest: Number(process.env.TLS_REST_PORT ?? 18900),
  restTls: Number(process.env.TLS_REST_TLS_PORT ?? 18901),
  grpc: Number(process.env.TLS_GRPC_PORT ?? 18902),
  grpcTls: Number(process.env.TLS_GRPC_TLS_PORT ?? 18903),
};

// Certificado autofirmado de demo. En Windows openssl suele venir con Git, aunque no este en el PATH.
function ensureCert() {
  if (existsSync(keyFile) && existsSync(certFile)) return;
  mkdirSync(certDir, { recursive: true });
  const args = [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365',
    '-keyout', keyFile, '-out', certFile,
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ];
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'];
  let last;
  for (const bin of candidates) {
    try {
      // MSYS_NO_PATHCONV evita que el openssl de Git convierta "/CN=localhost" en una ruta de Windows.
      execFileSync(bin, args, { stdio: 'ignore', env: { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' } });
      return;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`No se pudo generar el certificado con openssl: ${last?.message}`);
}

// Mismos datos y formula que DataService (src/data.service.ts), en memoria y sin esperas.
const FIRST_NAMES = ['Ana', 'Luis', 'Carla', 'Diego', 'Marta', 'Jorge', 'Lucia', 'Pedro', 'Sofia', 'Marco'];
const LAST_NAMES = ['Rojas', 'Mamani', 'Quispe', 'Vargas', 'Flores', 'Gomez', 'Herrera', 'Salazar', 'Condori', 'Arce'];
const CAREERS = ['Sistemas', 'Informatica', 'Electronica', 'Industrial', 'Civil'];
const students = Array.from({ length: 2000 }, (_, i) => {
  const id = i + 1;
  const first = FIRST_NAMES[id % FIRST_NAMES.length];
  const last = LAST_NAMES[(id * 3) % LAST_NAMES.length];
  return {
    id,
    name: `${first} ${last} ${id}`,
    email: `${first}.${last}.${id}@estudiantes.umss.edu`.toLowerCase(),
    career: CAREERS[id % CAREERS.length],
  };
});

ensureCert();
const tlsMaterial = { key: readFileSync(keyFile), cert: readFileSync(certFile) };

// REST: GET /students/{id}. Keep-alive alto (65 s) para no cortar conexiones persistentes y producir ECONNRESET falsos.
function onRequest(req, res) {
  const m = /^\/students\/(\d+)$/.exec(req.url ?? '');
  const student = m ? students[Number(m[1]) - 1] : undefined;
  if (req.method !== 'GET' || !student) {
    res.writeHead(404).end();
    return;
  }
  const body = JSON.stringify(student);
  res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function tune(server) {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  return server;
}

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

// gRPC: GetStudent con proto/students.proto (ListStudents no se usa aqui).
const definition = protoLoader.loadSync(join(root, 'proto/students.proto'), { keepCase: false });
const { StudentService } = grpc.loadPackageDefinition(definition).students;
const implementation = {
  getStudent: (call, callback) => {
    const student = students[call.request.id - 1];
    if (student) callback(null, student);
    else callback({ code: grpc.status.NOT_FOUND, message: 'no existe' });
  },
};

function startGrpc(port, credentials) {
  const server = new grpc.Server();
  server.addService(StudentService.service, implementation);
  return new Promise((resolve, reject) =>
    server.bindAsync(`127.0.0.1:${port}`, credentials, (err) => (err ? reject(err) : resolve(server))),
  );
}

await listen(tune(http.createServer(onRequest)), PORTS.rest);
await listen(tune(https.createServer(tlsMaterial, onRequest)), PORTS.restTls);
await startGrpc(PORTS.grpc, grpc.ServerCredentials.createInsecure());
await startGrpc(
  PORTS.grpcTls,
  grpc.ServerCredentials.createSsl(null, [{ private_key: tlsMaterial.key, cert_chain: tlsMaterial.cert }], false),
);

console.log(`LISTO rest=${PORTS.rest} restTls=${PORTS.restTls} grpc=${PORTS.grpc} grpcTls=${PORTS.grpcTls}`);
