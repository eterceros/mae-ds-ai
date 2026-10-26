# OB y OC: la traza a través de la outbox y la cola, y los logs con trace id

Generado por `scripts/ob-oc.ts` el 2026-10-26T10:10:43.363Z. Docker 29.9.2, Compose 5.6.0; 20 CPU y 33499774976 B de RAM en la VM.
100 pedidos por corrida y variante (5 a la vez), cada uno con un traceparent propio; 3 corrida(s), alternadas.
**antes** = `src/antes/` con la auto-instrumentación encendida (`ANTES_NODE_OPTIONS`); **despues** = `src/despues/`.

## OB: ¿llega la traza al worker?

| variante | corrida | pedidos | confirmados por el worker | trazas API → relay → worker completas | con el span del relay | worker en OTRA traza | trazas nuevas que empiezan en el relay | spans por traza (mediana) |
|---|---|---|---|---|---|---|---|---|
| antes | 1 | 100 | 100 | 0 de 100 | 0 | 100 | 100 | 12 |
| despues | 1 | 100 | 100 | 100 de 100 | 100 | 0 | 0 | 14 |
| antes | 2 | 100 | 100 | 0 de 100 | 0 | 100 | 100 | 12 |
| despues | 2 | 100 | 100 | 100 de 100 | 100 | 0 | 0 | 14 |
| antes | 3 | 100 | 100 | 0 de 100 | 0 | 100 | 100 | 12 |
| despues | 3 | 100 | 100 | 100 de 100 | 100 | 0 | 0 | 14 |

## OC: ¿qué trace id queda en los logs?

| variante | corrida | log de la API con trace id | log API = traza real | log del worker con trace id | log worker = traza de la API | en Loki (API / worker), buscando por trace id |
|---|---|---|---|---|---|---|
| antes | 1 | 100 de 100 | 100 de 100 | 100 de 100 | 0 de 100 | 0 / 0 (0 líneas de "antes" en Loki) |
| despues | 1 | 100 de 100 | 100 de 100 | 100 de 100 | 100 de 100 | 100 / 100 de 100 |
| antes | 2 | 100 de 100 | 100 de 100 | 100 de 100 | 0 de 100 | 0 / 0 (0 líneas de "antes" en Loki) |
| despues | 2 | 100 de 100 | 100 de 100 | 100 de 100 | 100 de 100 | 100 / 100 de 100 |
| antes | 3 | 100 de 100 | 100 de 100 | 100 de 100 | 0 de 100 | 0 / 0 (0 líneas de "antes" en Loki) |
| despues | 3 | 100 de 100 | 100 de 100 | 100 de 100 | 100 de 100 | 100 / 100 de 100 |

«= traza real» / «= traza de la API»: el trace id del log es el mismo con que se envió el pedido (el de la traza de la API en Tempo).

## Capturas (corrida 1)

### antes

Pedido `4f4b69d3-3a8d-453a-9601-7e1c07fe1a61`, enviado con trace-id `344716af52870a089ac5a76a84ba0643`.

Traza `344716af52870a089ac5a76a84ba0643` (12 spans):

```
api      SERVER   POST /pedidos                            +    0.0 ms     53.8 ms  span 29533cff3cf859b4  (padre afd5294323ad2849 NO está en la traza)
  api      INTERNAL middleware - <anonymous>               +    0.0 ms      0.1 ms  span 7f8e7ad4f21fe162
  api      INTERNAL middleware - jsonParser                +    1.0 ms      0.5 ms  span 1579873126b4e583
  api      INTERNAL middleware - urlencodedParser          +    1.0 ms      0.1 ms  span 63149aa18869a59b
  api      INTERNAL request handler - /pedidos             +    2.0 ms     52.3 ms  span f4b6ce3fc022cd79
    api      CLIENT   GET                                  +    3.0 ms     22.7 ms  span fb05539fca0aa9e2
      precios  SERVER   GET                                +   19.0 ms      2.6 ms  span c6debc210c4d7e9b
    api      CLIENT   pg-pool.connect                      +   30.0 ms      1.0 ms  span fea89d48a28a8a7a
    api      CLIENT   pg.query:BEGIN pedidos               +   31.0 ms     11.1 ms  span 5adfc60d5afdbf45
    api      CLIENT   pg.query:INSERT pedidos              +   43.0 ms      2.7 ms  span 119e0c9d7e448ea7
    api      CLIENT   pg.query:INSERT pedidos              +   45.0 ms      1.6 ms  span ed0bbb055a0a7d92
    api      CLIENT   pg.query:COMMIT pedidos              +   47.0 ms      4.2 ms  span 72e11d8b524e8af5
```

El span del worker quedó en OTRA traza, `8a725ca8be7e0d223e3e5614d7dc86af` (2 spans), que empieza en el relay:

```
relay    PRODUCER publish <default>                        +    0.0 ms     15.8 ms  span 7b194152a5000aad
  worker   CONSUMER pedidos.antes process                  +   18.0 ms     22.3 ms  span 168e6ca479793334
```

Logs de ese pedido:

```
pedido 4f4b69d3-3a8d-453a-9601-7e1c07fe1a61 creado (trace 344716af52870a089ac5a76a84ba0643)
confirmado pedido 4f4b69d3-3a8d-453a-9601-7e1c07fe1a61 (trace 8a725ca8be7e0d223e3e5614d7dc86af)
```


### despues

Pedido `b03304e7-d46f-4c90-86b1-dc5c09ec4783`, enviado con trace-id `d3dbb13c56dd63a40c21b1093ea2923f`.

Traza `d3dbb13c56dd63a40c21b1093ea2923f` (15 spans):

```
api      SERVER   POST /pedidos                            +    0.0 ms     42.1 ms  span e2548df3ae025d48  (padre 1a8c3166bd0697a1 NO está en la traza)
  api      INTERNAL middleware - <anonymous>               +    0.0 ms      0.0 ms  span 371baaf6f8a3fac3
  api      INTERNAL middleware - jsonParser                +    0.0 ms      0.1 ms  span ab2de0c92c2220ff
  api      INTERNAL middleware - urlencodedParser          +    0.0 ms      0.0 ms  span 01ed6d0d09068e49
  api      INTERNAL request handler - /pedidos             +    0.0 ms     41.9 ms  span fcda81e88f240af5
    api      CLIENT   GET                                  +    0.0 ms      7.2 ms  span 332f1a816fb265a7
      precios  SERVER   GET                                +    3.0 ms      4.3 ms  span 3f6c6c5e35c1a645
    api      CLIENT   pg-pool.connect                      +    7.0 ms      6.6 ms  span afa7cb18cd0c7c2a
      api      CLIENT   pg.connect                         +    8.0 ms      6.4 ms  span 038770c29a5032a9
    api      CLIENT   pg.query:BEGIN pedidos               +   14.0 ms      0.6 ms  span fa5df9a72862e62d
    api      CLIENT   pg.query:INSERT pedidos              +   15.0 ms      1.5 ms  span 51bc7706195b2eab
    api      CLIENT   pg.query:INSERT pedidos              +   16.0 ms      0.5 ms  span 6ada6f7f1a33965d
    api      CLIENT   pg.query:COMMIT pedidos              +   17.0 ms     24.2 ms  span c0bf5dddea97c1da
    relay    PRODUCER publish <default>                    +   59.0 ms     54.0 ms  span 049875cad5864a27
      worker   CONSUMER pedidos.despues process            +  114.0 ms     20.8 ms  span 0effda6909fc5683
```


Logs de ese pedido:

```
{"level":30,"time":1793009286757,"service":"api","trace_id":"d3dbb13c56dd63a40c21b1093ea2923f","span_id":"fcda81e88f240af5","trace_flags":"01","pedido":"b03304e7-d46f-4c90-86b1-dc5c09ec4783","sku":"sku-2","totalCents":1685,"msg":"pedido creado"}
{"level":30,"time":1793009286850,"service":"worker","trace_id":"d3dbb13c56dd63a40c21b1093ea2923f","span_id":"0effda6909fc5683","trace_flags":"01","pedido":"b03304e7-d46f-4c90-86b1-dc5c09ec4783","msg":"pedido confirmado"}
```


## Sin el gancho ESM

20 pedidos a la API de despues arrancada con `NODE_OPTIONS=--import @opentelemetry/auto-instrumentations-node/register` (sin `--experimental-loader`).

| instrumentación (scope) | spans de la API en las 20 trazas |
|---|---|
| `@opentelemetry/instrumentation-http` | 20 |
| `@opentelemetry/instrumentation-pg` | 101 |
| `@opentelemetry/instrumentation-undici` | 20 |

Nombre del span SERVER: `POST`. Logs de pino con trace_id: 0 de 20.
