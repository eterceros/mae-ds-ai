# I1. Webhook entrante: procesar dentro de la petición frente a firma + 202 + bandeja + worker idempotente

Medido el 2026-10-26. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 31 GB de RAM visibles, Linux 6.18.54.1-microsoft-standard-WSL2, Node v24.19.0. Los procesos de Node corren en un contenedor de la misma red de Compose que Postgres. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0); PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2).

Cada corrida: el proveedor simulado ([`src/sim/webhook-sender.ts`](../src/sim/webhook-sender.ts)) envía **200 eventos** `payment.succeeded` a 20/s, firmados al estilo Standard Webhooks, con un plazo de **2 s** por entrega; si no recibe un 2xx a tiempo, reenvía tras 1, 2, 4 y 8 s (hasta 5 intentos). Además, 1 de cada 10 eventos se entrega **dos veces aunque la primera haya ido bien** (los proveedores garantizan «al menos una vez»). A los 3 s, un atacante manda 20 entregas falsas (la mitad sin firma, la otra mitad firmadas con otro secreto) y 10 repeticiones de entregas válidas capturadas hace 10 minutos. El trabajo lento de cada evento (ERP, correo) se simula con una espera uniforme de 200-3000 ms, igual en las dos versiones. Efecto: una fila en `payments_ledger` (sin `UNIQUE`). 3 corridas por versión.

- **antes** = [`src/antes/webhook-receiver.ts`](../src/antes/webhook-receiver.ts): sin firma, trabajo dentro de la petición, sin idempotencia.
- **despues** = [`src/despues/webhook-receiver.ts`](../src/despues/webhook-receiver.ts) (firma HMAC en tiempo constante, ventana de 5 min, `webhook_inbox` con clave `webhook-id`, 202) + [`src/despues/webhook-worker.ts`](../src/despues/webhook-worker.ts) (Postgres como cola con `FOR UPDATE SKIP LOCKED`, 8 en paralelo, efecto idempotente).

| Versión | Corrida | Entregas del proveedor | Reenvíos por timeout | Entregas duplicadas a propósito | Timeouts (> 2 s) | Respuesta p50 / p95 / máx (ms) | Eventos con abono | Abonos duplicados | Falsos aceptados (2xx) | Abonos falsos | Repeticiones aceptadas | Sin entregar | Todo procesado (s) |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
| antes | 1 | 351 | **131** | 20 | 133 | 1149 / 1943 / 1996 | 200 / 200 | **161** | **20** / 20 | 20 | **10** / 10 | 2 | 38.9 |
| antes | 2 | 347 | **127** | 20 | 128 | 1138 / 1894 / 2001 | 200 / 200 | **157** | **20** / 20 | 20 | **10** / 10 | 1 | 39.7 |
| antes | 3 | 350 | **130** | 20 | 133 | 1118 / 1917 / 1993 | 200 / 200 | **160** | **20** / 20 | 20 | **10** / 10 | 3 | 39.0 |
| despues | 1 | 220 | **0** | 20 | 0 | 5 / 168 / 642 | 200 / 200 | **0** | **0** / 20 | 0 | **0** / 10 | 0 | 42.4 |
| despues | 2 | 220 | **0** | 20 | 0 | 5 / 9 / 38 | 200 / 200 | **0** | **0** / 20 | 0 | **0** / 10 | 0 | 40.7 |
| despues | 3 | 220 | **0** | 20 | 0 | 5 / 7 / 41 | 200 / 200 | **0** | **0** / 20 | 0 | **0** / 10 | 0 | 41.4 |

## Medianas (rango entre corridas)

| Versión | Reenvíos | Respuesta p50 / p95 (ms) | Abonos duplicados | Falsos aceptados | Repeticiones aceptadas | Todo procesado (s) |
|---|---|---|---|---:|---:|---:|
| antes | 130 (127-131) | 1138 / 1917 | 160 (157-161) | 20 | 10 | 39.0 |
| despues | 0 (0) | 5 / 9 | 0 (0) | 0 | 0 | 41.4 |

Respuestas del receptor al atacante (tipo:código), por corrida: antes → forged-unsigned:200 forged-wrong-key:200 replay:200; despues → forged-unsigned:401 forged-wrong-key:401 replay:401.

Notas de lectura:

- «Respuesta» son los tiempos de las entregas del proveedor que recibieron respuesta antes del plazo; las que no, cuentan en «Timeouts».
- En **antes**, el trabajo sigue aunque el proveedor ya abandonó la entrega: por eso cada timeout termina en un abono, y el reenvío en otro.
- En **despues**, «Todo procesado» incluye el tiempo que el worker tarda en vaciar la bandeja (200 eventos de 200-3000 ms con 8 en paralelo); el proveedor ya había terminado mucho antes (sin reenvíos por timeout).
