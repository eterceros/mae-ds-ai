# Q5. Mensaje venenoso y DLQ

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores (Docker Desktop, WSL2): PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2); RabbitMQ 4.4.0 (Erlang 29.1.2).

50 mensajes buenos y 1 venenoso (cuerpo que no es JSON) en la posición 26. Consumidor con prefetch 10 y ack manual; ante un fallo responde con la operación de la fila. Colas quorum con `x-delivery-limit: 3` y `x-dead-letter-exchange`; la classic solo con DLX (las classic no tienen límite de entregas). Se observa 10 s o hasta que el venenoso llega a la DLQ. 3 corridas por variante.

| Variante | Corrida | Intentos del venenoso | ¿Llegó a la DLQ? | Tiempo hasta la DLQ (ms) | Motivo (`x-first-death-reason`) | Buenos procesados | `x-delivery-count` visto en cada intento |
|---|---:|---:|---|---:|---|---:|---|
| quorum, `basic.reject(requeue=true)` | 1 | **4** | sí | 78 | delivery_limit | 50 / 50 | ∅, 1, 2, 3 |
| quorum, `basic.reject(requeue=true)` | 2 | **4** | sí | 79 | delivery_limit | 50 / 50 | ∅, 1, 2, 3 |
| quorum, `basic.reject(requeue=true)` | 3 | **4** | sí | 64 | delivery_limit | 50 / 50 | ∅, 1, 2, 3 |
| quorum, `basic.nack(requeue=true)` | 1 | **1618** | no (en 10 s) | - | - | 50 / 50 | ∅, ∅, ∅, ∅, ∅, ∅, ∅, ∅, … |
| quorum, `basic.nack(requeue=true)` | 2 | **2977** | no (en 10 s) | - | - | 50 / 50 | ∅, ∅, ∅, ∅, ∅, ∅, ∅, ∅, … |
| quorum, `basic.nack(requeue=true)` | 3 | **3057** | no (en 10 s) | - | - | 50 / 50 | ∅, ∅, ∅, ∅, ∅, ∅, ∅, ∅, … |
| quorum, `basic.nack(requeue=false)` | 1 | **1** | sí | 79 | rejected | 50 / 50 | ∅ |
| quorum, `basic.nack(requeue=false)` | 2 | **1** | sí | 63 | rejected | 50 / 50 | ∅ |
| quorum, `basic.nack(requeue=false)` | 3 | **1** | sí | 64 | rejected | 50 / 50 | ∅ |
| classic, `basic.nack(requeue=true)` | 1 | **9428** | no (en 10 s) | - | - | 50 / 50 | ∅, ∅, ∅, ∅, ∅, ∅, ∅, ∅, … |
| classic, `basic.nack(requeue=true)` | 2 | **8467** | no (en 10 s) | - | - | 50 / 50 | ∅, ∅, ∅, ∅, ∅, ∅, ∅, ∅, … |
| classic, `basic.nack(requeue=true)` | 3 | **8881** | no (en 10 s) | - | - | 50 / 50 | ∅, ∅, ∅, ∅, ∅, ∅, ∅, ∅, … |

Lectura: ver la sección Q5 de [ESCENARIOS.md](ESCENARIOS.md).
