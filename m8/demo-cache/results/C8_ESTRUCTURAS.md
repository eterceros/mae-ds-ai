# C8. Estructuras: rate limiting y ranking

Medido el 2026-10-22. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores: postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2); Redis server v=8.10.2; Valkey server v=9.1.2.

## A) Rate limiting: 10 peticiones por segundo por cliente

### A1. Ráfaga en el borde: 10 peticiones 50 ms antes de que cambie el segundo y 10 peticiones 50 ms después

| Algoritmo | Aceptadas en el 1.er grupo | Aceptadas en el 2.º grupo | Aceptadas en ~100 ms (límite: 10 por s) |
|---|---:|---:|---:|
| Ventana fija (INCR + PEXPIRE) | 10, 10, 10 | 10, 10, 10 | 20, 20, 20 |
| Ventana deslizante (ZSET) | 10, 10, 10 | 0, 0, 0 | 10, 10, 10 |

Tres repeticiones por algoritmo (una cifra por repetición).

### A2. Un cliente que envía 50 peticiones por segundo durante 6 s

| Algoritmo | Aceptadas por segundo (promedio) | Máximo aceptado en cualquier ventana de 1 s | Rechazadas (429) |
|---|---:|---:|---:|
| Ventana fija (INCR + PEXPIRE) | 10.3 | 12 | 133 |
| Ventana deslizante (ZSET) | 10.0 | 10 | 135 |

### A3. Costo

| Algoritmo | p50 de la petición HTTP completa (ms) | p99 (ms) | Memoria por cliente (MEMORY USAGE, bytes) |
|---|---:|---:|---:|
| Ventana fija (INCR + PEXPIRE) | 1.0 | 2.1 | 39 (un contador) |
| Ventana deslizante (ZSET) | 1.0 | 2.2 | 680 (10 marcas de tiempo) |

2000 peticiones secuenciales, cada una de un cliente distinto (todas aceptadas). La memoria de la ventana deslizante crece con el límite: guarda una entrada por petición aceptada en la ventana. (Clave de ejemplo de la ventana fija: `rl:fixed:<cliente>:<segundo>`.)

## B) Ranking de los 10 productos con más ingresos (5000 productos, 3 millones de pedidos)

| Operación | p50 (ms) | p99 (ms) | Repeticiones |
|---|---:|---:|---:|
| SQL: `GROUP BY product_id ORDER BY sum(amount) DESC LIMIT 10` | 138.8 | 171.8 | 20 |
| Redis: `ZREVRANGE ranking 0 9 WITHSCORES` (top 10) | 0.7 | 2.0 | 2000 |
| Redis: `ZINCRBY` (registrar una venta) | 0.6 | 1.5 | 2000 |
| Redis: `ZREVRANK` (posición de un producto) | 0.6 | 1.6 | 2000 |
| Valkey: `ZREVRANGE ranking 0 9 WITHSCORES` (top 10) | 0.6 | 2.0 | 2000 |
| Valkey: `ZINCRBY` (registrar una venta) | 0.6 | 1.7 | 2000 |
| Valkey: `ZREVRANK` (posición de un producto) | 0.6 | 1.6 | 2000 |

Carga inicial del ZSET desde Postgres (una agregación de 136 ms y un *pipeline* de 5000 ZADD). Memoria del ZSET: Redis: 375330 bytes; Valkey: 273176 bytes. Top 10 por SQL: 2641, 1664, 702, 2620, 4704, 3534, 2083, 3518, 4179, 79.

Las latencias de Redis/Valkey incluyen el viaje de ida y vuelta desde Node (loopback a Docker); la del SQL incluye recorrer los 3 millones de filas cada vez.
