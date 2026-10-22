# C7. Datos obsoletos: TTL frente a invalidar al escribir

Medido el 2026-10-22. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores: postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2); Redis server v=8.10.2; Valkey server v=9.1.2.

Ventana de datos obsoletos = tiempo desde que la escritura respondió hasta que una lectura (una cada 10 ms) devuelve el resumen con el pedido nuevo. Incluye lo que tarda esa lectura: si la clave se borró, la primera lectura recalcula (~40 ms) y ya trae el dato nuevo. Redis, TTL 5 s, sin índice (recalcular cuesta ~40 ms). 10 intentos por modo, cada uno sobre un producto distinto.

| Modo | Mín. (ms) | Mediana (ms) | Máx. (ms) | Intentos con más de 1 s obsoleto | Lecturas con el valor viejo (total) |
|---|---:|---:|---:|---:|---:|
| 1) Solo TTL (5 s), escritura en un momento al azar | 496 | 2063 | 4609 | 9 de 10 | 1469 |
| 2) Invalidar al escribir (DEL después del commit) | 36 | 38 | 44 | 0 de 10 | 0 |
| 3) Invalidar al escribir, con una lectura lenta en vuelo (carrera) | 40 | 5064 | 5082 | 9 de 10 | 2901 |
| 4) Igual que 3, con doble borrado (otro DEL a los 300 ms) | 336 | 345 | 352 | 0 de 10 | 184 |

Los pedidos de prueba se marcan con `note = 'demo-c7'`; `npm run seed` deja la base como al principio.
