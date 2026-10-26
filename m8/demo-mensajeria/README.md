# Mensajería con Postgres y RabbitMQ 4.4 (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 8

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni tokens de ningún servicio: la IA es un modelo local (Docker Model Runner).

## Qué es

Una API de pedidos (Node 24 + TypeScript, sin framework) que tiene que avisar «hay un pedido nuevo» a otro servicio a través de RabbitMQ. Sobre ella se mide, **matando procesos de verdad en el punto crítico** y contando mensajes uno por uno, qué se pierde y qué se duplica con cada diseño: doble escritura, outbox transaccional con relay, consumidor con y sin idempotencia, mensajes venenosos, reintentos con retardo y, para la E4, una llamada a un LLM local de forma síncrona frente a `202 Accepted` + cola + worker. El contrato del evento está en [`asyncapi.yaml`](asyncapi.yaml) (AsyncAPI 3.1) y se comprueba contra los mensajes reales.

| Pieza | Dónde | Notas |
|---|---|---|
| Postgres 17.11 | `127.0.0.1:18332` | base `shop` (Q1-Q4, Q8) y base `e4` (Q7) |
| RabbitMQ 4.4.0 (`rabbitmq:4.4.0-management`) | AMQP `127.0.0.1:18372`, consola `http://127.0.0.1:18373` (demo/demo) | colas *quorum* |
| API de pedidos `src/antes/api.ts` y `src/despues/api.ts` | `127.0.0.1:18310-18312` | la levantan los scripts en el anfitrión |
| Relay de outbox `src/despues/relay.ts` | proceso | `FOR UPDATE SKIP LOCKED`, publisher confirms |
| Worker de envíos `src/antes/worker.ts` y `src/despues/worker.ts` | proceso | prefetch, ack manual; el de `despues/` con tabla de procesados y DLQ |
| E4: `llm-api-antes` (síncrona) | `127.0.0.1:18321` | contenedor (perfil `e4`), `src/antes/llm-api.ts` |
| E4: `llm-api` + `llm-worker` (202 + cola) | `127.0.0.1:18320` | contenedores (perfil `e4`), `src/despues/llm-api.ts` y `llm-worker.ts`; `models:` de Compose |
| LLM local `ai/smollm2` | Docker Model Runner | Compose inyecta `LLM_URL` y `LLM_MODEL` |
| k6 2.3.0 | contenedor (perfil `load`) | solo como evidencia de carga en Q7 |

Todos los puertos son altos y escuchan solo en `127.0.0.1`. Nombre de proyecto Compose: `s08-msg`.

## El código: antes y después

El código está en dos carpetas para comparar la mala práctica con su corrección, lado a lado:

| Carpeta | Qué hay |
|---|---|
| [`src/antes/`](src/antes/) | API con doble escritura (`COMMIT` y luego `publish`), worker sin idempotencia que responde `nack(requeue=true)` sin DLQ, llamada síncrona al LLM dentro de la petición |
| [`src/despues/`](src/despues/) | API con outbox transaccional + relay (`FOR UPDATE SKIP LOCKED`, publisher confirms), worker idempotente (`processed_messages` en la misma transacción), reintentos limitados y DLQ, `202 Accepted` + recurso de estado + cola + worker para el LLM, `traceparent` propagado, apagado limpio. Cada corrección está marcada con `// CORRECCIÓN: …` y su porqué |
| [`src/lib/`](src/lib/) | piezas comunes: conexiones, topología de RabbitMQ, esquema de Postgres, traceparent, cliente del LLM |

[`DIFERENCIAS.md`](DIFERENCIAS.md) es la tabla problema → línea en `antes/` → cambio en `despues/` → cifra medida.

## Escenarios

| | Qué se mide | Qué enseña |
|---|---|---|
| **Q1** (`antes/api.ts`) | Doble escritura: `COMMIT` y `publish` por separado, matando la API entre los dos (y al revés) | Se pierden eventos (o aparecen eventos de pedidos que no existen), exactamente uno por cada caída |
| **Q2** (`despues/api.ts`, `despues/relay.ts`) | Outbox transaccional + 2 relays con `FOR UPDATE SKIP LOCKED`, matando API y relays | 0 perdidos; algunos duplicados: «al menos una vez». Controles: sin muertes y sin `SKIP LOCKED` |
| **Q3** (`antes/worker.ts`) | Consumidor sin idempotencia con reentregas reales | Envíos duplicados |
| **Q4** (`despues/worker.ts`) | Consumidor con tabla de procesados en la misma transacción | 0 duplicados con las mismas reentregas |
| **Q5** | Mensaje venenoso, cuatro formas de decir «falló» | Solo `reject(requeue=true)` cuenta para `x-delivery-limit` en 4.4; `nack(requeue=true)` gira para siempre |
| **Q6** | Reintento con retardo: nativo de quorum queues (4.3/4.4) frente a DLX + TTL | Precisión del retardo y bloqueo en cabeza de cola del TTL por mensaje |
| **Q7** (`antes/llm-api.ts` frente a `despues/llm-api.ts` + `llm-worker.ts`) | E4: LLM síncrono frente a `202` + recurso de estado + cola + worker, con k6 y matando el worker | Timeouts en cascada frente a cola que absorbe; nada se pierde al matar el worker |
| **Q8** | `asyncapi.yaml` 3.1 validado con la CLI, `diff` de cambios incompatibles y mensajes reales contra el esquema | El contrato como prueba, no como documento |

Además, en Q3-Q4 y Q7 se comprueba que la cabecera `traceparent` (W3C Trace Context) viaja de la petición HTTP a la outbox, al mensaje AMQP y al worker con el mismo *trace-id* (sin OpenTelemetry; eso es la sesión 11, mié 4 nov).

## Requisitos

- Docker Desktop con Compose ≥ 2.38 (probado con motor 29.9.2 y Compose 5.6.0).
- Docker Model Runner activado (`docker desktop enable model-runner --tcp=12434`) y el modelo descargado: `docker model pull ai/smollm2` (256 MiB). Solo para Q7.
- Node.js 24 o superior (probado con 24.19.0): ejecuta los `.ts` directamente, sin compilar.

## Cómo correrlo

```
npm install
npm run up         # Postgres y RabbitMQ (espera a que estén sanos)
npm run q1-q2      # Q1-Q2 -> results/Q1-Q2_OUTBOX.md        (~8 min)
npm run q3-q4      # Q3-Q4 -> results/Q3-Q4_IDEMPOTENCIA.md  (~6 min)
npm run q5         # Q5    -> results/Q5_VENENOSO.md          (~2 min)
npm run q6         # Q6    -> results/Q6_RETARDO.md           (~3 min)
npm run q7         # Q7    -> results/Q7_E4_LLM.md            (construye y levanta el perfil e4; ~30 min)
npm run q8         # Q8    -> results/Q8_ASYNCAPI.md          (~1 min)
npm run down       # borra contenedores y datos (no toca el modelo de Model Runner)
```

Los scripts levantan y matan sus propios procesos. Con `SMOKE=1` (y, por ejemplo, `N=200 RUNS=1`) hacen una corrida corta que se guarda en `results/raw/` sin pisar los resultados de referencia. La inyección de fallos está en el código y se activa por variables de entorno: `CRASH_EVERY` (API), `RELAY_CRASH_EVERY_BATCHES` (relay) y `WORKER_CRASH_EVERY` (worker) matan el proceso con `SIGKILL` justo en el punto crítico. Para probar a mano: `npm run up`, luego `node src/despues/api.ts`, `node src/despues/relay.ts` y `node src/despues/worker.ts` en tres terminales (o `node src/antes/api.ts` y `node src/antes/worker.ts` para ver el problema), y `curl -X POST http://127.0.0.1:18310/orders -H "content-type: application/json" -d "{\"seq\":1,\"customer\":\"c-1\",\"amountCents\":1500}"`.

E4 a mano: `npm run e4:up`, y luego

```
curl -X POST http://127.0.0.1:18321/sync/summaries  -H "content-type: application/json" -d "{\"text\":\"Order 42 was paid and shipped.\"}"
curl -i -X POST http://127.0.0.1:18320/async/summaries -H "content-type: application/json" -d "{\"text\":\"Order 42 was paid and shipped.\"}"
curl http://127.0.0.1:18320/jobs/<id del Location>
```

## Resultados de referencia

Medidos el 24 de octubre de 2026 en un portátil (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop 4.96.1 con WSL2; el LLM corre en CPU), 3 corridas por escenario:

- **Q1** doble escritura, 1000 pedidos y 10 caídas en el punto crítico: **10 eventos perdidos** (o 10 fantasma, si se publica antes del `COMMIT`), siempre. **Q2** outbox: **0 perdidos**, 142-172 duplicados cuando los relays mueren; 0 sin caídas; unos 750 si se quita `FOR UPDATE SKIP LOCKED`.
- **Q3** sin idempotencia: **296-407 envíos duplicados** por cada 1000 pedidos. **Q4** con tabla de procesados: **0**.
- **Q5** en RabbitMQ 4.4, `nack(requeue=true)` no cuenta para `x-delivery-limit`: el venenoso se intentó 1618-3057 veces en 10 s sin llegar a la DLQ; con `reject(requeue=true)`, 4 intentos y a la DLQ.
- **Q6** los tres reintentos con retardo (nativo, `x-opt-delivery-time`, DLX + TTL) aciertan el plan por decenas de ms; el TTL por mensaje retiene un mensaje de 1 s detrás de uno de 5 s.
- **Q7** a 20 pet/s, el LLM síncrono responde 504 al 80-83 % y sigue ocupado 37-73 s después; con `202` + cola, 600/600 aceptados en ~3 ms y 600/600 hechos; matar el worker no pierde nada.
- **Q8** la CLI de AsyncAPI valida el documento, pero `asyncapi diff` no marca como *breaking* el renombrado de un campo obligatorio; los mensajes reales contra el esquema sí lo detectan (0/200).

Ver [`results/ESCENARIOS.md`](results/ESCENARIOS.md): resumen de todas las cifras, por qué sale cada una y qué no se midió. Las tablas completas, corrida por corrida, están en los demás archivos de `results/`.
