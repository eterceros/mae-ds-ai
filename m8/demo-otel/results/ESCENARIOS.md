# Resultados de la demo de OpenTelemetry (OA-OD)

Medido el 26 de octubre de 2026 en un portátil: Intel Core i9-12900H (20 hilos lógicos), 64 GB de RAM, Windows 11 (10.0.26200), Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0; la VM ve 20 CPU y 31 GB). Apps en `node:24.22.1-slim`, NestJS 12.2.0, amqplib 2.2.0, pg 8.23.1, pino 10.4.0; OpenTelemetry JS **SDK 3.0** (`@opentelemetry/sdk-node` 0.300.0) vía `@opentelemetry/auto-instrumentations-node` 0.82.0; `grafana/otel-lgtm:0.38.0`; Postgres 17.11; RabbitMQ 4.4.0; k6 2.3.0 en un contenedor de la misma red de Compose.

Cada escenario se corrió 3 veces, alternando `antes` y `despues`; las tablas dan cada corrida y la mediana. Los conteos son exactos (cada petición lleva un trace-id conocido y se busca en Tempo y en los logs). El código está en `src/antes/` y `src/despues/`; [`DIFERENCIAS.md`](../DIFERENCIAS.md) los cruza línea por línea.

## Resumen

| Escenario | Qué se hizo | antes | despues |
|---|---|---|---|
| **OA** p95 alto ([detalle](OA-OD_P95_A_TRAZA.md), [desglose](OA_DESGLOSE.md)) | k6 a 20 pedidos/s durante 30 s (~600 peticiones); `precios` tarda 600 ms en 1 de cada 10 | sin instrumentar: **p50 9,9 ms, p95 606,0 ms** (mediana de 3). Es todo lo que se sabe | instrumentado: **p50 11,7 ms, p95 606,9 ms**. En las 3 corridas, la traza más lenta muestra `precios` = 77-89 % del tiempo; de las 186 peticiones de más de 300 ms, **180 por `precios`** (10 de ellas también con un `COMMIT` lento) y **6 solo por el `COMMIT`** de Postgres |
| **OB** traza por la outbox y la cola ([detalle](OB-OC_COLA_Y_LOGS.md)) | 100 pedidos con trace-id conocido; ¿la traza llega al worker? | con la auto-instrumentación encendida sobre el código de la S08: **0 de 100** trazas completas; el worker queda en **100 trazas nuevas** que empiezan en el relay | **100 de 100** completas (API → `precios` → Postgres → relay → RabbitMQ → worker, 14 spans) |
| **OC** logs con trace id (ídem) | ¿qué trace id escribe cada log y se encuentra en Loki? | API: 100/100 con el trace id correcto (lo arma a mano); **worker: 0/100** (escribe el del relay); **0 líneas en Loki** (`console.log`) | API y worker: **100/100** con el `trace_id` de la petición, sin código; **100/100 encontrados en Loki** por `trace_id` |
| **OD** de la cifra a la traza (ídem OA) | TraceQL con `duration >= p95` en la ventana de la prueba | — (no hay trazas) | 29-33 trazas por corrida (todas de esa prueba); **la más lenta de Tempo es la más lenta de k6 en 3 de 3**; la búsqueda tardó ~30-40 s en ver las trazas nuevas |

Además, la API de despues **sin** el gancho ESM (`--experimental-loader`) pierde los spans de Express, el nombre de la ruta en el span (`POST` en vez de `POST /pedidos`) y el `trace_id` de los logs de pino (0 de 20); siguen los de HTTP, `fetch` y Postgres (ver el final de [OB-OC_COLA_Y_LOGS.md](OB-OC_COLA_Y_LOGS.md)).

## OA. Sin trazas, solo el p95

**Mecanismo.** `precios` cuenta sus peticiones y la décima, la vigésima, etc. tardan 600 ms. Con 10 % de peticiones lentas, el p90 queda justo en el borde (salta entre 93 y 605 ms de una corrida a otra) y el **p95 cae siempre en ~606 ms**: k6 dice «algo tarda 600 ms en 1 de cada 10 peticiones», pero no qué. En `antes` no hay nada más que mirar: los logs dicen «pedido creado» sin tiempos. En la corrida 2 de `antes` hubo además un p95 de 678 ms y un máximo de 1,6 s que no se repitió; sin trazas no hay forma de saber qué fue (`[por verificar]`: probablemente un pico de la máquina).

**Con trazas.** La traza más lenta de cada corrida (676-780 ms) tiene siempre el mismo camino crítico: `POST /pedidos` → `request handler - /pedidos` → `GET` (el `fetch` de la API) → `GET` en `precios`, que ocupa 600 ms. Pero las tres tienen **un segundo culpable**: el `COMMIT` de Postgres tardó 175, 124 y 73 ms. Es lo que separa a las más lentas del resto de las de 600 ms. El desglose de las 1802 peticiones de despues lo confirma: el `COMMIT` tiene mediana 1,6 ms pero p99 158 ms (6 % pasa de 50 ms), y 6 peticiones fueron lentas **solo** por él. Una persona que mirara solo el p95 culparía a `precios` y tendría razón para el 97 % de los casos lentos; la traza muestra el otro 3 %. Por qué el `COMMIT` tarda a veces no se investigó (es tema de rendimiento, M12; `[por verificar]`: escritura del WAL a disco en el volumen de Docker Desktop/WSL2).

**Costo de instrumentar.** El p50 sube de ~10 a ~12 ms con la auto-instrumentación, sin cambio en el p95. Es una medida de una sola máquina con exportación cada 5 s; no es un estudio de *overhead*.

## OB. Lo que la auto-instrumentación propaga sola y lo que no

**Mecanismo.** La auto-instrumentación lleva el contexto sola por **HTTP** (lee el `traceparent` de entrada y lo escribe en el `fetch` a `precios`) y por **RabbitMQ** (`amqplib` lo escribe en las cabeceras del mensaje al publicar y lo lee al consumir). **No lo lleva por una tabla**: la outbox es una fila en Postgres que el relay lee después, en un bucle que no corre dentro de ninguna petición. En ese bucle no hay span activo, así que el `publish` del relay abre una traza nueva y el worker se cuelga de ella.

El `traceparent` manual de la S08 no lo salva: la API lo guarda bien en la fila (y el relay lo pone en el mensaje), pero `@opentelemetry/instrumentation-amqplib` hace `propagation.inject(…, options.headers)` al publicar (`node_modules/@opentelemetry/instrumentation-amqplib/dist/amqplib.mjs`, líneas 271-273, versión 0.71.0) y **escribe su `traceparent` encima del nuestro**. Resultado medido: 0 de 300 trazas completas, y los 300 spans del worker en 300 trazas que empiezan en el relay (`relay publish` → `worker process`, dos spans en la captura) y que nadie va a buscar.

**Corrección.** La API guarda en la fila el contexto activo con `propagation.inject(context.active(), headers)` y el relay publica dentro de ese contexto con `context.with(propagation.extract(ROOT_CONTEXT, row.headers), …)`. Son tres líneas con `@opentelemetry/api` (que no hace nada si no hay SDK). Resultado: 300 de 300 trazas completas, con el span del relay como hijo de la petición. Se ve el hueco real entre el `COMMIT` y la publicación (el relay sondea cada 50 ms).

## OC. Logs con trace id

`@opentelemetry/instrumentation-pino` agrega `trace_id`, `span_id` y `trace_flags` a cada línea que pino escribe dentro de un span, y además manda la línea por OTLP (en `otel-lgtm` llega a Loki con `trace_id` como metadato). En despues, las 600 líneas (API y worker) tienen el trace id de su petición y las 600 se encuentran en Loki con `{service_namespace="despues", service_name="worker"} | trace_id="…"`. En `antes`, la API escribe el trace id correcto (lo armó ella), pero el worker escribe el del relay (el que quedó en la cabecera, 0/300 correctos): un log que «tiene trace id» y apunta a la traza equivocada. Y `console.log` no pasa por ninguna instrumentación: 0 líneas de `antes` en Loki.

## OD. De la cifra a la traza

El procedimiento del README («OD: de la cifra a la traza, paso a paso») se ejecutó en cada corrida con la consulta exacta que escribiría una persona. Con el p95 de k6 como umbral, Tempo devolvió 29, 33 y 29 trazas (k6 tenía 31, 30 y 31 peticiones por encima del p95: el span de la API es un poco más corto que lo que mide k6, que incluye la red, y Tempo compara con `>=` sobre su propia medida). Todas eran de esa prueba, y **la más lenta según Tempo fue la más lenta según k6 en las 3 corridas** (780,4 / 781,1 ms; 728,5 / 728,4 ms; 676,2 / 676,8 ms). Detalle práctico: la búsqueda de Tempo no ve las trazas hasta ~30 s después de que llegan (la consulta por trace-id las ve en ~5 s); si la búsqueda sale vacía justo al terminar k6, hay que esperar.

Las métricas automáticas también existen: Prometheus (dentro de `otel-lgtm`) recibió `http_server_request_duration_seconds` de la API sin configurar nada, y su p95 en la ventana de las pruebas dio ~0,61 s. Solo se comprobó que está; paneles y alertas son de otros módulos.

## Cómo leer las capturas de texto

Las trazas de los `.md` de `results/` son el árbol que Grafana dibuja en Explore → Tempo, en texto: servicio, tipo de span, nombre, inicio relativo a la raíz, duración y span-id. La raíz dice «padre … NO está en la traza» porque su padre es el `traceparent` que mandó k6 (o el script), que no exporta spans. Los inicios vienen redondeados al milisegundo y las duraciones no, por eso un hijo puede «empezar» 1 ms antes o durar 0,1-5 ms más que su padre (`[por verificar]`: si el redondeo lo hace el SDK 3.0 o Tempo). Las trazas completas, en JSON, están en `raw/*-traza*.json`, y la salida de k6 petición por petición (con su `trace_id`) en `raw/oa-*.json.gz`.

## Qué no se midió

- **NestJS 11** con `@opentelemetry/instrumentation-nestjs-core` (que no soporta la 12): con él aparecerían spans propios de Nest. `[por verificar]`: no se probó.
- **El agente Java de OpenTelemetry y Spring**: esta demo es solo Node.
- **El SDK 2.12**: el 3.0 funcionó a la primera con NestJS 12, así que no se comparó.
- **Muestreo**: todo se exporta (100 %). Decidir qué muestrear en producción es de otro módulo.
- **Varias réplicas del relay o del worker**, reintentos y DLQ (vistos en la S08): un solo relay y un solo worker por copia.
- **Enlaces (*span links*) en vez de padre-hijo** para el consumidor (`useLinksForConsume` de la instrumentación de amqplib): requiere configurar la instrumentación por código.
- **Por qué el `COMMIT` tarda a veces 50-560 ms** y cualquier optimización (M12).
- **El costo de la instrumentación** más allá de la comparación de p50 de arriba.
