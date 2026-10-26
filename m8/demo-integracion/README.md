# Integración con sistemas externos (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 9

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni cuentas de ningún servicio: el proveedor de webhooks y el «tercero» con límite son simuladores locales.

## Qué es

Tres formas de integrar un backend con sistemas que no controlamos, cada una en versión ingenua y corregida, medidas con conteos exactos:

- **I1. Recibir datos: webhook entrante.** Un proveedor de pagos avisa `payment.succeeded`. Si el receptor hace el trabajo dentro de la petición, el proveedor se cansa de esperar y reenvía (abonos duplicados), y sin firma acepta webhooks falsos. Corregido: firma HMAC verificada en tiempo constante, ventana de tiempo, `202` en milisegundos, bandeja de entrada en Postgres usada como cola (`FOR UPDATE SKIP LOCKED`) y efecto idempotente por `webhook-id`.
- **I2. Cargar datos por lotes: mini-ETL.** Un CSV de clientes con filas malas y repetidas. Si se lee todo en memoria y se inserta fila por fila en una transacción, la primera fila mala aborta todo y re-ejecutar duplica. Corregido: lectura por partes, validación por fila, rechazados a un CSV con motivo, tabla intermedia y `INSERT … ON CONFLICT DO UPDATE` (la segunda ejecución no cambia nada).
- **I3. Enviar datos a un tercero.** Una API externa que acepta N peticiones/s y responde `429` con `Retry-After`. Si se manda todo en ráfaga y se reintenta en el acto, se pierden pedidos en silencio. Corregido: outbox, concurrencia limitada, `Retry-After` respetado, backoff con jitter e `Idempotency-Key`.

| Pieza | Dónde | Notas |
|---|---|---|
| Postgres 17.11 | `127.0.0.1:18432` | base `integ` |
| Servicio `tools` (perfil `tools`) | red de Compose | imagen con Node 24 y los CSV generados; corre los scripts de medición junto a Postgres |
| Receptor del webhook `src/antes/webhook-receiver.ts` y `src/despues/webhook-receiver.ts` | `127.0.0.1:18410` | `POST /webhooks/payments` |
| Worker de la bandeja `src/despues/webhook-worker.ts` | proceso | 8 en paralelo, Postgres como cola |
| Proveedor de pagos y atacante simulados `src/sim/webhook-sender.ts` | dentro de `scripts/i1-webhook.ts` | firma al estilo [Standard Webhooks](https://www.standardwebhooks.com/) |
| Importador `src/antes/importer.ts` y `src/despues/importer.ts` | proceso | lee `data/clientes-*.csv` |
| Generador del CSV `scripts/gen-csv.ts` | proceso | semilla fija: el mismo archivo en cualquier máquina |
| «Tercero» con límite `src/sim/third-party.ts` | `127.0.0.1:18420` | cubeta de fichas, `429` + `Retry-After`, 2 % de `503` |
| Envío al tercero `src/antes/sender.ts` y `src/despues/sender.ts` | proceso | |

Todos los puertos son altos y escuchan solo en `127.0.0.1`. Nombre de proyecto Compose: `s09-int`.

## El código: antes y después

| Carpeta | Qué hay |
|---|---|
| [`src/antes/`](src/antes/) | receptor que no verifica la firma y hace el trabajo lento antes de responder; importador con `readFileSync`, sin validar, un `INSERT` por fila en una transacción y sin clave natural; envío en ráfaga con reintentos inmediatos y una marca de agua que avanza aunque haya fallos |
| [`src/despues/`](src/despues/) | receptor con firma HMAC + ventana + bandeja + `202`, worker idempotente; importador por partes con validación, rechazados, tabla intermedia y upsert; envío desde la outbox con concurrencia limitada, `Retry-After`, backoff con jitter e `Idempotency-Key`. Cada corrección está marcada con `// CORRECCIÓN: …` y su porqué |
| [`src/sim/`](src/sim/) | los sistemas externos simulados: el proveedor de webhooks (con un atacante) y el tercero con límite |
| [`src/lib/`](src/lib/) | piezas comunes: configuración, esquemas de Postgres, firma, trabajo lento simulado, memoria |

[`DIFERENCIAS.md`](DIFERENCIAS.md) es la tabla problema → línea en `antes/` → cambio en `despues/` → cifra medida.

## Escenarios

| | Qué se mide | Qué enseña |
|---|---|---|
| **I1** | 200 eventos con plazo de 2 s y reenvíos, 20 entregas duplicadas a propósito, 20 falsas y 10 repeticiones viejas | Responder tarde provoca reenvíos y, sin idempotencia, efectos duplicados; sin firma, cualquiera «paga» un pedido |
| **I2** | CSV de 50 000 y 500 000 filas (~3 % inválidas, ~1 % duplicadas), dos ejecuciones seguidas | Una fila mala no debe abortar la carga; la memoria no debe crecer con el archivo; re-ejecutar debe ser seguro |
| **I3** | 1000 pedidos a un tercero de 50/s, con y sin ritmo propio | Reintentar en el acto contra un límite empeora todo; respetar `Retry-After` y llevar registro de lo pendiente no pierde nada |

## Requisitos

- Docker Desktop con Compose (probado con motor 29.9.2 y Compose 5.6.0).
- Node.js 24 o superior (probado con 24.19.0): ejecuta los `.ts` directamente, sin compilar.

## Cómo correrlo

Las cifras de referencia se tomaron con Node **dentro de la red de Compose** (servicio `tools`, perfil `tools`): desde el anfitrión Windows cada consulta a Postgres pasa por el puerto publicado y la carga fila por fila de I2 se vuelve decenas de veces más lenta (ver «Dónde corre Node» en [`results/ESCENARIOS.md`](results/ESCENARIOS.md)). La imagen genera los CSV al construirse.

```
npm install                                   # solo para correr piezas a mano o el typecheck
docker compose up -d --wait                   # Postgres
docker compose --profile tools build tools
docker compose --profile tools run --rm tools node --no-warnings scripts/i1-webhook.ts    # -> results/I1_WEBHOOK.md        (~4 min)
docker compose --profile tools run --rm tools node --no-warnings scripts/i2-import.ts     # -> results/I2_IMPORTACION.md    (~8 min)
docker compose --profile tools run --rm tools node --no-warnings scripts/i2-memlimit.ts   # -> results/I2_LIMITE_MEMORIA.md (~2 min)
docker compose --profile tools run --rm tools node --no-warnings scripts/i2-garbage.ts    # -> results/I2_BASURA.md         (segundos)
docker compose --profile tools run --rm tools node --no-warnings scripts/i3-send.ts       # -> results/I3_ENVIO.md          (~3 min)
docker compose --profile tools down -v        # borra contenedores y datos
```

En Git Bash, antepongan `MSYS_NO_PATHCONV=1` a los `docker compose run`. Los mismos scripts corren en el anfitrión (`npm run up`, `npm run gen-csv -- 50000`, `npm run gen-csv -- 500000`, `npm run i1`, `npm run i2`, `npm run i3`), con las salvedades de latencia dichas. Con `SMOKE=1` (y, por ejemplo, `N=40 RUNS=1` en I1 o `SIZES=50000 RUNS=1` en I2) hacen una corrida corta que se guarda en `results/raw/` sin pisar los resultados de referencia.

A mano, I1:

```
npm run up
node src/despues/webhook-receiver.ts        # terminal 1 (o src/antes/webhook-receiver.ts)
node src/despues/webhook-worker.ts          # terminal 2
curl -i -X POST http://127.0.0.1:18410/webhooks/payments -H "content-type: application/json" -d "{\"type\":\"payment.succeeded\",\"data\":{\"order_id\":\"ord_1\",\"amount_cents\":1500}}"
```

La versión `despues` responde `401 too-old` o `401 bad-signature` a ese `curl` sin firma; la versión `antes` responde `200` (tras 0,2-3 s) y anota el abono. A mano, I2: `node src/despues/importer.ts data/clientes-50000.csv` (dos veces) y mirar `out/rechazados.csv`. A mano, I3: `node src/sim/third-party.ts` en una terminal y `node src/despues/sender.ts` en otra, después de cargar la tabla `outbound` (lo hace `scripts/i3-send.ts`).

## Resultados de referencia

Medidos el 26 de octubre de 2026 en un portátil (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop con WSL2, motor 29.9.2), 3 corridas por escenario:

- **I1** con 200 eventos y un plazo de 2 s: si el receptor trabaja dentro de la petición, responde en 1,1 s de mediana (p95 1,9 s), el proveedor reenvía **127-131 veces** y quedan **157-161 abonos duplicados**; acepta **20 de 20 webhooks falsos** y **10 de 10 repeticiones**. Con firma + ventana + bandeja + `202`: responde en **~5 ms**, **0 reenvíos, 0 duplicados, 0 falsos aceptados**.
- **I2** con 50 000 filas: la carga ingenua **aborta en la línea 38 y no carga nada**; sin las inválidas, carga, pero re-ejecutarla **duplica** todo, y de las 1428 inválidas la base habría aceptado 807 como basura. La versión por lotes carga 48 090, aparta **1428 con su motivo**, y la segunda ejecución hace **0 cambios**. Con 500 000 filas: 78,9 s y 454 MB frente a 13,2 s y 229 MB; con el heap limitado a 32 MB, la ingenua muere por falta de memoria y la corregida termina.
- **I3** con 1000 pedidos a un tercero de 50/s: ráfaga + reintentos inmediatos = 3678 respuestas 429 y **~900 pedidos perdidos** que la segunda pasada no recupera; con outbox + `Retry-After` + backoff con jitter + 8 a la vez, **0 perdidos** en 22,1 s (mínimo teórico 19 s); con un ritmo propio de 45/s, además, **0 respuestas 429**.

Ver [`results/ESCENARIOS.md`](results/ESCENARIOS.md): resumen de todas las cifras, por qué sale cada una y qué no se midió. Las tablas completas, corrida por corrida, están en los demás archivos de `results/`.
