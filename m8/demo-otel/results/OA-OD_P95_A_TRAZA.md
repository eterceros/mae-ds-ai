# OA y OD: del p95 de k6 a la traza más lenta

Generado por `scripts/oa-od.ts` el 2026-10-26T10:07:05.845Z. Docker 29.9.2, Compose 5.6.0; 20 CPU y 33499774976 B de RAM en la VM.
Carga: k6 2.3.0, 20 pedidos/s durante 30s (constant-arrival-rate), desde un contenedor de la misma red de Compose.
precios tarda 600 ms en 1 de cada 10 peticiones (y 2-5 ms en las demás). 3 corrida(s) por variante, alternadas.

## k6 (ms)

| variante | corrida | peticiones | no 201 | p50 | p90 | p95 | p99 | max | >= 300 ms |
|---|---|---|---|---|---|---|---|---|---|
| antes | 1 | 601 | 0 | 9.9 | 603.9 | 606.0 | 611.5 | 1091.8 | 68 |
| despues | 1 | 601 | 0 | 12.2 | 567.1 | 607.4 | 643.1 | 781.1 | 66 |
| antes | 2 | 600 | 0 | 10.7 | 605.4 | 678.4 | 1140.9 | 1627.8 | 98 |
| despues | 2 | 600 | 0 | 11.1 | 211.7 | 606.9 | 617.6 | 728.4 | 60 |
| antes | 3 | 601 | 0 | 9.1 | 92.7 | 605.1 | 608.7 | 658.5 | 60 |
| despues | 3 | 601 | 0 | 11.7 | 173.4 | 606.5 | 632.4 | 676.8 | 60 |

Medianas de las corridas: antes p50 9.9 / p95 606.0; despues p50 11.7 / p95 606.9.

## De la cifra a la traza (solo despues)

Consulta TraceQL, en la ventana de la prueba (inicio de k6 − 5 s, fin + 30 s), con el p95 de esa corrida como umbral:

```
{ resource.service.namespace = "despues" && resource.service.name = "api" && kind = server && duration >= <p95>ms }
```

| corrida | p95 k6 (ms) | peticiones k6 >= p95 | consulta >= p95 | búsqueda estable tras | todas de esta prueba | más lenta (Tempo) | ¿= la más lenta de k6? | precios >= 80 % del span de la API | parte de precios (mediana) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 607.4 | 31 | 29 trazas | ~40 s | sí | ff8df644679d0f1d4120964e76f8be95 (780.4 ms) | sí (781.1 ms en k6) | 28 de 29 | 97 % |
| 2 | 606.9 | 30 | 33 trazas | ~40 s | sí | c7ea139b12c15b417e93e6c0995e7845 (728.5 ms) | sí (728.4 ms en k6) | 33 de 33 | 99 % |
| 3 | 606.5 | 31 | 29 trazas | ~40 s | sí | 17fcf72537ae1bc864dc98b51be761eb (676.2 ms) | sí (676.8 ms en k6) | 29 de 29 | 98 % |

## La traza más lenta de cada corrida

### Corrida 1: traza ff8df644679d0f1d4120964e76f8be95

Span de la API 780.4 ms; spans en la traza: 14 (relay, worker, api, precios).

Camino crítico (desde POST /pedidos, bajando siempre por el hijo más largo):

1. `api` SERVER `POST /pedidos`: 780.4 ms (100 % del span de la API)
2. `api` INTERNAL `request handler - /pedidos`: 779.7 ms (100 % del span de la API)
3. `api` CLIENT `GET`: 601.2 ms (77 % del span de la API)
4. `precios` SERVER `GET`: 600.2 ms (77 % del span de la API)

```
api      SERVER   POST /pedidos                            +    0.0 ms    780.4 ms  span 75b400469ec14606  (padre d5d4988715cb6ec9 NO está en la traza)
  api      INTERNAL middleware - <anonymous>               +    0.0 ms      0.0 ms  span c16b6e54ec82a366
  api      INTERNAL middleware - jsonParser                +    0.0 ms      0.3 ms  span fd7d09a1307ff443
  api      INTERNAL middleware - urlencodedParser          +    1.0 ms      0.0 ms  span ddd8fa21465db157
  api      INTERNAL request handler - /pedidos             +    1.0 ms    779.7 ms  span 395f3145147780d6
    api      CLIENT   GET                                  +    1.0 ms    601.2 ms  span b6e15f375def83fe
      precios  SERVER   GET                                +    2.0 ms    600.2 ms  span 9085054dbf2c6f61
    api      CLIENT   pg-pool.connect                      +  603.0 ms      0.2 ms  span f39a37e97723ce09
    api      CLIENT   pg.query:BEGIN pedidos               +  603.0 ms      0.6 ms  span dfdd28b66ccd4d88
    api      CLIENT   pg.query:INSERT pedidos              +  604.0 ms      0.5 ms  span b95a921484a428a2
    api      CLIENT   pg.query:INSERT pedidos              +  604.0 ms      0.4 ms  span 23b0c83ce4b79c87
    api      CLIENT   pg.query:COMMIT pedidos              +  605.0 ms    175.2 ms  span 45d7c705fde8a4b9
    relay    PRODUCER publish <default>                    +  834.0 ms     38.4 ms  span 4e829e0812fe2e73
      worker   CONSUMER pedidos.despues process            +  872.0 ms     19.7 ms  span 13aaf10fd5a81b65
```

### Corrida 2: traza c7ea139b12c15b417e93e6c0995e7845

Span de la API 728.5 ms; spans en la traza: 14 (api, precios, relay, worker).

Camino crítico (desde POST /pedidos, bajando siempre por el hijo más largo):

1. `api` SERVER `POST /pedidos`: 728.5 ms (100 % del span de la API)
2. `api` INTERNAL `request handler - /pedidos`: 733.3 ms (101 % del span de la API)
3. `api` CLIENT `GET`: 601.1 ms (83 % del span de la API)
4. `precios` SERVER `GET`: 599.7 ms (82 % del span de la API)

```
api      SERVER   POST /pedidos                            +    0.0 ms    728.5 ms  span 7752757d4f5855f1  (padre 2c289851687699a6 NO está en la traza)
  api      INTERNAL middleware - <anonymous>               +    0.0 ms      0.0 ms  span 44d4aef96b8c28c0
  api      INTERNAL middleware - jsonParser                +    0.0 ms      0.1 ms  span b828f32ee121dc65
  api      INTERNAL middleware - urlencodedParser          +    0.0 ms      0.0 ms  span eb9d49654dd4448e
  api      INTERNAL request handler - /pedidos             +    0.0 ms    733.3 ms  span 38f67f3d076030e4
    api      CLIENT   GET                                  +    0.0 ms    601.1 ms  span 4dba42e4975c23bb
      precios  SERVER   GET                                +    0.0 ms    599.7 ms  span 886cd9ab75da7498
    api      CLIENT   pg-pool.connect                      +  601.0 ms      0.1 ms  span 8eda94fb0b0130fb
    api      CLIENT   pg.query:BEGIN pedidos               +  602.0 ms      0.4 ms  span 40e3d78a5e7a682b
    api      CLIENT   pg.query:INSERT pedidos              +  602.0 ms      0.4 ms  span 4eaf98a0d24c7585
    api      CLIENT   pg.query:INSERT pedidos              +  603.0 ms      0.4 ms  span e1ab90fa96775d4b
    api      CLIENT   pg.query:COMMIT pedidos              +  603.0 ms    123.6 ms  span e671512347ce8c6f
    relay    PRODUCER publish <default>                    +  765.0 ms      5.8 ms  span cbf2d7d36f7c8ee8
      worker   CONSUMER pedidos.despues process            +  771.0 ms     20.5 ms  span 27cf740a0ebb76c7
```

### Corrida 3: traza 17fcf72537ae1bc864dc98b51be761eb

Span de la API 676.2 ms; spans en la traza: 14 (api, relay, worker, precios).

Camino crítico (desde POST /pedidos, bajando siempre por el hijo más largo):

1. `api` SERVER `POST /pedidos`: 676.2 ms (100 % del span de la API)
2. `api` INTERNAL `request handler - /pedidos`: 675.8 ms (100 % del span de la API)
3. `api` CLIENT `GET`: 601.0 ms (89 % del span de la API)
4. `precios` SERVER `GET`: 600.5 ms (89 % del span de la API)

```
api      SERVER   POST /pedidos                            +    0.0 ms    676.2 ms  span e22f52c2ad5e1276  (padre e43a1f7283e6aaad NO está en la traza)
  api      INTERNAL middleware - <anonymous>               +    0.0 ms      0.0 ms  span 07ddb49170ff9bb4
  api      INTERNAL middleware - jsonParser                +    0.0 ms      0.2 ms  span 583c765e57a0dafe
  api      INTERNAL middleware - urlencodedParser          +    0.0 ms      0.0 ms  span bf9eaf60b1d3d8b3
  api      INTERNAL request handler - /pedidos             +    0.0 ms    675.8 ms  span 48c3a08d99d690c1
    api      CLIENT   GET                                  +    0.0 ms    601.0 ms  span bcb936db62c1c88f
      precios  SERVER   GET                                +    1.0 ms    600.5 ms  span cab5d4a5894a1ffb
    api      CLIENT   pg-pool.connect                      +  602.0 ms      0.1 ms  span 3752243b90bec674
    api      CLIENT   pg.query:BEGIN pedidos               +  602.0 ms      0.2 ms  span b522cc256c7bc893
    api      CLIENT   pg.query:INSERT pedidos              +  602.0 ms      0.3 ms  span a37ebcf4363ab3f2
    api      CLIENT   pg.query:INSERT pedidos              +  602.0 ms      0.2 ms  span 28304d7a804b713c
    api      CLIENT   pg.query:COMMIT pedidos              +  603.0 ms     72.9 ms  span dbe398e7ef82c968
    relay    PRODUCER publish <default>                    +  718.0 ms      2.3 ms  span 97a7aa3185d6a28b
      worker   CONSUMER pedidos.despues process            +  721.0 ms     20.4 ms  span f703be8552037dbd
```

