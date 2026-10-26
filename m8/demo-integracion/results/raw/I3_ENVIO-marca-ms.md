# I3. Enviar a un tercero con límite: ráfaga y reintento inmediato frente a Retry-After, backoff y concurrencia limitada

Medido el 2026-10-26. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 31 GB de RAM visibles, Linux 6.18.54.1-microsoft-standard-WSL2, Node v24.19.0. Los procesos de Node corren en un contenedor de la misma red de Compose que Postgres. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0); PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2).

El «tercero» ([`src/sim/third-party.ts`](../src/sim/third-party.ts)) acepta **50 pedidos/s** (cubeta de fichas, ráfaga de 50); por encima responde `429` con `Retry-After` en segundos; además, el 2 % de las peticiones que sí entran responden `503` (falla pasajera, sin registrar nada). Cada corrida envía **1000 pedidos** desde Postgres y, enseguida, hace una segunda pasada para ver si recupera lo que falló. 3 corridas por variante.

- **antes** = [`src/antes/sender.ts`](../src/antes/sender.ts): todo a la vez (`Promise.all`), hasta 3 reintentos inmediatos, marca de agua que avanza aunque haya fallos.
- **despues** = [`src/despues/sender.ts`](../src/despues/sender.ts): tabla `outbound` (outbox), 8 envíos a la vez, `Retry-After` compartido, backoff exponencial con jitter ante `503`, `Idempotency-Key`; un envío solo se marca enviado con un 2xx.
- **despues + ritmo propio** = lo mismo con `CLIENT_RPS=45` (un poco por debajo del límite del tercero).

| Variante | Corrida | Tiempo (s) | Peticiones | 429 | 503 | Recibidos por el tercero | **Perdidos** | 2.ª pasada: pedidos que toma | Recibidos tras la 2.ª | Pendientes en `outbound` | Pico aceptados/s | Duplicados en el tercero |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| antes | 1 | 1.9 | 3747 | 3624 | 2 | 121 | **879** | 578 | 189 | — (no hay registro) | 67 | 0 |
| antes | 2 | 1.4 | 3782 | 3680 | 2 | 100 | **900** | 110 | 134 | — (no hay registro) | 78 | 0 |
| antes | 3 | 1.6 | 3773 | 3662 | 3 | 108 | **892** | 381 | 148 | — (no hay registro) | 54 | 0 |
| despues | 1 | 22.2 | 1045 | 20 | 25 | 1000 | **0** | 0 | 1000 | 0 | 68 | 0 |
| despues | 2 | 22.3 | 1046 | 23 | 23 | 1000 | **0** | 0 | 1000 | 0 | 68 | 0 |
| despues | 3 | 22.0 | 1041 | 19 | 22 | 1000 | **0** | 0 | 1000 | 0 | 73 | 0 |
| despues + ritmo propio 45/s | 1 | 23.0 | 1020 | 0 | 20 | 1000 | **0** | 0 | 1000 | 0 | 46 | 0 |
| despues + ritmo propio 45/s | 2 | 22.7 | 1019 | 0 | 19 | 1000 | **0** | 0 | 1000 | 0 | 46 | 0 |
| despues + ritmo propio 45/s | 3 | 22.5 | 1012 | 0 | 12 | 1000 | **0** | 0 | 1000 | 0 | 46 | 0 |

## Medianas (rango entre corridas)

| Variante | Tiempo (s) | Peticiones | 429 | Perdidos | Perdidos tras la 2.ª pasada |
|---|---|---|---|---|---|
| antes | 1.6 (1.4-1.9) | 3773 (3747-3782) | 3662 (3624-3680) | **892 (879-900)** | 852 (811-866) |
| despues | 22.2 (22.0-22.3) | 1045 (1041-1046) | 20 (19-23) | **0 (0)** | 0 (0) |
| despues + ritmo propio 45/s | 22.7 (22.5-23.0) | 1019 (1012-1020) | 0 (0) | **0 (0)** | 0 (0) |

Tiempo mínimo teórico para 1000 pedidos a 50/s con una ráfaga inicial de 50: 19 s.
