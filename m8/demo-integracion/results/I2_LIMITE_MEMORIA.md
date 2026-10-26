# I2, complemento: importar 500.000 filas con el heap limitado

Medido el 2026-10-26. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 31 GB de RAM visibles, Linux 6.18.54.1-microsoft-standard-WSL2, Node v24.19.0. Los procesos de Node corren en un contenedor de la misma red de Compose que Postgres. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0); PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2).

Cada importador se ejecuta con `node --max-old-space-size=<MB>` (límite del heap «viejo» de V8). `antes` con `clientes-500000-validas.csv` (para que no aborte en la línea 38), `despues` con `clientes-500000.csv`. Tablas vacías antes de cada corrida. 3 corridas por caso.

| Límite (MB) | Importador | Corrida | Resultado | Tiempo (s) | RSS pico (MB) | Heap pico (MB) |
|---:|---|---:|---|---:|---:|---:|
| 64 | antes | 1 | **murió: JavaScript heap out of memory** (código null) | 0.4 | — | — |
| 64 | antes | 2 | **murió: JavaScript heap out of memory** (código null) | 0.4 | — | — |
| 64 | antes | 3 | **murió: JavaScript heap out of memory** (código null) | 0.3 | — | — |
| 64 | despues | 1 | terminó: 479997 insertadas, 15043 rechazadas | 12.0 | 202 | 59 |
| 64 | despues | 2 | terminó: 479997 insertadas, 15043 rechazadas | 14.5 | 201 | 59 |
| 64 | despues | 3 | terminó: 479997 insertadas, 15043 rechazadas | 14.4 | 201 | 59 |
| 32 | antes | 1 | **murió: JavaScript heap out of memory** (código null) | 0.3 | — | — |
| 32 | antes | 2 | **murió: JavaScript heap out of memory** (código null) | 0.3 | — | — |
| 32 | antes | 3 | **murió: JavaScript heap out of memory** (código null) | 0.3 | — | — |
| 32 | despues | 1 | terminó: 479997 insertadas, 15043 rechazadas | 14.2 | 193 | 59 |
| 32 | despues | 2 | terminó: 479997 insertadas, 15043 rechazadas | 12.7 | 194 | 59 |
| 32 | despues | 3 | terminó: 479997 insertadas, 15043 rechazadas | 13.0 | 194 | 59 |

Cuando el proceso muere no imprime sus cifras de memoria (— en la tabla); el tiempo es hasta la muerte. El «heap pico» de `despues` incluye basura que V8 aún no recolectó: lo que demuestra que la memoria viva está acotada es que termina con el límite más bajo.
