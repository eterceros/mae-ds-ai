# Q1-Q2. Doble escritura frente a outbox transaccional

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores (Docker Desktop, WSL2): PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2); RabbitMQ 4.4.0 (Erlang 29.1.2).

Cada corrida: 1000 pedidos enviados de uno en uno a `POST /orders` (API en Node, en el anfitrión). La API se mata a sí misma (`SIGKILL`, sin limpieza) en el punto crítico de los pedidos 100, 200, …, 1000: 10 muertes por corrida; un supervisor la vuelve a levantar. En Q2 hay además dos relays (lotes de 20) que se matan cada 3 lotes **después** de recibir la confirmación del broker y **antes** del `COMMIT` que marca las filas como publicadas. Código: Q1 = `src/antes/api.ts` (`DUAL_ORDER=commit-first` / `publish-first`), Q2 = `src/despues/api.ts` + `src/despues/relay.ts` (la medición se hizo con la misma lógica antes de separar el código en `antes/` y `despues/`). Una cola de auditoría (quorum) recibe una copia de cada evento `order.created`; al final se cruza con la tabla `orders`.

- **Perdidos**: pedidos guardados en Postgres sin ningún evento.
- **Fantasma**: eventos publicados de un pedido que no existe (se hizo `ROLLBACK` o nunca llegó el `COMMIT`).
- **Duplicados**: copias extra del mismo `eventId`.

| Variante | Corrida | Pedidos en BD | Errores vistos por el cliente | Eventos | Perdidos | Fantasma | Duplicados | Muertes API / relays |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Q1a doble escritura: COMMIT y luego publish | 1 | 1000 | 10 | 990 | **10** | **0** | **0** | 10 / 0 |
| Q1a doble escritura: COMMIT y luego publish | 2 | 1000 | 10 | 990 | **10** | **0** | **0** | 10 / 0 |
| Q1a doble escritura: COMMIT y luego publish | 3 | 1000 | 10 | 990 | **10** | **0** | **0** | 10 / 0 |
| Q1b doble escritura: publish y luego COMMIT | 1 | 990 | 10 | 1000 | **0** | **10** | **0** | 10 / 0 |
| Q1b doble escritura: publish y luego COMMIT | 2 | 990 | 10 | 1000 | **0** | **10** | **0** | 10 / 0 |
| Q1b doble escritura: publish y luego COMMIT | 3 | 990 | 10 | 1000 | **0** | **10** | **0** | 10 / 0 |
| Q2 outbox + 2 relays (`SKIP LOCKED`) que mueren cada 3 lotes | 1 | 1000 | 10 | 1144 | **0** | **0** | **144** | 10 / 75 |
| Q2 outbox + 2 relays (`SKIP LOCKED`) que mueren cada 3 lotes | 2 | 1000 | 10 | 1142 | **0** | **0** | **142** | 10 / 82 |
| Q2 outbox + 2 relays (`SKIP LOCKED`) que mueren cada 3 lotes | 3 | 1000 | 10 | 1172 | **0** | **0** | **172** | 10 / 74 |
| Q2 control: outbox + 2 relays (`SKIP LOCKED`) sin muertes de relay | 1 | 1000 | 10 | 1000 | **0** | **0** | **0** | 10 / 0 |
| Q2 control: outbox + 2 relays (`SKIP LOCKED`) sin muertes de relay | 2 | 1000 | 10 | 1000 | **0** | **0** | **0** | 10 / 0 |
| Q2 control: outbox + 2 relays (`SKIP LOCKED`) sin muertes de relay | 3 | 1000 | 10 | 1000 | **0** | **0** | **0** | 10 / 0 |
| Q2 control: outbox + 2 relays **sin** `FOR UPDATE SKIP LOCKED`, sin muertes de relay | 1 | 1000 | 10 | 1755 | **0** | **0** | **755** | 10 / 0 |
| Q2 control: outbox + 2 relays **sin** `FOR UPDATE SKIP LOCKED`, sin muertes de relay | 2 | 1000 | 10 | 1762 | **0** | **0** | **762** | 10 / 0 |
| Q2 control: outbox + 2 relays **sin** `FOR UPDATE SKIP LOCKED`, sin muertes de relay | 3 | 1000 | 10 | 1738 | **0** | **0** | **738** | 10 / 0 |

Pedidos perdidos en Q1a (primera corrida): 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000. Son exactamente los pedidos en los que la API murió entre el `COMMIT` y el `publish`.

Reparto de eventos entre relays en Q2 (por corrida): {"relay-2":470,"relay-1":674}; {"relay-2":481,"relay-1":661}; {"relay-1":554,"relay-2":618}. Los dos trabajan a la vez; `FOR UPDATE SKIP LOCKED` hace que cada uno se salte las filas bloqueadas por el otro, así que los duplicados vienen de las muertes entre publicar y `COMMIT` (cada muerte reenvía su lote completo, como máximo 20). Los dos controles lo confirman: con los mismos dos relays **sin muertes** hubo 0, 0, 0 duplicados; **sin** `FOR UPDATE SKIP LOCKED` y sin muertes, 755, 762, 738 (los dos relays leen las mismas filas pendientes y las publican los dos).

Por qué:

- **Q1a**: el pedido ya está confirmado en Postgres cuando el proceso muere; el `publish` nunca ocurre y nadie lo reintenta. El cliente recibió un error, pero el pedido existe: se pierde el evento, no el pedido.
- **Q1b**: el broker ya tiene el mensaje cuando el proceso muere; Postgres deshace la transacción abierta al cerrarse la conexión. Hay un evento de un pedido que no existe.
- **Q2**: el pedido y su evento son dos filas de la misma transacción: o están las dos o ninguna. El relay publica después; si muere tras publicar y antes de marcar, la fila sigue pendiente y se vuelve a publicar. Cero perdidos, cero fantasma, algunos duplicados: «al menos una vez». Los duplicados los resuelve el consumidor (Q4).
