// Clientes simetricos para medir: los tres estilos usan Node, conexiones persistentes y hacen el mismo
// trabajo con la respuesta (la reciben completa y la decodifican a un objeto JavaScript).
// REST y GraphQL: node:http con keep-alive. gRPC: un solo canal de @grpc/grpc-js.
// No se usa fetch (suma ~15 ms por peticion en Windows) ni el cliente gRPC de k6 (hace mas trabajo que su
// cliente HTTP, porque convierte cada respuesta protobuf a objetos de JavaScript dentro de k6).
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// maxSockets: tope de conexiones HTTP/1.1 simultaneas por servidor (un navegador usa 6; un servicio, mas).
export function createClients({ root, httpPort, grpcPort, gatewayPort, maxSockets = Infinity, grpcOptions = {} }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets });

  const request = (port, path, method = 'GET', body, gzip = false) =>
    new Promise((resolve, reject) => {
      const headers = body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {};
      if (gzip) headers['accept-encoding'] = 'gzip';
      const req = http.request({ host: '127.0.0.1', port, path, method, agent, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          const raw = Buffer.concat(chunks);
          resolve(JSON.parse((res.headers['content-encoding'] === 'gzip' ? gunzipSync(raw) : raw).toString()));
        });
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  const definition = protoLoader.loadSync(join(root, 'proto/students.proto'), { keepCase: false });
  const { StudentService } = grpc.loadPackageDefinition(definition).students;
  const grpcClient = new StudentService(`127.0.0.1:${grpcPort}`, grpc.credentials.createInsecure(), grpcOptions);

  return {
    rest: (path) => request(httpPort, path),
    restGzip: (path) => request(httpPort, path, 'GET', undefined, true),
    graphql: (query) => request(httpPort, '/graphql', 'POST', JSON.stringify({ query })),
    grpc: (method, message) =>
      new Promise((resolve, reject) => grpcClient[method](message, (err, reply) => (err ? reject(err) : resolve(reply)))),
    gateway: (path) => request(gatewayPort, path),
    // Streaming: llama onItem con cada elemento en cuanto llega y resuelve al terminar.
    restStream: (path, onItem) =>
      new Promise((resolve, reject) => {
        http
          .get({ host: '127.0.0.1', port: httpPort, path, agent }, (res) => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            let pending = '';
            res.setEncoding('utf8');
            res.on('data', (text) => {
              pending += text;
              let newline;
              while ((newline = pending.indexOf('\n')) >= 0) {
                onItem(JSON.parse(pending.slice(0, newline)));
                pending = pending.slice(newline + 1);
              }
            });
            res.on('end', resolve);
          })
          .on('error', reject);
      }),
    grpcStream: (method, message, onItem) =>
      new Promise((resolve, reject) => {
        const call = grpcClient[method](message);
        call.on('data', onItem);
        call.on('end', resolve);
        call.on('error', reject);
      }),
    close() {
      agent.destroy();
      grpcClient.close();
    },
  };
}

// Los escenarios de la demo. Cada variante es una funcion async que hace lo que el cliente necesita.
export function scenarios(c) {
  return [
    {
      id: 'A',
      title: 'A. Un estudiante (solo el nombre)',
      variants: [
        ['REST', () => c.rest('/students/7')],
        ['GraphQL', () => c.graphql('{ student(id: 7) { name } }')],
        ['gRPC', () => c.grpc('GetStudent', { id: 7 })],
      ],
    },
    {
      id: 'B',
      title: 'B. Lista de 2000 estudiantes',
      variants: [
        ['REST', () => c.rest('/students?limit=2000')],
        ['GraphQL', () => c.graphql('{ students(limit: 2000) { id name email career } }')],
        ['gRPC', () => c.grpc('ListStudents', { limit: 2000 })],
      ],
    },
    {
      id: 'C',
      title: 'C. 50 estudiantes con sus cursos',
      variants: [
        [
          'REST ingenuo (1 + 50 llamadas)',
          async () => {
            const list = await c.rest('/students?limit=50');
            for (const s of list) await c.rest(`/students/${s.id}/courses`);
          },
        ],
        ['REST con ?expand=courses', () => c.rest('/students?limit=50&expand=courses')],
        ['GraphQL con dataloader', () => c.graphql('{ students(limit: 50) { id name email career courses { code title } } }')],
        ['GraphQL sin dataloader (N+1)', () => c.graphql('{ students(limit: 50) { id name email career coursesNaive { code title } } }')],
        ['gRPC', () => c.grpc('ListStudents', { limit: 50, withCourses: true })],
      ],
    },
    {
      id: 'D1',
      title: 'D1. Servicio a servicio: el gateway pide 20 estudiantes de uno en uno, en paralelo',
      variants: [
        ['Gateway -> servicio por REST', () => c.gateway('/fanout/rest?n=20')],
        ['Gateway -> servicio por gRPC', () => c.gateway('/fanout/grpc?n=20')],
      ],
    },
    {
      id: 'D2',
      title: 'D2. Servicio a servicio: el gateway pide la lista de 2000 en una sola llamada',
      variants: [
        ['Gateway -> servicio por REST', () => c.gateway('/bulk/rest?n=2000')],
        ['Gateway -> servicio por gRPC', () => c.gateway('/bulk/grpc?n=2000')],
      ],
    },
  ];
}
