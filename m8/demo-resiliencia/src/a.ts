// Servicio A: expone una ruta por escenario y en cada una llama a B (a través de Toxiproxy).
// Las rutas usan el cliente de antes/ (sin protecciones) o las piezas corregidas de despues/;
// las diferencias, una por una, están en DIFERENCIAS.md. Este archivo es solo el servidor y los
// contadores. Solo node:http + opossum; TypeScript que Node 24 ejecuta tal cual.
import http from 'node:http';
import type CircuitBreaker from 'opossum';
import { ErrorDeB } from './http-get.ts';
import * as antes from './antes/cliente-b.ts';
import * as despues from './despues/cliente-b.ts';
import { crearBreaker } from './despues/breaker.ts';
import { ErrorLleno, LimiteConcurrencia } from './despues/bulkhead.ts';

const PUERTO = Number(process.env.PUERTO ?? 3000);
const B = process.env.B_URL ?? 'http://toxiproxy:8666'; // R1-R5: B a través del proxy "b"
const B_LENTO = process.env.B_LENTO_URL ?? 'http://toxiproxy:8667'; // R6: dependencia lenta
const B_RAPIDO = process.env.B_RAPIDO_URL ?? 'http://toxiproxy:8668'; // R6: dependencia sana

// R1-R5: sin límite de conexiones, una conexión nueva por llamada.
const agente = new http.Agent({ keepAlive: false });
// R6: las dos rutas comparten un pool de 20 conexiones (como compartirían un pool de BD o de hilos).
const agenteCompartido = new http.Agent({ keepAlive: false, maxTotalSockets: 20 });

// ---------- Contadores para /stats (no son parte de la resiliencia) ----------
interface Ruta {
  peticiones: number;
  respuestas: Record<string, number>; // "200", "504 timeout", "503 circuito abierto", ...
  llamadasAB: number; // intentos que A lanzó hacia B (incluye reintentos)
  reintentos: number;
  enCurso: number;
  maxEnCurso: number;
  tLlamadas: number[]; // instante de cada llamada a B (ms desde epoch)
}
let rutas: Record<string, Ruta> = {};
let marcas: Record<string, number> = {};
let eventosBreaker: { t: number; evento: string }[] = [];
// Un breaker por tamaño de ventana (R5 compara 10 s, el valor por omisión de opossum, con 2 s).
// La acción protegida: solo se ejecuta (y solo se cuenta como llamada a B) si el circuito la deja pasar.
const accionR5 = (url: string, r: Ruta) => contada(r, () => despues.llamarB(url, agente, 500))();
let breakers: Record<number, CircuitBreaker<[string, Ruta], unknown>> = {};
const breaker = (ventanaMs: number) =>
  (breakers[ventanaMs] ??= crearBreaker(accionR5, ventanaMs, (evento) => eventosBreaker.push({ t: Date.now(), evento })));
let bulkhead = new LimiteConcurrencia(10);

function ruta(nombre: string): Ruta {
  return (rutas[nombre] ??= { peticiones: 0, respuestas: {}, llamadasAB: 0, reintentos: 0, enCurso: 0, maxEnCurso: 0, tLlamadas: [] });
}
// Envuelve una llamada a B para contarla.
function contada<T>(r: Ruta, fn: (intento: number) => Promise<T>): (intento?: number) => Promise<T> {
  return (intento = 1) => {
    r.llamadasAB++;
    if (r.tLlamadas.length < 200_000) r.tLlamadas.push(Date.now());
    return fn(intento);
  };
}

// ---------- Rutas ----------
type Manejador = (q: URLSearchParams, r: Ruta) => Promise<unknown>;

const manejadores: Record<string, Manejador> = {
  // R1 (antes/): sin protección. Si B tarda 2 s, A tarda 2 s; si B se cuelga, A espera para siempre.
  '/r1': (_q, r) => contada(r, () => antes.llamarB(`${B}/datos`, agente))(),

  // R2 (despues/): plazo total de 300 ms.
  '/r2': (_q, r) => contada(r, () => despues.llamarB(`${B}/datos`, agente, 300))(),

  // R3 (despues/): plazo de 300 ms por intento + hasta 2 reintentos con backoff exponencial y jitter completo.
  '/r3': (_q, r) =>
    despues.conReintentos(contada(r, (i) => despues.llamarB(`${B}/datos`, agente, 300, i)), {
      idempotente: true, intentos: 3, baseMs: 50, topeMs: 1000, jitter: 'completo', alReintentar: () => r.reintentos++,
    }),

  // R4 (despues/): hasta 6 intentos, espera base 200 ms que se duplica (tope 2 s); ?jitter=ninguno|completo|igual.
  '/r4': (q, r) =>
    despues.conReintentos(contada(r, (i) => despues.llamarB(`${B}/datos`, agente, 1000, i)), {
      idempotente: true, intentos: 6, baseMs: 200, topeMs: 2000, jitter: (q.get('jitter') ?? 'completo') as despues.Jitter, alReintentar: () => r.reintentos++,
    }),

  // R4 (antes/): los mismos 6 intentos, pero reintentando enseguida, sin espera.
  '/r4/antes': (_q, r) =>
    antes.conReintentos(contada(r, (i) => { if (i > 1) r.reintentos++; return antes.llamarB(`${B}/datos`, agente, i); }), 6),

  // R5: plazo de 500 ms (despues/), con o sin circuit breaker (despues/breaker.ts). Con el circuito
  // abierto, opossum rechaza al instante (EOPENBREAKER) sin llamar a B. ?ventana= cambia su ventana.
  '/r5': (q, r) =>
    q.get('breaker') === '1'
      ? breaker(Number(q.get('ventana') ?? 10_000)).fire(`${B}/datos`, r)
      : contada(r, () => despues.llamarB(`${B}/datos`, agente, 500))(),

  // R6: dos rutas que comparten el pool de 20 conexiones, con plazo de 2,5 s (despues/).
  // La lenta, opcionalmente con bulkhead de 10 (despues/bulkhead.ts).
  '/r6/lento': (q, r) => {
    const llamada = contada(r, () => despues.llamarB(`${B_LENTO}/datos`, agenteCompartido, 2500));
    return q.get('bulkhead') === '1' ? bulkhead.ejecutar(llamada) : llamada();
  },
  '/r6/rapido': (_q, r) => contada(r, () => despues.llamarB(`${B_RAPIDO}/datos`, agenteCompartido, 2500))(),
};

function respuestaDeError(err: unknown): [number, string] {
  if (despues.esTimeout(err)) return [504, '504 timeout'];
  if ((err as { code?: string }).code === 'EOPENBREAKER') return [503, '503 circuito abierto'];
  if (err instanceof ErrorLleno) return [503, '503 bulkhead lleno'];
  if (err instanceof ErrorDeB) return [502, `502 B respondió ${err.status}`];
  return [502, `502 ${(err as { code?: string }).code ?? 'error'}`]; // ECONNREFUSED, ECONNRESET...
}

function json(res: http.ServerResponse, status: number, cuerpo: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cuerpo));
}

function reiniciar() {
  rutas = {};
  marcas = {};
  eventosBreaker = [];
  for (const cb of Object.values(breakers)) cb.shutdown();
  breakers = {};
  bulkhead = new LimiteConcurrencia(10);
  // Corta las llamadas que hayan quedado colgadas de la corrida anterior (R1 con B colgado).
  for (const ag of [agente, agenteCompartido])
    for (const lista of Object.values(ag.sockets)) for (const s of lista ?? []) s.destroy();
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://a');
    if (url.pathname === '/stats') {
      const estado = (cb: CircuitBreaker) => (cb.opened ? 'abierto' : cb.halfOpen ? 'semiabierto' : 'cerrado');
      const bs = Object.fromEntries(Object.entries(breakers).map(([v, cb]) => [v, { estado: estado(cb), stats: cb.stats }]));
      return json(res, 200, { rutas, marcas, breaker: { eventos: eventosBreaker, porVentana: bs }, bulkhead: { enCurso: bulkhead.enCurso, rechazadas: bulkhead.rechazadas } });
    }
    if (url.pathname === '/stats/reset') return reiniciar(), json(res, 200, { ok: true });
    if (url.pathname === '/admin/marca') return (marcas[url.searchParams.get('nombre') ?? 'x'] = Date.now()), json(res, 200, { ok: true });

    const manejar = manejadores[url.pathname];
    if (!manejar) return json(res, 404, { error: 'no existe' });
    const r = ruta(url.pathname + (url.search ? url.search : ''));
    r.peticiones++;
    r.maxEnCurso = Math.max(r.maxEnCurso, ++r.enCurso);
    try {
      await manejar(url.searchParams, r);
      r.respuestas['200'] = (r.respuestas['200'] ?? 0) + 1;
      json(res, 200, { ok: true });
    } catch (err) {
      const [status, motivo] = respuestaDeError(err);
      r.respuestas[motivo] = (r.respuestas[motivo] ?? 0) + 1;
      json(res, status, { error: motivo });
    } finally {
      r.enCurso--;
    }
  })
  .listen(PUERTO, () => console.log(`A escuchando en :${PUERTO}`));
