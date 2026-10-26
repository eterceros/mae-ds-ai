# OpenTelemetry aplicado: de la cifra a la traza (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 11

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni cuentas de ningún servicio: el visor de trazas es local (`grafana/otel-lgtm`).

## Qué es

Una API de pedidos en NestJS 12 que, por cada `POST /pedidos`, pide el precio a otro servicio por HTTP (`precios`), guarda el pedido y su evento en la misma transacción (outbox, como en la S08) y un relay publica el evento en RabbitMQ para que un worker envíe la confirmación. Dos copias del mismo sistema corren lado a lado:

- **antes**: el código de la S08, con el `traceparent` armado a mano y logs de texto, **sin instrumentar** (y, para OB, con la auto-instrumentación encendida sobre ese mismo código).
- **despues**: la **auto-instrumentación de OpenTelemetry** (SDK JS 3.0) cargada desde `NODE_OPTIONS`, sin tocar el código de la app, más los tres cambios que sí hacen falta: llevar el contexto por la outbox con la API de OpenTelemetry, quitar el `traceparent` manual y escribir los logs con pino.

`precios` tarda 600 ms en 1 de cada 10 peticiones. Ese es el problema que hay que **encontrar**: con k6 solo se ve que el p95 es alto; con trazas se ve dónde se va el tiempo.

```
k6 ──HTTP──> api (NestJS 12) ──HTTP──> precios (1 de cada 10: 600 ms)
               │
               └─ BEGIN; INSERT pedido; INSERT outbox; COMMIT     (Postgres)
                                    │
                            relay ──publish──> RabbitMQ ──> worker (20 ms)
```

| Pieza | Dónde | Notas |
|---|---|---|
| `grafana/otel-lgtm:0.38.0` | Grafana `http://127.0.0.1:18530`; OTLP/HTTP `127.0.0.1:18532`; API de Tempo `127.0.0.1:18533`; API de Loki `127.0.0.1:18534` | Grafana + Tempo + Loki + Prometheus + colector en una imagen, **solo para desarrollo local**. En esta sesión solo se usa Explore → Tempo |
| Postgres 17.11 | `127.0.0.1:18545` | base `pedidos`, esquemas `antes` y `despues` |
| RabbitMQ 4.4.0 | AMQP `127.0.0.1:18540`, consola `http://127.0.0.1:18541` (demo/demo) | colas `pedidos.antes` y `pedidos.despues` (quorum) |
| api `src/antes/api.ts` / `src/despues/api.ts` | `127.0.0.1:18550` / `127.0.0.1:18555` | NestJS 12.2.0 sobre Express 5 |
| precios `src/precios.ts` | `127.0.0.1:18551` / `127.0.0.1:18556` | Node sin framework; el mismo código en las dos copias |
| relay `src/antes/relay.ts` / `src/despues/relay.ts` | proceso en contenedor | `FOR UPDATE SKIP LOCKED`, publisher confirms |
| worker `src/antes/worker.ts` / `src/despues/worker.ts` | proceso en contenedor | trabajo simulado de 20 ms |
| k6 2.3.0 | contenedor (perfil `load`) | [`k6/pedidos.js`](k6/pedidos.js) |

Todos los puertos son altos y escuchan solo en `127.0.0.1`. Nombre de proyecto Compose: `s11-otel`.

## Instrumentar sin tocar el código

Todo está en [`docker-compose.yml`](docker-compose.yml) (anclas `x-otel` y `x-instrumentado`):

```yaml
NODE_OPTIONS: --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register
OTEL_SERVICE_NAME: api
OTEL_EXPORTER_OTLP_ENDPOINT: http://lgtm:4318
OTEL_NODE_RESOURCE_DETECTORS: env,host,os,process,serviceinstance
OTEL_NODE_DISABLED_INSTRUMENTATIONS: net,dns,router
```

- `--import …/register` arranca el SDK con todas las instrumentaciones antes que la app. Es lo que dice el README del paquete (con `--require` para CommonJS).
- `--experimental-loader=…/hook.mjs` hace falta porque la app es **ESM** (NestJS 12 solo se publica como ESM). Sin el gancho siguen saliendo los spans de HTTP, `fetch` y Postgres, pero **desaparecen los de Express y el `trace_id` de los logs de pino**, y el span de la API se llama `POST` en vez de `POST /pedidos` (medido: ver «Sin el gancho ESM» en [`results/OB-OC_COLA_Y_LOGS.md`](results/OB-OC_COLA_Y_LOGS.md)). Node avisa que `--experimental-loader` podría desaparecer y propone `register()`; con Node 24.22 funciona.
- Los detectores de nube se quitan porque al arrancar intentan hablar con servicios de metadatos de AWS, GCP o Azure; `net`, `dns` y `router` se apagan porque llenan la traza de spans sin interés (el paquete `router` repite los spans de Express 5).

Versiones fijadas (las resuelve `package-lock.json`): `@opentelemetry/api` 1.10.0, `@opentelemetry/auto-instrumentations-node` 0.82.0, que trae el **SDK 3.0** (`@opentelemetry/sdk-node` 0.300.0, `core`, `resources` y `sdk-trace` 3.0.0) y las instrumentaciones `http` 0.300.0, `undici` 0.34.0, `express` 0.72.0, `pg` 0.77.0, `amqplib` 0.71.0, `pino` 0.70.0 y `nestjs-core` 0.71.0. El SDK 3.0 funcionó con NestJS 12 sin cambios; no hizo falta volver a la 2.12.

**Lo que la auto-instrumentación no ve en NestJS 12:** `@opentelemetry/instrumentation-nestjs-core` 0.71.0 declara soporte para `@nestjs/core >=4.0.0 <12`, así que con NestJS 12 no aparece ningún span de Nest (controlador, *guards*, *pipes*); los spans del manejador vienen de la instrumentación de Express (`request handler - /pedidos`). Para la pregunta de esta sesión alcanza: el tiempo de la petición se reparte entre `fetch`, Postgres y lo que queda.

## El código: antes y después

| Carpeta | Qué hay |
|---|---|
| [`src/antes/`](src/antes/) | API con `traceparent` manual de la S08 (`childOf()` de [`src/lib/trace.ts`](src/lib/trace.ts)) guardado en la fila de la outbox; relay que publica esas cabeceras; worker que lee la cabecera a mano; logs de texto con `console.log` |
| [`src/despues/`](src/despues/) | lo mismo sin `traceparent` manual: la API guarda en la outbox el contexto activo con `propagation.inject()`, el relay publica dentro de ese contexto con `propagation.extract()` + `context.with()`, el worker no toca cabeceras, logs JSON con pino. Cada cambio está marcado con `// CORRECCIÓN: …` y su porqué |
| [`src/lib/`](src/lib/) | configuración, Postgres (esquema y outbox), RabbitMQ, logger y el `traceparent` manual de la S08 |
| [`src/precios.ts`](src/precios.ts) | el servicio lento 1 de cada 10 (el mismo en las dos copias) |

[`DIFERENCIAS.md`](DIFERENCIAS.md) es la tabla problema → línea en `antes/` → cambio en `despues/` → cifra medida.

## Escenarios

| | Qué se mide | Qué enseña |
|---|---|---|
| **OA** | k6 a 20 pedidos/s durante 30 s contra cada copia | Sin trazas, k6 dice «p95 ≈ 610 ms» y nada más; con trazas, la traza más lenta muestra que casi todo es el span de `precios` |
| **OB** | 100 pedidos con trace-id conocido; ¿cuántas trazas llegan de la API al worker? | La auto-instrumentación propaga sola por HTTP (`fetch`) y por RabbitMQ (`amqplib`), pero **no por una tabla**: con la outbox, la traza se corta en el relay. El `traceparent` manual de la S08 no lo arregla: `amqplib` lo pisa con el suyo |
| **OC** | ¿qué trace id queda en cada línea de log, y se encuentra en Loki? | Con pino instrumentado, cada log lleva el `trace_id` real sin escribir una línea; los logs de `console.log` no llegan a Loki y, en `antes`, el worker escribe un trace id que no es el de la petición |
| **OD** | El procedimiento de la demo 4: del p95 de k6 a la traza más lenta de la ventana de la prueba y a su camino crítico | Etiquetar las peticiones de k6 (y mandar su `traceparent`) convierte «el p95 es alto» en «esta traza, este span» |

## Requisitos

- Docker Desktop con Compose (probado con motor 29.9.2 y Compose 5.6.0). k6 corre en un contenedor (`grafana/k6:2.3.0`): no hay que instalarlo.
- Node.js 24 o superior (probado con 24.19.0) para los scripts de medición; las apps corren en contenedores con Node 24.22.1.

## Cómo correrlo

```
npm install                 # para los scripts de medición y el typecheck
npm run up                  # construye la imagen y levanta todo (~1 min la primera vez)
npm run oa-od               # OA + OD -> results/OA-OD_P95_A_TRAZA.md   (~7 min)
npm run oa-desglose         # OA, todas las peticiones -> results/OA_DESGLOSE.md (~1 min; justo después de oa-od)
npm run ob-oc               # OB + OC -> results/OB-OC_COLA_Y_LOGS.md   (~4 min)
npm run down                # borra contenedores y datos
```

Con `SMOKE=1` (y, por ejemplo, `RUNS=1 N=20`) los scripts hacen una corrida corta que se guarda en `results/raw/` sin pisar los resultados de referencia.

A mano:

```
curl -i -X POST http://127.0.0.1:18555/pedidos -H "content-type: application/json" -d "{\"sku\":\"sku-7\",\"cantidad\":2}"
docker compose logs worker-despues          # la línea "pedido confirmado" trae trace_id
```

y en Grafana (`http://127.0.0.1:18530`) → **Explore** → origen **Tempo** → pestaña **Search** o **TraceQL**.

Para encender la instrumentación sobre el código de `antes` (OB), en Git Bash:

```
ANTES_NODE_OPTIONS="--experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register" docker compose up -d --wait
```

y `docker compose up -d --wait` sin la variable para volver a apagarla (en PowerShell: `$env:ANTES_NODE_OPTIONS="..."` y luego `Remove-Item Env:ANTES_NODE_OPTIONS`).

## OD: de la cifra a la traza, paso a paso

1. **La cifra.** Corran k6 guardando cada petición:
   ```
   MSYS_NO_PATHCONV=1 docker compose --profile load run --rm k6 run -e ESCENARIO=demo4 --out json=/out/mi-prueba.json.gz /scripts/pedidos.js
   ```
   k6 imprime el p95 de `http_req_duration`. Cada petición de [`k6/pedidos.js`](k6/pedidos.js) lleva las etiquetas `escenario` y `corrida` y **su propio `traceparent`**, guardado como etiqueta `trace_id`: así k6 sabe con qué trace-id salió cada petición.
2. **La ventana.** En Grafana, Explore → Tempo, pongan el rango de tiempo de la prueba (o «Last 15 minutes» si fue recién).
3. **La consulta.** En TraceQL, con el p95 que dio k6 como umbral:
   ```
   { resource.service.name = "api" && kind = server && duration >= 610ms }
   ```
   (agreguen `&& resource.service.namespace = "despues"` si corren las dos copias). Ordenen la tabla por duración y abran la primera. La búsqueda de Tempo tarda unos 30 s en ver las trazas recién llegadas: si sale vacía, esperen y repitan.
4. **Atajo.** `npm run lenta -- results/raw/mi-prueba.json.gz` lista las peticiones más lentas según k6 con su trace-id; péguenlo en el buscador de Tempo.
5. **La causa.** En la vista de la traza, bajen desde `POST /pedidos` por el hijo más largo (camino crítico): `request handler - /pedidos` → `GET` (cliente `fetch`) → `GET` en `precios`. Si ese último ocupa casi todo, la causa está en `precios`, no en la API ni en Postgres.

## Resultados de referencia

Medidos el 26 de octubre de 2026 en un portátil (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop con WSL2, motor 29.9.2), 3 corridas por escenario:

- **OA** a 20 pedidos/s: sin trazas, k6 da **p50 9,9 ms y p95 606 ms** y nada más. Con la auto-instrumentación (p50 11,7 ms, p95 607 ms), la traza más lenta de cada corrida muestra el camino `POST /pedidos` → `fetch` → `precios` = 600 ms (77-89 % del total) y, además, un `COMMIT` de Postgres de 73-175 ms. De las 186 peticiones de más de 300 ms, **180 fueron por `precios`** y **6 solo por el `COMMIT`**.
- **OB** con 100 pedidos por corrida: la auto-instrumentación propaga sola por HTTP y por RabbitMQ, pero no por la outbox. Con el código de la S08 instrumentado, **0 de 300** trazas llegan al worker (`amqplib` pisa el `traceparent` manual); con `propagation.inject`/`extract` en la API y el relay, **300 de 300**.
- **OC**: con pino instrumentado, **300/300** líneas de la API y del worker llevan el `trace_id` de su petición y se encuentran en Loki; en `antes`, el worker escribe el trace id del relay (0/300 correctos) y `console.log` no llega a Loki.
- **OD**: TraceQL `duration >= p95` en la ventana de la prueba devuelve 29-33 trazas, todas de esa prueba, y **la más lenta según Tempo es la más lenta según k6 en 3 de 3**. La búsqueda tarda ~30-40 s en ver las trazas nuevas.
- El **SDK JS 3.0** funcionó con NestJS 12 sin cambios; la instrumentación propia de NestJS no soporta la 12 (no hay spans de Nest), y sin el gancho ESM se pierden los spans de Express y el `trace_id` en los logs.

Ver [`results/ESCENARIOS.md`](results/ESCENARIOS.md): resumen de todas las cifras, por qué sale cada una y qué no se midió. Las tablas completas, corrida por corrida, y las trazas en texto están en los demás archivos de `results/`.
