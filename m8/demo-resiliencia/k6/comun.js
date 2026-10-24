// Piezas comunes de los scripts de k6.
export const A = 'http://a:3000';
export const TOXIPROXY = 'http://toxiproxy:8474';

// Estadísticas que se guardan de cada tendencia (latencias).
export const summaryTrendStats = ['med', 'p(95)', 'p(99)', 'max', 'avg', 'count'];

// k6 solo guarda en el resumen las submétricas (p. ej. por fase) que tienen un umbral.
// Este umbral nunca falla: está solo para que la submétrica aparezca.
export function submetricas(etiqueta, valores) {
  const t = {};
  for (const v of valores) {
    t[`http_req_duration{${etiqueta}:${v}}`] = ['max>=0'];
    t[`http_req_failed{${etiqueta}:${v}}`] = ['rate>=0'];
  }
  return t;
}

// Escribe el resumen completo en /out/<SALIDA>.json (montado en results/raw/).
export function guardarResumen(data) {
  return { [`/out/${__ENV.SALIDA || 'resumen'}.json`]: JSON.stringify(data, null, 1) };
}
