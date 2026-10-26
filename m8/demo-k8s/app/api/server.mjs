// api: responde /cotizacion llamando a precios. Servidor HTTP mínimo de Node 24, sin paquetes.
// antes/ y despues/ usan la misma imagen: solo cambian los manifiestos.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 3000);
const PRECIOS_URL = process.env.PRECIOS_URL ?? 'http://precios:3001'; // del ConfigMap
const MONEDA = process.env.MONEDA ?? 'BOB';                             // del ConfigMap
let shuttingDown = false;

async function callPrecios(path, timeoutMs) {
  const r = await fetch(PRECIOS_URL + path, { signal: AbortSignal.timeout(timeoutMs) });
  return { status: r.status, body: await r.json() };
}

// El Secret se lee de dos formas para compararlas (KC). Solo se devuelve una huella, nunca el valor.
function fingerprint(v) { return v ? createHash('sha256').update(v).digest('hex').slice(0, 8) : null; }
function keyFromFile() {
  const f = process.env.API_KEY_FILE; // p. ej. /etc/secretos/API_KEY (Secret montado como archivo)
  if (!f) return null;
  try { return readFileSync(f, 'utf8').trim(); } catch { return null; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    switch (url.pathname) {
      // Liveness: "¿el proceso puede responder?". No mira NADA fuera del proceso.
      case '/salud/vivo':
        return send(res, 200, { ok: true });
      // Readiness: "¿puedo recibir tráfico ahora?". Aquí: no me estoy apagando y precios responde.
      case '/salud/listo': {
        if (shuttingDown) return send(res, 503, { ok: false, motivo: 'apagando' });
        try {
          const p = await callPrecios('/salud', 500);
          return send(res, p.status === 200 ? 200 : 503, { ok: p.status === 200 });
        } catch { return send(res, 503, { ok: false, motivo: 'precios no responde' }); }
      }
      case '/cotizacion': {
        const producto = url.searchParams.get('producto') ?? 'p1';
        try {
          const p = await callPrecios(`/precios/${producto}`, 1000);
          if (p.status !== 200) return send(res, p.status, p.body);
          return send(res, 200, { ...p.body, moneda: MONEDA, pod: process.env.HOSTNAME });
        } catch { return send(res, 502, { error: 'precios no responde' }); }
      }
      case '/config':
        return send(res, 200, {
          moneda: MONEDA,
          clave_variable: fingerprint(process.env.API_KEY), // Secret como variable de entorno
          clave_archivo: fingerprint(keyFromFile()),        // Secret como archivo montado
          pod: process.env.HOSTNAME,
        });
      default:
        return send(res, 404, { error: 'not found' });
    }
  } catch (e) { send(res, 500, { error: String(e) }); }
});

function send(res, status, body) {
  // Al apagarse, pide al cliente cerrar su conexión keep-alive tras esta respuesta; si no, las
  // conexiones ocupadas mantienen vivo el proceso hasta que Kubernetes lo mata (30 s por defecto).
  if (shuttingDown) res.setHeader('connection', 'close');
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

server.listen(PORT, () => console.log(`api listening on ${PORT}, precios=${PRECIOS_URL}`));
// Apagado limpio (S02): la readiness pasa a 503 y el servidor se cierra.
process.on('SIGTERM', () => { shuttingDown = true; server.close(() => process.exit(0)); });
