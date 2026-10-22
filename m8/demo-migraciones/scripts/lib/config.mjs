// Configuración común. Todo se puede cambiar con variables de entorno.
export const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 18543),
  user: process.env.PGUSER ?? 'demo',
  password: process.env.PGPASSWORD ?? 'demo',
  // Tamaño de la tabla grande (pedidos). Por defecto 10 millones de filas.
  filas: Number(process.env.FILAS ?? 10_000_000),
  clientes: Number(process.env.CLIENTES ?? 100_000),
  semilla: Number(process.env.SEMILLA ?? 42),
  // Carga: llegadas a ritmo fijo (peticiones por segundo) y conexiones del pool de la "aplicación".
  ritmo: Number(process.env.RITMO ?? 200),
  pool: Number(process.env.POOL ?? 20),
  // Una petición cuenta como "bloqueada" si tarda más que esto (ms).
  umbralBloqueo: Number(process.env.UMBRAL_MS ?? 100),
  // Segundos de carga antes (línea base) y después de cada migración.
  antes: Number(process.env.ANTES_S ?? 6),
  despues: Number(process.env.DESPUES_S ?? 3),
  // Tamaño de lote para los rellenos por lotes.
  lote: Number(process.env.LOTE ?? 50_000),
  // Rondas: cada variante se mide RONDAS veces y el informe da la mediana y el rango.
  rondas: Number(process.env.RONDAS ?? 3),
  // Filtro opcional de escenarios: ESCENARIOS=M4,M5
  escenarios: process.env.ESCENARIOS ? process.env.ESCENARIOS.split(',').map((s) => s.trim()) : null,
};

export function conexion(database) {
  return { host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
