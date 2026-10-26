// Minimal stateless API used to try the S11 lab end to end.
// No dependencies: only Node 24's standard library.
//
//   GET /        -> 200 with the message from the ConfigMap and whether the
//                   secret is present (never its value)
//   GET /salud   -> 200 while the process is up (used by the probes)
//
// Configuration comes from the environment (12-factor, S02):
//   PORT          port to listen on (default 3000)
//   MENSAJE       text returned by GET / (from the ConfigMap)
//   API_KEY       secret as an environment variable (from the Secret), or
//   API_KEY_FILE  path of a file with the secret (Secret mounted as a file)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

const port = Number(process.env.PORT ?? 3000);

function secretIsSet() {
  if (process.env.API_KEY) return true;
  const file = process.env.API_KEY_FILE;
  if (!file) return false;
  try {
    return readFileSync(file, 'utf8').trim().length > 0;
  } catch {
    return false;
  }
}

const server = createServer((req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'GET' && req.url === '/salud') {
    return send(200, { estado: 'ok' });
  }
  if (req.method === 'GET' && req.url === '/') {
    return send(200, {
      mensaje: process.env.MENSAJE ?? '(sin MENSAJE)',
      secreto_configurado: secretIsSet(),
      pod: hostname(),
    });
  }
  send(404, { error: 'no encontrado' });
});

server.listen(port, () => console.log(`listening on port ${port}`));

// Clean shutdown (S02): Kubernetes sends SIGTERM before killing the pod.
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing');
  server.close(() => process.exit(0));
});
