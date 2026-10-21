// Segundo servidor de la demo: un "gateway" que, para responder a su cliente, le habla al servicio de
// estudiantes (el primer servidor) por REST o por gRPC. Es el uso tipico de gRPC: servicio a servicio.
// El cliente siempre le habla al gateway por REST y recibe una respuesta minuscula, asi que el costo de
// decodificar la respuesta grande queda fuera de la medicion; lo que se compara es el salto interno.
import { Agent, createServer, get as httpGet } from 'node:http';
import { join } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const gatewayPort = Number(process.env.GATEWAY_PORT ?? 3100);
const backendHttp = `http://127.0.0.1:${process.env.HTTP_PORT ?? 3000}`;
const backendGrpc = `127.0.0.1:${process.env.GRPC_PORT ?? 50051}`;

const definition = protoLoader.loadSync(join(process.cwd(), 'proto/students.proto'), { keepCase: false });
const { StudentService } = grpc.loadPackageDefinition(definition).students as any;
// Un solo cliente = un solo canal HTTP/2 con todas las llamadas multiplexadas encima.
const grpcClient = new StudentService(backendGrpc, grpc.credentials.createInsecure());

const grpcCall = <T>(method: string, request: object) =>
  new Promise<T>((resolve, reject) => grpcClient[method](request, (err: Error | null, reply: T) => (err ? reject(err) : resolve(reply))));

// node:http con conexiones persistentes. No se usa fetch: en Windows cada peticion de fetch suma ~15 ms
// por el temporizador del sistema y penalizaria a REST sin que tenga que ver con el protocolo.
const agent = new Agent({ keepAlive: true, maxSockets: Infinity });

const restGet = <T>(path: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    httpGet(`${backendHttp}${path}`, { agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`REST ${res.statusCode}`));
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as T);
      });
    }).on('error', reject);
  });

const routes: Record<string, (n: number) => Promise<number>> = {
  // Muchas llamadas pequenas en paralelo: pedir n estudiantes de uno en uno.
  'fanout/rest': async (n) => (await Promise.all(Array.from({ length: n }, (_, i) => restGet(`/students/${i + 1}`)))).length,
  'fanout/grpc': async (n) =>
    (await Promise.all(Array.from({ length: n }, (_, i) => grpcCall('GetStudent', { id: i + 1 })))).length,
  // Una sola llamada grande: pedir la lista completa.
  'bulk/rest': async (n) => (await restGet<unknown[]>(`/students?limit=${n}`)).length,
  'bulk/grpc': async (n) => (await grpcCall<{ students: unknown[] }>('ListStudents', { limit: n })).students.length,
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = url.pathname.replace(/^\//, '');
  const handler = routes[route];
  if (!handler) {
    res.writeHead(404).end();
    return;
  }
  try {
    const count = await handler(Number(url.searchParams.get('n') ?? 20));
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ count }));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
  }
});
server.keepAliveTimeout = 65_000; // ver main.ts: evita ECONNRESET falsos entre pruebas
server.listen(gatewayPort, '127.0.0.1', () => {
  console.log(`Gateway  http://127.0.0.1:${gatewayPort}/fanout/{rest|grpc}?n=20  y  /bulk/{rest|grpc}?n=2000`);
});
