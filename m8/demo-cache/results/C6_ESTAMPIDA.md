# C6. Estampida al expirar una clave caliente

Medido el 2026-10-22. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores: postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2); Redis server v=8.10.2; Valkey server v=9.1.2.

Dos instancias de la API (cada una con un pool de 10 conexiones a Postgres) y Redis compartido. Sin índice: recalcular el resumen cuesta una consulta de ~40-50 ms en reposo.
TTL de la clave caliente: 1000 ms. Las peticiones se reparten por igual entre las dos instancias. Cada cifra es la mediana de 3 repeticiones.

## A) Ráfaga: 200 peticiones simultáneas a la misma clave en el momento de expirar

Momento de la ráfaga: `none`, `singleflight` y `lock`, 50 ms después de que la clave venció (ya no está). `swr`, 50 ms después del vencimiento lógico (la clave sigue, con el valor viejo). `xfetch`, 100 ms *antes* del vencimiento (después ya no hay valor y se comporta como `none`).

| Defensa | Consultas a Postgres | p50 de la ráfaga (ms) | Máx. de la ráfaga (ms) | Respuestas con valor viejo |
|---|---:|---:|---:|---:|
| Sin defensa | 200 (200–200) | 1286.1 | 2432.6 | 0 |
| Single-flight por proceso | 2 (2–2) | 57.6 | 60.8 | 0 |
| Candado distribuido (SET NX PX) | 1 (1–1) | 58.3 | 67.6 | 0 |
| Refresco anticipado probabilístico (XFetch) | 50 (34–75) | 30.6 | 658.0 | 0 |
| TTL lógico + refresco en 2.º plano (stale-while-revalidate) | 1 (1–1) | 43.1 | 46.3 | 200 |

## B) Carga sostenida: 100 trabajadores en bucle cerrado sobre la misma clave durante 10 s (TTL 1000 ms)

| Defensa | Consultas a Postgres | Consultas por vencimiento (aprox.) | Pet/s | p50 (ms) | p99 (ms) | Máx. (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Sin defensa | 400 | 40.0 | 3161 | 21.3 | 410.2 | 1397.0 |
| Single-flight por proceso | 18 | 1.8 | 3311 | 32.8 | 51.1 | 64.8 |
| Candado distribuido (SET NX PX) | 9 | 0.9 | 3043 | 33.4 | 59.0 | 91.7 |
| Refresco anticipado probabilístico (XFetch) | 47 | 4.7 | 3336 | 30.8 | 45.7 | 233.7 |
| TTL lógico + refresco en 2.º plano (stale-while-revalidate) | 10 | 1.0 | 3014 | 34.3 | 47.9 | 56.5 |

"Consultas por vencimiento" divide el total entre 10 vencimientos (10 s / TTL). Con `xfetch` y `swr` la clave casi nunca llega a vencer: el número muestra cuántas veces se recalculó.

## C) 100 claves distintas cargadas a la vez, TTL de 5 s fijo frente a TTL con jitter de ±50 %

Las 100 claves se cargan juntas en el segundo 1 (como tras un despliegue o un reinicio de la caché); después 50 trabajadores piden claves al azar (uniforme entre 100) hasta el segundo 16. Las dos filas usan además el candado distribuido, para que cada clave que vence cueste una sola consulta y se vea solo el efecto de que venzan muchas claves *distintas* a la vez. Consultas a Postgres en cada segundo (suma de las dos instancias; el segundo 1 incluye la carga inicial):

| TTL | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | Máx./s (desde el s 2) | p99 (ms) | Máx. (ms) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| fijo 5 s | 100 | 0 | 0 | 0 | 0 | 75 | 26 | 0 | 0 | 0 | 57 | 44 | 0 | 0 | 0 | 38 | 75 | 112.1 | 377.7 |
| 5 s ± 50 % | 100 | 0 | 1 | 17 | 15 | 16 | 30 | 26 | 12 | 17 | 21 | 22 | 20 | 20 | 21 | 11 | 30 | 48.3 | 168.2 |

