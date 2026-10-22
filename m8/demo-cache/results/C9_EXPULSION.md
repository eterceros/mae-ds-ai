# C9. maxmemory y política de expulsión

Medido el 2026-10-22. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Servidores: postgres (PostgreSQL) 17.11 (Debian 17.11-1.pgdg13+2); Redis server v=8.10.2; Valkey server v=9.1.2.

Cache-aside simulado contra el servidor: GET y, si falla, SET de un valor de 1000 bytes. 50000 claves posibles con Zipf (s = 1), 200000 peticiones, 50 en vuelo a la vez. `maxmemory 16mb` (alcanza para una fracción de las claves). Aciertos = sobre las peticiones de la carga Zipf, sin contar el primer cuarto (calentamiento).

## Carga A: solo Zipf

| Servidor | Política | Aciertos | Claves expulsadas | Claves en memoria | Memoria usada (MB) | Errores al escribir |
|---|---|---:|---:|---:|---:|---:|
| Redis | allkeys-lru | 84.0 % | 22531 | 14246 | 16.0 | 0 |
| Redis | allkeys-lfu | 84.9 % | 21077 | 14265 | 16.0 | 0 |
| Redis | allkeys-random | 81.7 % | 25930 | 14235 | 16.0 | 0 |
| Redis | noeviction | 84.2 % | 0 | 14311 | 16.0 | 22115 |
| Redis | sin límite | 89.3 % | 0 | 28793 | 30.8 | 0 |
| Valkey | allkeys-lru | 84.4 % | 21471 | 14670 | 16.0 | 0 |
| Valkey | allkeys-lfu | 85.2 % | 20224 | 14665 | 16.0 | 0 |
| Valkey | allkeys-random | 82.0 % | 24957 | 14670 | 16.0 | 0 |
| Valkey | noeviction | 84.5 % | 0 | 14697 | 16.0 | 21290 |
| Valkey | sin límite | 89.3 % | 0 | 28793 | 30.5 | 0 |

## Carga B: Zipf + barridos (10 000 claves de un solo uso cada 20 000 peticiones)

| Servidor | Política | Aciertos | Claves expulsadas | Claves en memoria | Memoria usada (MB) | Errores al escribir |
|---|---|---:|---:|---:|---:|---:|
| Redis | allkeys-lru | 71.8 % | 142912 | 14233 | 16.0 | 0 |
| Redis | allkeys-lfu | 80.0 % | 129611 | 14246 | 16.0 | 0 |
| Redis | allkeys-random | 70.0 % | 145546 | 14233 | 16.0 | 0 |
| Redis | noeviction | 75.3 % | 0 | 14323 | 16.0 | 136754 |
| Redis | sin límite | 89.5 % | 0 | 128793 | 132.8 | 0 |
| Valkey | allkeys-lru | 72.5 % | 141669 | 14648 | 16.0 | 0 |
| Valkey | allkeys-lfu | 79.8 % | 129656 | 14637 | 16.0 | 0 |
| Valkey | allkeys-random | 70.4 % | 144469 | 14647 | 16.0 | 0 |
| Valkey | noeviction | 75.3 % | 0 | 14692 | 16.0 | 136385 |
| Valkey | sin límite | 89.5 % | 0 | 128793 | 132.8 | 0 |

Con `noeviction` el servidor no expulsa: cuando se llena, rechaza las escrituras con `OOM command not allowed` y la caché se queda con lo que entró primero.
