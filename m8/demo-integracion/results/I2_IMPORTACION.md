# I2. Carga por lotes: todo en memoria y fila por fila frente a streaming + validación + upsert idempotente

Medido el 2026-10-26. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 31 GB de RAM visibles, Linux 6.18.54.1-microsoft-standard-WSL2, Node v24.19.0. Los procesos de Node corren en un contenedor de la misma red de Compose que Postgres. Docker Desktop con WSL2 (motor 29.9.2, Compose 5.6.0); PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2).

Archivos generados con [`scripts/gen-csv.ts`](../scripts/gen-csv.ts), semilla 42 (columnas `external_id,email,full_name,country,amount_cents,signup_date`). El «sucio» tiene ~3 % de filas inválidas de 7 tipos y ~1 % de filas duplicadas (copia exacta de una fila válida anterior); el de «válidas» son las mismas filas sin las inválidas (con las duplicadas). 3 corridas por caso; cada corrida empieza con las tablas vacías. Memoria: pico de RSS del proceso de Node (incluye ~50 MB de Node y del driver) y pico del heap de JavaScript.

- **antes** = [`src/antes/importer.ts`](../src/antes/importer.ts): `readFileSync` + `split` + un `INSERT` por fila, todo en una transacción, tabla sin clave natural.
- **despues** = [`src/despues/importer.ts`](../src/despues/importer.ts): lectura por partes, validación por fila, rechazados a CSV con motivo, lotes de 1000 a `customers_staging` y `INSERT … ON CONFLICT (external_id) DO UPDATE … WHERE … IS DISTINCT FROM` a `customers`, una transacción por lote.

## 50.000 filas

Contenido del archivo sucio (`clientes-50000.manifest.json`): 1428 inválidas (email_vacio 194, email_invalido 215, monto_no_numerico 225, monto_negativo 196, fecha_invalida 196, pais_desconocido 202, columnas_faltantes 200), 482 duplicadas, 48090 clientes distintos válidos. Archivo de válidas: 48572 filas.

### antes, archivo sucio

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Filas leídas | Falló en la línea | Error | Filas cargadas |
|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | 0.07 | 109 | 29 | 50000 | 38 | `null value in column "signup_date" of relation "customers_naive" viola` | **0** |
| 2 | 0.15 | 109 | 29 | 50000 | 38 | `null value in column "signup_date" of relation "customers_naive" viola` | **0** |
| 3 | 0.16 | 109 | 29 | 50000 | 38 | `null value in column "signup_date" of relation "customers_naive" viola` | **0** |

### antes, archivo de válidas

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Filas cargadas | Clientes distintos | 2.ª ejecución: tiempo (s) | 2.ª ejecución: filas en la tabla | 2.ª: clientes distintos |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7.7 | 168 | 66 | 48572 | 48090 | 7.9 | 97144 | 48090 |
| 2 | 6.6 | 168 | 66 | 48572 | 48090 | 7.1 | 97144 | 48090 |
| 3 | 7.0 | 169 | 66 | 48572 | 48090 | 7.7 | 97144 | 48090 |

### despues, archivo sucio (dos ejecuciones seguidas con el mismo archivo)

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Leídas | Rechazadas | Insertadas | Actualizadas | Sin cambios | Filas en `customers` | 2.ª: tiempo (s) | 2.ª: insertadas / actualizadas / sin cambios | 2.ª: filas | ¿2.ª tocó `updated_at`? |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| 1 | 1.5 | 141 | 40 | 50000 | 1428 | 48090 | 0 | 482 | 48090 | 1.0 | **0 / 0** / 48572 | 48090 | no |
| 2 | 1.2 | 138 | 36 | 50000 | 1428 | 48090 | 0 | 482 | 48090 | 1.3 | **0 / 0** / 48572 | 48090 | no |
| 3 | 1.3 | 138 | 39 | 50000 | 1428 | 48090 | 0 | 482 | 48090 | 1.0 | **0 / 0** / 48572 | 48090 | no |

Motivos de rechazo (corrida 1): se esperaban 6 columnas y hay 5: 200; amount_cents no es un entero: 225; email vacío: 194; email con formato inválido: 215; amount_cents negativo: 196; signup_date no es una fecha válida (AAAA-MM-DD): 196; country desconocido: 202.

### Medianas

| Caso | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Resultado |
|---|---:|---:|---:|---|
| antes, sucio | 0.15 | 109 | 29 | aborta en la línea 38: **0 filas cargadas** |
| antes, válidas | 7.0 | 168 | 66 | 48572 filas para 48090 clientes; la 2.ª ejecución deja 97144 |
| despues, sucio | 1.3 | 138 | 39 | 48090 insertadas, 1428 rechazadas; 2.ª ejecución: **0 cambios** (1.0 s) |

## 500.000 filas

Contenido del archivo sucio (`clientes-500000.manifest.json`): 15043 inválidas (email_vacio 2122, email_invalido 2097, monto_no_numerico 2153, monto_negativo 2208, fecha_invalida 2136, pais_desconocido 2191, columnas_faltantes 2136), 4960 duplicadas, 479997 clientes distintos válidos. Archivo de válidas: 484957 filas.

### antes, archivo sucio

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Filas leídas | Falló en la línea | Error | Filas cargadas |
|---:|---:|---:|---:|---:|---:|---|---:|
| 1 | 1.05 | 321 | 181 | 500000 | 38 | `null value in column "signup_date" of relation "customers_naive" viola` | **0** |
| 2 | 0.55 | 320 | 181 | 500000 | 38 | `null value in column "signup_date" of relation "customers_naive" viola` | **0** |
| 3 | 0.42 | 319 | 181 | 500000 | 38 | `null value in column "signup_date" of relation "customers_naive" viola` | **0** |

### antes, archivo de válidas

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Filas cargadas | Clientes distintos | 2.ª ejecución: tiempo (s) | 2.ª ejecución: filas en la tabla | 2.ª: clientes distintos |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 93.5 | 454 | 303 | 484957 | 479997 | no se corrió | — | — |
| 2 | 73.2 | 394 | 242 | 484957 | 479997 | no se corrió | — | — |
| 3 | 78.9 | 456 | 302 | 484957 | 479997 | no se corrió | — | — |

### despues, archivo sucio (dos ejecuciones seguidas con el mismo archivo)

| Corrida | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Leídas | Rechazadas | Insertadas | Actualizadas | Sin cambios | Filas en `customers` | 2.ª: tiempo (s) | 2.ª: insertadas / actualizadas / sin cambios | 2.ª: filas | ¿2.ª tocó `updated_at`? |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| 1 | 13.2 | 229 | 87 | 500000 | 15043 | 479997 | 0 | 4960 | 479997 | 17.6 | **0 / 0** / 484957 | 479997 | no |
| 2 | 10.9 | 230 | 90 | 500000 | 15043 | 479997 | 0 | 4960 | 479997 | 10.2 | **0 / 0** / 484957 | 479997 | no |
| 3 | 16.6 | 229 | 90 | 500000 | 15043 | 479997 | 0 | 4960 | 479997 | 12.0 | **0 / 0** / 484957 | 479997 | no |

Motivos de rechazo (corrida 1): se esperaban 6 columnas y hay 5: 2136; amount_cents no es un entero: 2153; email vacío: 2122; email con formato inválido: 2097; amount_cents negativo: 2208; signup_date no es una fecha válida (AAAA-MM-DD): 2136; country desconocido: 2191.

### Medianas

| Caso | Tiempo (s) | RSS pico (MB) | Heap pico (MB) | Resultado |
|---|---:|---:|---:|---|
| antes, sucio | 0.55 | 320 | 181 | aborta en la línea 38: **0 filas cargadas** |
| antes, válidas | 78.9 | 454 | 302 | 484957 filas para 479997 clientes |
| despues, sucio | 13.2 | 229 | 90 | 479997 insertadas, 15043 rechazadas; 2.ª ejecución: **0 cambios** (12.0 s) |

