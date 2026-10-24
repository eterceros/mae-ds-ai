# Q3-Q4. Consumidor sin idempotencia frente a tabla de procesados

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores (Docker Desktop, WSL2): PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2); RabbitMQ 4.4.0 (Erlang 29.1.2).

Cada corrida: 1000 pedidos por la API con outbox → 2 relays (lotes de 20, mueren cada 3 lotes entre publicar y `COMMIT`) → cola quorum `orders.created.shipping` → worker de envíos (prefetch 20, ack manual) que muere en los pedidos 50, 100, …, 1000 **después** de confirmar el envío en Postgres y **antes** del ack. Supervisor que reinicia cada proceso. El efecto es una fila en `shipments` (sin restricción `UNIQUE` a propósito). Código: Q3 = `src/antes/worker.ts`, Q4 = `src/despues/worker.ts`; API y relays de `src/despues/` (la medición se hizo con la misma lógica antes de separar el código en `antes/` y `despues/`).

Nota: la primera versión de esta tabla tenía una columna «mensajes que entraron a la cola» leída de las estadísticas de la consola de RabbitMQ; se quitó porque esas estadísticas se muestrean cada ~5 s y dieron valores imposibles (785 < 1000 en una corrida). El script actual cuenta las publicaciones en la cola de auditoría, que es exacto.

| Consumidor | Corrida | Envíos creados | Pedidos con envío | Envíos duplicados | Pedidos sin envío | Muertes relays / worker | `traceparent` con el trace-id del cliente |
|---|---:|---:|---:|---:|---:|---:|---:|
| Q3 sin idempotencia | 1 | 1407 | 1000 | **407** | 0 | 65 / 22 | 1407 / 1407 |
| Q3 sin idempotencia | 2 | 1296 | 1000 | **296** | 0 | 80 / 21 | 1296 / 1296 |
| Q3 sin idempotencia | 3 | 1314 | 1000 | **314** | 0 | 77 / 24 | 1314 / 1314 |
| Q4 tabla de procesados | 1 | 1000 | 1000 | **0** | 0 | 79 / 20 | 1000 / 1000 |
| Q4 tabla de procesados | 2 | 1000 | 1000 | **0** | 0 | 73 / 20 | 1000 / 1000 |
| Q4 tabla de procesados | 3 | 1000 | 1000 | **0** | 0 | 84 / 20 | 1000 / 1000 |

Por qué:

- **Q3**: cada copia de un mensaje (reenvío del relay o reentrega tras la muerte del worker) vuelve a ejecutar el `INSERT`. El efecto ya estaba confirmado en Postgres; lo que faltaba era el ack, y RabbitMQ no puede saber que el trabajo ya se hizo.
- **Q4**: el worker inserta `(consumer, event_id)` en `processed_messages` (clave primaria) **en la misma transacción** que el envío. Si la copia ya fue procesada, el `INSERT ... ON CONFLICT DO NOTHING` no inserta nada y el worker solo hace ack. Como las dos filas se confirman juntas, no existe un estado «envío hecho pero no registrado».
- La clave es el `eventId` que nace en la outbox, no el `deliveryTag` ni el `messageId` que genere el broker: las copias del relay son mensajes distintos para RabbitMQ pero el mismo evento.
- `traceparent`: viaja como cabecera HTTP → fila de la outbox → cabecera AMQP → worker. Cada salto conserva el trace-id y cambia el span-id.
