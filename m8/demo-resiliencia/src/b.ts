// Servicio B: responde al instante. Las fallas de red (lentitud, cuelgues, cortes) las pone
// Toxiproxy delante de B; B solo sabe fallar "a propósito" con 503 (R4) y contar lo que recibe.
import http from 'node:http';

const PUERTO = Number(process.env.PUERTO ?? 3001);
let llegadas: number[] = []; // instante de cada petición recibida (ms desde epoch)
let intentos: number[] = []; // número de intento que dice A (cabecera x-intento); 1 = no es reintento
let fallarHasta = 0; // hasta este instante responde 503 (simula un B que se reinicia o está saturado)

function json(res: http.ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://b');
    if (url.pathname === '/datos') {
      if (llegadas.length < 500_000) llegadas.push(Date.now()), intentos.push(Number(req.headers['x-intento'] ?? 1));
      if (Date.now() < fallarHasta) return json(res, 503, { error: 'B no disponible' });
      return json(res, 200, { id: 42, nombre: 'dato de B' });
    }
    if (url.pathname === '/stats') return json(res, 200, { recibidas: llegadas.length, llegadas, intentos });
    if (url.pathname === '/stats/reset') return (llegadas = []), (intentos = []), (fallarHasta = 0), json(res, 200, { ok: true });
    if (url.pathname === '/admin/fallar') {
      fallarHasta = Date.now() + Number(url.searchParams.get('ms') ?? 1000);
      return json(res, 200, { fallarHasta });
    }
    json(res, 404, { error: 'no existe' });
  })
  .listen(PUERTO, () => console.log(`B escuchando en :${PUERTO}`));
