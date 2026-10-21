// Mide el costo de TLS y de abrir conexiones nuevas, REST (HTTP/1.1) frente a gRPC (HTTP/2).
// Levanta scripts/tls/server.mjs como proceso hijo (cuatro oyentes: REST y gRPC, con y sin TLS) y mide la misma
// llamada (GetStudent, id 7) en dos escenarios, con el mismo metodo que scripts/bench.mjs:
//   P. Conexion persistente: un agente con keep-alive / un solo canal gRPC reutilizado.
//   N. Conexion nueva en cada llamada: agente nuevo sin keep-alive y "Connection: close" / cliente gRPC nuevo
//      (con su canal) por llamada, que se cierra al terminar. Peor caso de HTTP/2 + TLS: TCP + TLS + SETTINGS.
// Escribe results/TLS.md.
// Uso: node scripts/tls-bench.mjs
// Variables: ROUNDS (3), SMOKE=1 (prueba funcional corta: unas pocas llamadas, sin medir ni escribir resultados),
//            NEW_CONN_RATE_CAP (100, tope de llamadas/s en la prueba de latencia con conexion nueva),
//            TLS_REST_PORT, TLS_REST_TLS_PORT, TLS_GRPC_PORT, TLS_GRPC_TLS_PORT (18900 a 18903).
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { openLoop, saturate } from './lib/load.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const certFile = join(root, 'scripts/tls/certs/cert.pem');
const PORTS = {
  rest: Number(process.env.TLS_REST_PORT ?? 18900),
  restTls: Number(process.env.TLS_REST_TLS_PORT ?? 18901),
  grpc: Number(process.env.TLS_GRPC_PORT ?? 18902),
  grpcTls: Number(process.env.TLS_GRPC_TLS_PORT ?? 18903),
};
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const SMOKE = process.env.SMOKE === '1';
const LOAD_FRACTION = 0.4;
// Cada llamada con conexion nueva deja un socket en TIME_WAIT (unos 2 a 4 min en Windows) y el rango de puertos
// efimeros ronda los 16 000. Por eso la prueba de latencia usa un ritmo moderado y los trabajadores son pocos.
const NEW_CONN_RATE_CAP = Number(process.env.NEW_CONN_RATE_CAP ?? 100);
const NEW_CONN_WORKERS = 4;

// Si ya hay algo en un puerto, mediriamos otro servidor sin saberlo.
const portFree = (port) =>
  new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
for (const port of Object.values(PORTS)) {
  if (!(await portFree(port))) {
    console.error(`El puerto ${port} ya esta en uso; cambie TLS_*_PORT o pare ese proceso.`);
    process.exit(1);
  }
}

const server = spawn('node', ['scripts/tls/server.mjs'], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'inherit'] });
const stop = () => server.kill();
process.on('exit', stop);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('el servidor TLS no arranco')), 30_000);
  server.once('exit', (code) => reject(new Error(`el servidor TLS termino (codigo ${code})`)));
  server.stdout.on('data', (d) => {
    if (String(d).includes('LISTO')) {
      clearTimeout(timer);
      resolve();
    }
  });
});

// ---- Clientes -------------------------------------------------------------------------------------------------
const ca = readFileSync(certFile);
const definition = protoLoader.loadSync(join(root, 'proto/students.proto'), { keepCase: false });
const { StudentService } = grpc.loadPackageDefinition(definition).students;
const channelCredentials = (tls) => (tls ? grpc.credentials.createSsl(ca) : grpc.credentials.createInsecure());

// REST: la respuesta se recibe completa y se decodifica a un objeto, igual que en scripts/lib/clients.mjs.
function restCall(tls, agent, headers = {}) {
  const lib = tls ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      { host: '127.0.0.1', port: tls ? PORTS.restTls : PORTS.rest, path: '/students/7', method: 'GET', agent, headers, ...(tls ? { ca } : {}) },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const grpcCall = (client) =>
  new Promise((resolve, reject) => client.getStudent({ id: 7 }, (err, reply) => (err ? reject(err) : resolve(reply))));

const agents = [];
const channels = [];

// Persistente: un agente con keep-alive (varios sockets HTTP/1.1, uno por llamada en vuelo) o un canal gRPC (una
// sola conexion HTTP/2 con las llamadas multiplexadas).
function persistent(tls) {
  const agent = new (tls ? https : http).Agent({ keepAlive: true, ...(tls ? { ca } : {}) });
  agents.push(agent);
  const client = new StudentService(`127.0.0.1:${tls ? PORTS.grpcTls : PORTS.grpc}`, channelCredentials(tls));
  channels.push(client);
  return { rest: () => restCall(tls, agent), grpc: () => grpcCall(client) };
}

// Nueva en cada llamada: agente nuevo (asi tampoco se reanuda la sesion TLS del agente anterior) sin keep-alive y con
// "Connection: close"; o cliente gRPC nuevo, cuyo canal se cierra al terminar (haya salido bien o mal).
function fresh(tls) {
  return {
    rest: async () => {
      const agent = new (tls ? https : http).Agent({ keepAlive: false });
      try {
        return await restCall(tls, agent, { connection: 'close' });
      } finally {
        agent.destroy();
      }
    },
    grpc: async () => {
      const client = new StudentService(`127.0.0.1:${tls ? PORTS.grpcTls : PORTS.grpc}`, channelCredentials(tls));
      try {
        return await grpcCall(client);
      } finally {
        client.close();
      }
    },
  };
}

const variants = (make) => {
  const plain = make(false);
  const secure = make(true);
  return [
    ['REST HTTP/1.1, sin TLS', plain.rest],
    ['REST HTTP/1.1, con TLS', secure.rest],
    ['gRPC HTTP/2, sin TLS', plain.grpc],
    ['gRPC HTTP/2, con TLS', secure.grpc],
  ];
};

const groups = [
  {
    title: 'P. Conexión persistente (keep-alive / un solo canal gRPC)',
    variants: variants(persistent),
    sat: { workers: 10, warmupS: 2, seconds: 4 },
    calib: { workers: 10, warmupS: 1, seconds: 2 },
    lat: {},
  },
  {
    title: 'N. Conexión nueva en cada llamada (TCP + TLS + SETTINGS de HTTP/2 por llamada)',
    variants: variants(fresh),
    sat: { workers: NEW_CONN_WORKERS, warmupS: 1, seconds: 3 },
    calib: { workers: NEW_CONN_WORKERS, warmupS: 1, seconds: 2 },
    lat: { maxInflight: 200 },
    rateCap: NEW_CONN_RATE_CAP,
  },
];

// ---- Prueba funcional corta -----------------------------------------------------------------------------------
async function smoke() {
  for (const g of groups) {
    for (const [name, call] of g.variants) {
      for (let i = 0; i < 3; i++) await call();
      const reply = await call();
      console.log(`${g.title.slice(0, 1)} ${name}: id=${reply.id} name=${reply.name}`);
    }
  }
  // El oyente con TLS debe rechazar a un cliente sin TLS (y al reves), si no, la medicion no seria de TLS.
  const expectFail = async (label, fn) => {
    try {
      await fn();
      console.log(`FALLO: ${label} funciono y no debia`);
      process.exitCode = 1;
    } catch (e) {
      console.log(`OK: ${label} rechazado (${e.code ?? e.message})`);
    }
  };
  await expectFail('REST sin TLS contra el puerto TLS', () =>
    new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: PORTS.restTls, path: '/students/7', agent: false, timeout: 3000 }, (res) => {
        res.resume();
        res.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${res.statusCode}`));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timeout')));
    }),
  );
  await expectFail('gRPC sin TLS contra el puerto TLS', async () => {
    const c = new StudentService(`127.0.0.1:${PORTS.grpcTls}`, grpc.credentials.createInsecure());
    try {
      await new Promise((resolve, reject) => c.getStudent({ id: 7 }, { deadline: Date.now() + 3000 }, (e, r) => (e ? reject(e) : resolve(r))));
    } finally {
      c.close();
    }
  });
  await expectFail('REST con TLS contra el puerto sin TLS', () => restCallAt(true, PORTS.rest));
  await expectFail('gRPC con TLS contra el puerto sin TLS', async () => {
    const c = new StudentService(`127.0.0.1:${PORTS.grpc}`, grpc.credentials.createSsl(ca));
    try {
      await new Promise((resolve, reject) => c.getStudent({ id: 7 }, { deadline: Date.now() + 3000 }, (e, r) => (e ? reject(e) : resolve(r))));
    } finally {
      c.close();
    }
  });
}

function restCallAt(tls, port) {
  return new Promise((resolve, reject) => {
    const req = (tls ? https : http).get({ host: '127.0.0.1', port, path: '/students/7', agent: false, ca, timeout: 3000 }, (res) => {
      res.resume();
      resolve();
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

// ---- Medicion -------------------------------------------------------------------------------------------------
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? f1(xs[0]) : `${f1(Math.min(...xs))}–${f1(Math.max(...xs))}`);

const lines = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};

try {
  if (SMOKE) {
    await smoke();
  } else {
    out('# Costo de TLS y de abrir conexiones nuevas (REST HTTP/1.1 frente a gRPC HTTP/2)');
    out();
    out(
      `Servidor (proceso Node aparte, sin NestJS, sin base simulada) y cliente en la misma máquina (loopback). Misma llamada en todos los casos: \`GetStudent\` / \`GET /students/7\`, que devuelve el mismo estudiante. ` +
        `Certificado autofirmado de demo (RSA 2048, validado por el cliente). Cada cifra es la mediana de ${ROUNDS} rondas; entre paréntesis, el rango entre rondas. Las variantes se recorren en orden distinto en cada ronda.`,
    );
    out();
    out('- **Máx. llamadas/s:** bucle cerrado (10 trabajadores en la conexión persistente; 4 en la nueva, para no agotar puertos efímeros). Puede estar limitado por el propio cliente, que es un solo proceso Node.');
    out(`- **Latencia:** llegadas a ritmo fijo, común a las cuatro variantes del escenario (${LOAD_FRACTION * 100} % de lo que aguanta la más lenta), con 2 s de calentamiento descartados y 8 s medidos. El tiempo cuenta desde que la llamada debió salir.`);
    out(`- **Conexión nueva:** cada llamada abre y cierra su conexión (REST: agente nuevo, sin reanudar la sesión TLS; gRPC: cliente y canal nuevos). Cada una deja un socket en TIME_WAIT, y el rango de puertos efímeros es finito, así que el ritmo de la prueba de latencia se limita a ${NEW_CONN_RATE_CAP} llamadas/s como máximo.`);
    out('- **Persistente:** REST abre varios sockets HTTP/1.1 (uno por llamada en vuelo) y gRPC multiplexa todo en una sola conexión HTTP/2; es la diferencia de diseño, no un truco de la medición.');
    out();

    for (const group of groups) {
      const calibration = [];
      for (const [, call] of group.variants) calibration.push((await saturate(call, group.calib)).rps);
      let rate = Math.max(5, Math.floor(Math.min(...calibration) * LOAD_FRACTION));
      const capped = group.rateCap && rate > group.rateCap;
      if (capped) rate = group.rateCap;

      const results = group.variants.map(() => ({ rps: [], p50: [], p95: [], p99: [], errors: 0 }));
      for (let round = 0; round < ROUNDS; round++) {
        const order = group.variants.map((_, i) => i);
        for (let k = 0; k < round; k++) order.push(order.shift());
        for (const i of order) {
          const call = group.variants[i][1];
          const sat = await saturate(call, group.sat);
          const lat = await openLoop(call, { rate, ...group.lat });
          const r = results[i];
          r.rps.push(sat.rps);
          r.p50.push(lat.p50);
          r.p95.push(lat.p95);
          r.p99.push(lat.p99);
          r.errors += sat.errors + lat.errors + lat.dropped;
        }
      }

      out(`## ${group.title}`);
      out();
      out(`Ritmo común de la prueba de latencia: ${rate} llamadas/s${capped ? ` (limitado; el 40 % de la variante más lenta habría sido ${Math.floor(Math.min(...calibration) * LOAD_FRACTION)})` : ''}.`);
      out();
      out('| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |');
      out('|---|---:|---:|---:|---:|---:|');
      group.variants.forEach(([name], i) => {
        const r = results[i];
        out(
          `| ${name} | ${f1(median(r.rps))} (${range(r.rps)}) | ${f1(median(r.p50))} (${range(r.p50)}) | ${f1(median(r.p95))} (${range(r.p95)}) | ${f1(median(r.p99))} (${range(r.p99)}) | ${r.errors} |`,
        );
      });
      out();
    }

    mkdirSync(join(root, 'results'), { recursive: true });
    writeFileSync(join(root, 'results/TLS.md'), lines.join('\n') + '\n');
  }
} finally {
  for (const a of agents) a.destroy();
  for (const c of channels) c.close();
  stop();
}
