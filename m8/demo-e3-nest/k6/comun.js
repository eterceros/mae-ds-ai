// Piezas comunes de los scripts de k6 (corren dentro de la red de Docker de compose.yaml).
export const API = __ENV.API || 'http://api:3000';
export const TOXIPROXY = __ENV.TOXIPROXY || 'http://toxiproxy:8474';
export const PROXY = 'precios'; // el nombre del proxy en toxiproxy/toxiproxy.json

// Estadísticas que se guardan de cada tendencia (latencias). 'med' = mediana (p50).
export const summaryTrendStats = ['med', 'p(95)', 'p(99)', 'max', 'avg', 'count'];

// k6 solo informa en el resumen las submétricas (p. ej. ruta=pedidos y fase=falla) que tienen
// un umbral. Estos umbrales nunca fallan: están solo para que cada submétrica aparezca.
// Si quieren que k6 marque la corrida como fallida cuando no se cumple su hipótesis, agreguen
// uno de verdad, p. ej. 'http_req_duration{ruta:catalogo,fase:falla}': ['p(95)<50'].
export function submetricas(rutas, fases) {
  const t = {};
  for (const ruta of rutas) {
    for (const fase of fases) {
      t[`http_req_duration{ruta:${ruta},fase:${fase}}`] = ['max>=0'];
      t[`http_req_failed{ruta:${ruta},fase:${fase}}`] = ['rate>=0'];
    }
  }
  for (const fase of fases) t[`llamadas_a_precios{fase:${fase}}`] = ['count>=0'];
  return t;
}

// Escribe el resumen completo en /out/<nombre>.json (montado en resultados/) y muestra en
// pantalla una tabla por ruta y fase. El nombre: SALIDA si se da; si no, forma-falla-fecha.
export function guardarResumen(rutas, fases) {
  return (data) => {
    const forma = (data.setup_data && data.setup_data.modo) || 'desconocida';
    const falla = __ENV.FALLA || 'sin-falla';
    const fecha = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nombre = __ENV.SALIDA || `${forma}-${falla}-${fecha}`;
    return {
      [`/out/${nombre}.json`]: JSON.stringify(data, null, 1),
      stdout: tabla(data, rutas, fases, forma, falla, nombre),
    };
  };
}

function tabla(data, rutas, fases, forma, falla, nombre) {
  const m = data.metrics;
  const ms = (v) => (v === undefined ? '-' : v.toFixed(1));
  const filas = [
    `\nForma: ${forma} · falla: ${falla} · resumen en resultados/${nombre}.json\n`,
    'ruta      fase            peticiones   p50 (ms)   p95 (ms)   max (ms)   % errores',
  ];
  for (const ruta of rutas) {
    for (const fase of fases) {
      const d = m[`http_req_duration{ruta:${ruta},fase:${fase}}`];
      const f = m[`http_req_failed{ruta:${ruta},fase:${fase}}`];
      if (!d) continue;
      const v = d.values;
      const errores = f ? (f.values.rate * 100).toFixed(1) : '-';
      filas.push(
        `${ruta.padEnd(9)} ${fase.padEnd(15)} ${String(v.count).padStart(10)} ${ms(v.med).padStart(10)} ` +
          `${ms(v['p(95)']).padStart(10)} ${ms(v.max).padStart(10)} ${errores.padStart(11)}`,
      );
    }
  }
  filas.push('\nLlamadas de la API a precios, por fase (en http: intentos por la red; las rechazadas por el breaker no cuentan):');
  for (const fase of fases) {
    const c = m[`llamadas_a_precios{fase:${fase}}`];
    filas.push(`  ${fase.padEnd(15)} ${c ? c.values.count : 0}`);
  }
  return filas.join('\n') + '\n\n';
}
