// Definición de cada escenario: qué ruta de A se carga, con qué script de k6 y qué falla
// se inyecta en Toxiproxy antes de empezar (R5 la inyecta el propio k6 a mitad de la corrida).
export interface Toxico {
  proxy: string;
  cuerpo: Record<string, unknown>; // lo que se envía a POST /proxies/<proxy>/toxics
}
export interface Escenario {
  id: string;
  titulo: string;
  script: 'carga.js' | 'rafaga.js' | 'dos-rutas.js';
  env: Record<string, string>;
  toxicos: Toxico[];
}

// 20 % de las conexiones a B reciben la respuesta 2 s tarde.
const lento20: Toxico = { proxy: 'b', cuerpo: { name: 'lento', type: 'latency', stream: 'downstream', toxicity: 0.2, attributes: { latency: 2000, jitter: 0 } } };
// 20 % de las conexiones a B quedan colgadas: la petición no llega a B y la conexión no se cierra nunca.
// (En el sentido A->B: si se aplica a la respuesta, B cierra su lado y Toxiproxy corta la conexión.)
const colgado20: Toxico = { proxy: 'b', cuerpo: { name: 'colgado', type: 'timeout', stream: 'upstream', toxicity: 0.2, attributes: { timeout: 0 } } };

export const ESCENARIOS: Escenario[] = [
  { id: 'R0', titulo: 'Línea base: B sano, sin protección', script: 'carga.js', env: { RUTA: '/r1' }, toxicos: [] },
  { id: 'R1-lento', titulo: 'Sin protección, 20 % de llamadas a B tardan 2 s', script: 'carga.js', env: { RUTA: '/r1' }, toxicos: [lento20] },
  { id: 'R1-colgado', titulo: 'Sin protección, 20 % de llamadas a B se cuelgan', script: 'carga.js', env: { RUTA: '/r1', K6_TIMEOUT: '10s' }, toxicos: [colgado20] },
  { id: 'R2-lento', titulo: 'Timeout de 300 ms, 20 % lentas', script: 'carga.js', env: { RUTA: '/r2' }, toxicos: [lento20] },
  { id: 'R2-colgado', titulo: 'Timeout de 300 ms, 20 % colgadas', script: 'carga.js', env: { RUTA: '/r2', K6_TIMEOUT: '10s' }, toxicos: [colgado20] },
  { id: 'R3-lento', titulo: 'Timeout de 300 ms + 2 reintentos (backoff + jitter), 20 % lentas', script: 'carga.js', env: { RUTA: '/r3' }, toxicos: [lento20] },
  { id: 'R3-colgado', titulo: 'Timeout de 300 ms + 2 reintentos (backoff + jitter), 20 % colgadas', script: 'carga.js', env: { RUTA: '/r3', K6_TIMEOUT: '10s' }, toxicos: [colgado20] },
  { id: 'R4-antes-sin-espera', titulo: '50 a la vez, B da 503 durante 1 s; reintentos de antes/: enseguida, sin espera', script: 'rafaga.js', env: { RUTA: '/r4/antes', N: '50', FALLA_MS: '1000' }, toxicos: [] },
  { id: 'R4-sin-jitter', titulo: '50 a la vez, B da 503 durante 1 s; reintentos sin jitter', script: 'rafaga.js', env: { RUTA: '/r4?jitter=ninguno', N: '50', FALLA_MS: '1000' }, toxicos: [] },
  { id: 'R4-jitter-completo', titulo: 'Lo mismo, jitter completo', script: 'rafaga.js', env: { RUTA: '/r4?jitter=completo', N: '50', FALLA_MS: '1000' }, toxicos: [] },
  { id: 'R4-jitter-igual', titulo: 'Lo mismo, jitter «igual» (mitad fija + mitad al azar)', script: 'rafaga.js', env: { RUTA: '/r4?jitter=igual', N: '50', FALLA_MS: '1000' }, toxicos: [] },
  { id: 'R5-colgado-sin-breaker', titulo: 'B colgado de 10 a 20 s; timeout 500 ms, sin breaker', script: 'carga.js', env: { RUTA: '/r5?breaker=0', FALLA: 'colgado' }, toxicos: [] },
  { id: 'R5-colgado-breaker-10s', titulo: 'Lo mismo + breaker, ventana de 10 s (valor por omisión de opossum)', script: 'carga.js', env: { RUTA: '/r5?breaker=1&ventana=10000', FALLA: 'colgado' }, toxicos: [] },
  { id: 'R5-colgado-breaker-2s', titulo: 'Lo mismo + breaker, ventana de 2 s', script: 'carga.js', env: { RUTA: '/r5?breaker=1&ventana=2000', FALLA: 'colgado' }, toxicos: [] },
  { id: 'R5-caido-sin-breaker', titulo: 'B caído (conexión rechazada) de 10 a 20 s; sin breaker', script: 'carga.js', env: { RUTA: '/r5?breaker=0', FALLA: 'caido' }, toxicos: [] },
  { id: 'R5-caido-breaker-10s', titulo: 'Lo mismo + breaker, ventana de 10 s', script: 'carga.js', env: { RUTA: '/r5?breaker=1&ventana=10000', FALLA: 'caido' }, toxicos: [] },
  { id: 'R5-caido-breaker-2s', titulo: 'Lo mismo + breaker, ventana de 2 s', script: 'carga.js', env: { RUTA: '/r5?breaker=1&ventana=2000', FALLA: 'caido' }, toxicos: [] },
  { id: 'R6-sin-bulkhead', titulo: 'Ruta lenta (B tarda 2 s) y ruta rápida comparten 20 conexiones', script: 'dos-rutas.js', env: { BULKHEAD: '0' }, toxicos: [{ proxy: 'b_lento', cuerpo: { name: 'lento', type: 'latency', stream: 'downstream', toxicity: 1, attributes: { latency: 2000, jitter: 0 } } }] },
  { id: 'R6-con-bulkhead', titulo: 'Lo mismo, ruta lenta limitada a 10 llamadas a la vez', script: 'dos-rutas.js', env: { BULKHEAD: '1' }, toxicos: [{ proxy: 'b_lento', cuerpo: { name: 'lento', type: 'latency', stream: 'downstream', toxicity: 1, attributes: { latency: 2000, jitter: 0 } } }] },
];
