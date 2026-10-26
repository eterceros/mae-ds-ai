// Servicio INTERNO simulado para el escenario SD (SSRF). Representa algo que solo debería ser
// alcanzable desde dentro: un panel sin autenticar, una base de datos, o el endpoint de metadatos de
// la nube (169.254.169.254) que entrega credenciales. Aquí devuelve un "secreto" de juguete. En la
// demo escucha en 127.0.0.1:18630; lo importante es que es un destino que la API NUNCA debería traer
// por orden de un usuario.
import http from 'node:http';
import { INTERNAL_PORT } from '../lib/config.ts';

let hits = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${INTERNAL_PORT}`);
  if (url.pathname === '/health') { res.writeHead(200).end('{"ok":true}'); return; }
  hits++;
  // Imita el endpoint de metadatos de AWS/GCP: devuelve "credenciales" internas.
  res.writeHead(200, { 'content-type': 'application/json' })
    .end(JSON.stringify({ secreto: 'TOKEN-INTERNO-NO-DEBERIA-SALIR', accesosDesdeFuera: hits }));
});

server.listen(INTERNAL_PORT, '127.0.0.1', () => console.log(`RESULT ${JSON.stringify({ service: 'internal', port: INTERNAL_PORT })}`));
