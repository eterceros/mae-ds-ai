# Resultados de la demo de mensajería (Q1-Q8)

Medido el 24 de octubre de 2026 en un portátil: Intel Core i9-12900H (20 hilos lógicos), 64 GB de RAM, Windows 11 (10.0.26200), Docker Desktop 4.96.1 (motor 29.9.2, WSL2, 20 CPU y 31 GB asignados), Compose 5.6.0. Postgres 17.11, RabbitMQ 4.4.0 (Erlang 29.1.2), Node 24.19.0, amqplib 2.2.0, pg 8.23.1, openai 7.43.0. LLM: Docker Model Runner v1.2.6 con llama.cpp b9879 **en CPU**, modelo `ai/smollm2` (361.82 M parámetros, 256 MiB). k6 2.3.0. AsyncAPI CLI 6.2.1.

Las tablas completas, corrida por corrida, están en los demás archivos de esta carpeta. Cada escenario se corrió 3 veces. Los escenarios que cuentan mensajes (Q1-Q5) dan conteos exactos, no estimaciones: cada evento lleva un `eventId` y una cola de auditoría recibe una copia de todo lo publicado. El código de cada caso está en `src/antes/` (mala práctica) o `src/despues/` (corregido); [`DIFERENCIAS.md`](../DIFERENCIAS.md) los cruza línea por línea.

## Resumen

| Escenario | Qué se hizo | Resultado (3 corridas) |
|---|---|---|
| **Q1a** doble escritura, `COMMIT` → `publish` | 1000 pedidos, la API muere 10 veces entre los dos pasos | **10 eventos perdidos** cada vez; son justo los pedidos 100, 200, …, 1000 |
| **Q1b** doble escritura, `publish` → `COMMIT` | ídem, muere entre `publish` y `COMMIT` | **10 eventos fantasma** (de pedidos que no existen) cada vez |
| **Q2** outbox + 2 relays `SKIP LOCKED` | ídem, y los relays mueren cada 3 lotes entre publicar y `COMMIT` (74-82 muertes) | **0 perdidos, 0 fantasma**; 144, 142 y 172 duplicados |
| Q2, control sin muertes de relay | | 0 duplicados |
| Q2, control sin `FOR UPDATE SKIP LOCKED` | | 755, 762 y 738 duplicados por cada 1000 |
| **Q3** consumidor sin idempotencia | Cadena completa; relays y worker mueren (20-24 muertes del worker después del efecto y antes del ack) | **407, 296 y 314 envíos duplicados** por cada 1000 pedidos |
| **Q4** tabla de procesados | Las mismas caídas | **0 duplicados**, 0 pedidos sin envío |
| **Q5** venenoso, `reject(requeue=true)`, límite 3 | 1 venenoso entre 50 buenos | 4 intentos y a la DLQ (`delivery_limit`) en 64-79 ms; 50/50 buenos procesados |
| Q5, `nack(requeue=true)` | | 1618-3057 intentos en 10 s (quorum), 8467-9428 (classic); **nunca llega a la DLQ** |
| Q5, `nack(requeue=false)` | | 1 intento y a la DLQ (`rejected`) |
| **Q6** retardo 1/2/3 s | 20 mensajes que fallan 3 veces | Nativo `x-delayed-retry-*`: +3 a +26 ms; `x-opt-delivery-time`: −1 a +7 ms; DLX + TTL: +9 a +17 ms (medianas) |
| Q6, cabeza de cola | A (5 s) delante de B (1 s) | TTL por mensaje: **B sale a los 5013-5051 ms**, detrás de A. `x-opt-delivery-time`: B a los 999-1005 ms |
| **Q7** síncrono, 20 pet/s, 30 s | k6 contra el LLM local, plazo 10 s | **383-395 de ~476 con 504**; p95 10 s; el LLM tarda 37-73 s en volver a responder rápido |
| Q7 asíncrono, 20 pet/s, 30 s | `202` + cola + worker (prefetch 2) | 600/600 con 202 (mediana 3 ms); 600/600 hechos; petición→hecho mediana 32-37 s |
| Q7, matar el worker (10 pet/s) | `kill` (SIGKILL) del segundo 10 al 20 | 0 perdidos; 2 trabajos reprocesados por corrida; 0 en la DLQ |
| Q7, parar el worker | `stop` (SIGTERM) del segundo 10 al 20 | 0 perdidos; 0 reprocesados; «apagado limpio» en el log |
| **Q8** AsyncAPI 3.1 | CLI + `diff` + mensajes reales | Documento válido (código 0); roto → código 1; renombrar un campo obligatorio sale como 23 cambios *unclassified*, **0 breaking**; mensajes reales 200/200 válidos, con el campo renombrado 0/200 |
| `traceparent` | Q3-Q4 y Q7 | 100 % de los envíos y trabajos con el trace-id del cliente |

## Q1-Q2. Doble escritura frente a outbox ([detalle](Q1-Q2_OUTBOX.md))

**Mecanismo.** Postgres y RabbitMQ no comparten transacción. En Q1a el pedido ya está confirmado cuando el proceso muere; el `publish` no ocurre y nadie lo reintenta. Usar publisher confirms no ayuda: confirman lo que se publicó, no lo que nunca se llegó a publicar. En Q1b el broker ya tiene el mensaje y Postgres deshace la transacción abierta al cerrarse la conexión. En los dos casos el cliente recibió un error (10 de 1000), pero eso no le dice qué quedó hecho.

En Q2 el evento es una fila de la misma transacción que el pedido: o están las dos o ninguna. El relay publica después y marca la fila; si muere entre la confirmación del broker y su `COMMIT`, la fila sigue pendiente y se publica otra vez (todo el lote, hasta 20 mensajes). De ahí los duplicados: la outbox da **al menos una vez**, no exactamente una vez. Los controles separan las dos causas posibles: sin caídas, 0 duplicados; sin `FOR UPDATE SKIP LOCKED`, los dos relays leen las mismas filas pendientes y publican las dos copias (unos 750 duplicados por cada 1000 sin una sola caída).

## Q3-Q4. Idempotencia del consumidor ([detalle](Q3-Q4_IDEMPOTENCIA.md))

**Mecanismo.** Hay dos fuentes reales de copias: el relay que reenvía su lote y RabbitMQ que reentrega lo que no recibió ack cuando el worker muere. Con prefetch 20, al morir el worker vuelven a la cola el mensaje del punto crítico y los que estaban procesados pero aún sin ack. En Q3 cada copia repite el `INSERT`. En Q4 el worker inserta `(consumer, event_id)` en `processed_messages` dentro de la misma transacción que el envío: la copia choca con la clave primaria (`ON CONFLICT DO NOTHING` devuelve 0 filas), el worker no repite el efecto y solo hace ack. La clave es el `eventId` de la outbox: para RabbitMQ las copias del relay son mensajes distintos.

## Q5. Mensaje venenoso ([detalle](Q5_VENENOSO.md))

**Mecanismo.** Desde RabbitMQ 4.3 el límite de entregas de las quorum queues se cuenta con `delivery-count`, que **solo** sube con fallos: `basic.reject`, cierre del canal con mensajes pendientes o el resultado AMQP 1.0 `modified` con `delivery_failed=true` ([documentación](https://www.rabbitmq.com/docs/quorum-queues)). `basic.nack(requeue=true)` no lo incrementa, así que con `nack` el venenoso vuelve una y otra vez aunque la cola tenga `x-delivery-limit`. Con `reject(requeue=true)` se vio `x-delivery-count` ∅, 1, 2, 3 y al cuarto intento pasó a la DLQ con motivo `delivery_limit`. Las classic queues no tienen límite de entregas. En todos los casos los 50 buenos se procesaron: en estas colas un mensaje devuelto no bloquea a los demás.

## Q6. Reintento con retardo ([detalle](Q6_RETARDO.md))

Tres formas, las tres verificadas y funcionando en 4.4.0:

- **A. Retardo nativo de quorum queues** (desde 4.3): argumentos `x-delayed-retry-type` (`failed`), `x-delayed-retry-min` (1000) y `x-delayed-retry-max`; el consumidor hace `reject(requeue=true)` y la cola retiene el mensaje `min × delivery_count` ms. Retardo lineal, no exponencial.
- **B. `x-opt-delivery-time`** (4.4): cabecera AMQP 0-9-1 de tipo *long* con el instante (ms desde 1970) antes del cual no se entrega. El consumidor confirma el original y republica la copia con la hora. Según las notas de la versión, en AMQP 1.0 también se puede poner en el resultado `modified`; aquí solo se probó AMQP 0-9-1.
- **C. DLX + TTL**: una cola de espera por nivel de retardo, sin consumidores; al vencer el TTL el mensaje «muere» y su DLX lo devuelve a la cola principal.

Las tres cumplen el plan con un error de decenas de ms. La diferencia está en la **cabeza de cola**: una cola con TTL por mensaje solo expira mensajes desde el frente, así que el de 1 s espera detrás del de 5 s y sale a los 5 s, en classic y en quorum. Por eso el patrón C usa una cola por retardo. Con `x-opt-delivery-time` cada mensaje sale a su hora.

## Q7. E4: LLM síncrono frente a 202 + cola + worker ([detalle](Q7_E4_LLM.md))

**Mecanismo.** En la ruta síncrona cada petición espera al LLM con una conexión abierta. A 5 pet/s el LLM (en CPU) da abasto (p95 ~125 ms). A 10 pet/s ya no: la cola de espera crece dentro del servidor del LLM (p95 de 6,9 a 10 s; en una de las 3 corridas, 88 respuestas 504). A 20 pet/s, 383-395 de ~476 peticiones agotan el plazo de 10 s y k6 descarta 125 iteraciones porque no tenía un VU libre a tiempo (llegó a 175 VUs, todos esperando). Además, el LLM sigue ocupado 37-73 s después de terminar la carga: el `AbortSignal.timeout` corta la espera del cliente, pero el servidor del modelo sigue con las peticiones que ya tenía en cola (en una prueba exploratoria a 100 pet/s durante 15 s tardó unos 165 s en recuperarse).

En la ruta asíncrona la API solo escribe el encargo y su mensaje en una transacción y responde `202` en ~3 ms a cualquier ritmo. El worker con prefetch 2 decide cuánta carga recibe el LLM (unos 5-6 trabajos/s en esta máquina); el exceso espera en la cola, que es durable y se ve en la consola. El cliente consulta `GET /jobs/:id`. El costo es la latencia hasta el resultado: a 20 pet/s, mediana 32-37 s y máximo ~67 s, porque llegan más encargos de los que el worker termina.

**Matar el worker.** Con `kill` (SIGKILL) los mensajes sin ack vuelven a la cola; los 2 trabajos que estaban en vuelo se hacen otra vez (`attempts` = 2) y nada se pierde. Con `stop` (SIGTERM) el worker cancela el consumo, termina lo que tenía y cierra: 0 reprocesados. En los dos casos la API siguió respondiendo 202 a todo y la cola acumuló 54-90 mensajes mientras el worker estuvo caído.

## Q8. AsyncAPI 3.1 como contrato ([detalle](Q8_ASYNCAPI.md))

`asyncapi validate` acepta el documento y rechaza la variante rota con código de salida 1 (referencia `invalid-ref` a un canal inexistente), así que sirve como paso de CI. **`asyncapi diff` no detecta el cambio incompatible**: renombrar `amountCents` (obligatorio) a `amount` aparece como 23 cambios *unclassified* y 0 *breaking*, igual que añadir un campo opcional (13 *unclassified*). Por eso el contrato se verifica además contra los mensajes reales: Ajv con los esquemas del mismo `asyncapi.yaml` aceptó los 200 mensajes que publicó el relay y rechazó los 200 con el campo renombrado (`data must have required property 'amountCents'`). La clasificación del `diff` se puede ajustar con un archivo de reglas (`--overrides`); no se probó.

## Qué no se midió

- **Rendimiento máximo** de RabbitMQ, del relay o del worker: no es el objetivo (es tema del M12). Los pedidos de Q1-Q4 se envían de a uno para que cada caída se pueda atribuir a un pedido concreto; con peticiones concurrentes una caída se lleva también las que estaban en vuelo.
- **Varios nodos de RabbitMQ**: la quorum queue corre en un solo nodo, sin réplicas. No se probó qué pasa al caer un nodo (alta disponibilidad, M11/M13).
- **Apagado limpio fuera de contenedores**: en Windows un proceso de Node no recibe SIGTERM, así que el manejador solo se probó en el contenedor de Q7.
- **El LLM con GPU**: Model Runner usó el motor llama.cpp en CPU. Con GPU las cifras absolutas de Q7 cambian; el mecanismo (cola dentro del servidor del modelo frente a cola visible en el broker) es el mismo. `[por verificar]`: si Model Runner descarta las peticiones que el cliente abandona; lo medido es que siguió ocupado 37-73 s después de la carga.
- **AMQP 1.0** (`modified` con `x-opt-delivery-time`): solo se usó AMQP 0-9-1.
- **CDC (Debezium) o `LISTEN/NOTIFY`** en lugar del sondeo cada 50 ms del relay.
- Las cifras de Q5 con `nack(requeue=true)` (intentos en 10 s) dependen de la carga de la máquina: se midieron mientras otra prueba usaba la base y el broker. Lo que importa es que no hay límite, no el número.
- Las cifras de Q1-Q7 se midieron con la misma lógica que hoy está en `src/antes/` y `src/despues/`, antes de separar el código en esas carpetas; después de separarlo se repitió una corrida corta de Q1-Q4 (200 pedidos) y de Q7 (5 pet/s), que dio lo mismo: 2 perdidos y 2 fantasma por 2 caídas, 0 perdidos con outbox, 59 duplicados sin idempotencia y 0 con ella, 151/151 síncronos y asíncronos correctos, y al matar/parar el worker 2/0 reprocesados y 0 perdidos. Q5 y Q6 no usan esas carpetas (sus consumidores están en el propio script).
