# C1-C5. Lecturas: sin caché, índice, ETag, Redis y Valkey

Medido el 2026-10-22. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores: postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2); Redis server v=8.10.2; Valkey server v=9.1.2.

Una instancia de la API (Fastify, pool de 10 conexiones a Postgres), cliente Node en la misma máquina, servidores en Docker.
Tabla `orders` con 3 millones de filas; productos elegidos con Zipf (s = 1) sobre 5000. Cada cifra es la mediana de 3 rondas; entre paréntesis, el rango.

- **Máx. pet/s:** bucle cerrado, 10 trabajadores, 2 s de calentamiento y 4 s medidos. Antes de cada variante se vacían las cachés (arranca en frío).
- **Latencia:** llegadas a ritmo fijo, común al grupo (40 % de lo que aguanta la variante más lenta), 8 s medidos; justo después de la prueba anterior (caché ya caliente).
- **Consultas a PG por 1000 pet.:** consultas del resumen (la costosa) + lecturas de versión (C3b), contadas por la API durante la prueba de máximo.
- **Aciertos:** proporción de peticiones servidas desde la caché (C4/C5) o respondidas con 304 (C3), en la prueba de máximo (arranca en frío) y en la de latencia (ya caliente).
- **Bytes/pet.:** bytes del cuerpo de la respuesta, en promedio (un 304 no lleva cuerpo).

## Sin índice en orders.product_id (C1, C3, C4, C5)

Ritmo común de la prueba de latencia: 26 pet/s.

| Variante | Máx. pet/s | p50 (ms) | p95 (ms) | p99 (ms) | Consultas a PG por 1000 pet. | Aciertos (máx. / latencia) | Bytes/pet. | Errores |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 sin caché (siempre a Postgres) | 71.0 (69.3–75.8) | 46.3 (44.6–48.0) | 57.0 (52.8–114.4) | 61.4 (56.6–137.8) | 1000 | - | 1258 | 0 |
| C3a ETag sobre el cuerpo (304 si no cambió) | 66.3 (60.3–72.8) | 47.5 (42.2–72.1) | 60.1 (56.8–98.5) | 75.7 (58.6–119.0) | 1000 | 39 % / 54 % | 769 | 0 |
| C3b ETag por versión del producto | 116.8 (116.5–122.3) | 2.7 (2.4–4.3) | 50.6 (48.1–59.1) | 55.5 (53.1–72.5) | 1554 | 45 % / 62 % | 697 | 0 |
| C4 Redis cache-aside, TTL 30 s | 130.3 (115.8–133.3) | 2.7 (2.2–2.8) | 51.4 (50.0–58.2) | 58.8 (52.5–63.3) | 549 | 45 % / 63 % | 1257 | 0 |
| C5 Valkey cache-aside, TTL 30 s | 128.5 (118.5–147.8) | 2.6 (2.3–3.0) | 57.0 (55.5–57.4) | 61.5 (61.1–67.6) | 551 | 45 % / 63 % | 1257 | 0 |

Plan de la consulta para un producto (`EXPLAIN (ANALYZE, BUFFERS)`, extracto):

```
->  Parallel Seq Scan on orders  (cost=0.00..52664.03 rows=248 width=14) (actual time=0.122..56.019 rows=188 loops=3)
Rows Removed by Filter: 999812
Execution Time: 61.832 ms
```

Índice creado en 1263 ms (con VACUUM ANALYZE para que el plan use *index-only scan*).

## Con índice (C2): CREATE INDEX ... ON orders (product_id) INCLUDE (created_at, amount)

Ritmo común de la prueba de latencia: 841 pet/s.

| Variante | Máx. pet/s | p50 (ms) | p95 (ms) | p99 (ms) | Consultas a PG por 1000 pet. | Aciertos (máx. / latencia) | Bytes/pet. | Errores |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C2 solo índice (siempre a Postgres) | 2323.5 (2258.8–2327.8) | 2.0 (2.0–2.0) | 3.4 (2.7–3.6) | 6.1 (3.6–6.8) | 1000 | - | 1257 | 0 |
| C2 + Redis cache-aside, TTL 30 s | 2396.8 (2316.0–2500.3) | 1.4 (1.4–1.5) | 4.0 (4.0–4.1) | 5.5 (5.3–5.6) | 190 | 81 % / 92 % | 1257 | 0 |

Plan de la consulta para un producto (`EXPLAIN (ANALYZE, BUFFERS)`, extracto):

```
->  Index Only Scan using orders_product_idx on orders  (cost=0.43..24.35 rows=596 width=14) (actual time=0.058..0.152 rows=563 loops=1)
Heap Fetches: 0
Execution Time: 0.320 ms
```

## Cómo se calienta la caché (C4, Redis, TTL 20 s, 60 pet/s fijas durante 60 s, sin índice)

| Tramo (s) | Aciertos | Consultas a PG en el tramo | p99 del tramo (ms) |
|---|---:|---:|---:|
| 0-5 | 37 % | 189 | 179.4 |
| 5-10 | 53 % | 142 | 134.4 |
| 10-15 | 60 % | 119 | 105.6 |
| 15-20 | 67 % | 100 | 82.7 |
| 20-25 | 62 % | 114 | 76.1 |
| 25-30 | 64 % | 109 | 70.3 |
| 30-35 | 59 % | 123 | 97.4 |
| 35-40 | 61 % | 117 | 75.7 |
| 40-45 | 62 % | 115 | 73.1 |
| 45-50 | 56 % | 132 | 81.0 |
| 50-55 | 63 % | 110 | 64.9 |
| 55-60 | 60 % | 121 | 68.9 |

Comprobación: la API contó 95074 consultas del resumen; `pg_stat_statements` registró 95074 (la diferencia, si la hay, son peticiones que quedaron en vuelo al terminar cada prueba).
