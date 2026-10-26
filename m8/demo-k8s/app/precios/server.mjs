// precios: la dependencia de api. Servidor HTTP mínimo de Node 24, sin paquetes.
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3001);
const PRICES = { p1: 120, p2: 85, p3: 42 };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/salud') return send(res, 200, { ok: true });
  const m = url.pathname.match(/^\/precios\/(\w+)$/);
  if (m && PRICES[m[1]] !== undefined) return send(res, 200, { producto: m[1], precio: PRICES[m[1]] });
  send(res, 404, { error: 'not found' });
});

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

server.listen(PORT, () => console.log(`precios listening on ${PORT}`));
// Apagado limpio (S02): deja de aceptar, termina lo que está en curso y sale.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
