# Migraciones de esquema sin cortar el servicio (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 6

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni tokens de ningún servicio.

## Qué es

Un Postgres 17 en Docker con una tabla `pedidos` de **10 millones de filas** (≈1,2 GB con índices) y un **cliente de carga en Node** que se comporta como una aplicación: recibe 200 peticiones por segundo a ritmo fijo (70 % lecturas por id, 20 % `UPDATE` por id, 10 % `INSERT`) y las atiende con un pool de 20 conexiones. Mientras esa carga corre, se aplica una migración y se mide:

- qué **bloqueo de tabla** toma cada sentencia (leído de `pg_locks`);
- cuánto **dura** la migración;
- cuántas peticiones de la aplicación quedan **bloqueadas** (más de 100 ms), cuál fue la **pausa máxima** y cómo cambian **p50/p99** antes y durante.

Cada escenario tiene una versión **ingenua** (la que escribiría cualquiera, o la que genera un ORM o un asistente de IA) y una **segura**.

## Escenarios

| | Migración | Qué enseña |
|---|---|---|
| **M1** | `ADD COLUMN` anulable | Es instantánea, pero toma `AccessExclusiveLock` (importa en M8) |
| **M2** | `ADD COLUMN ... DEFAULT` constante frente a volátil | Desde Postgres 11 un default constante no reescribe la tabla; `gen_random_uuid()` sí |
| **M3** | `ALTER COLUMN id TYPE bigint` (clave primaria) | Reescribe tabla e índices con todo bloqueado; la vía segura tiene 8 pasos |
| **M4** | `CREATE INDEX` frente a `CONCURRENTLY` | El primero bloquea escrituras; el segundo no, a cambio de tardar más |
| **M5** | `SET NOT NULL` directo frente a `CHECK NOT VALID` + `VALIDATE` + `SET NOT NULL` | El recorrido de la tabla se hace con un bloqueo que no corta el tráfico |
| **M6** | FK directa frente a `NOT VALID` + `VALIDATE` | Igual que M5, para claves foráneas |
| **M7** | Relleno de una columna en un `UPDATE` frente a lotes (de 50 000, y de 5000 con pausa) | Un `UPDATE` gigante bloquea filas y agota el pool de la aplicación |
| **M8** | Transacción larga + `ALTER` instantáneo, sin y con `lock_timeout` | La **cola de bloqueos**: un `ALTER` de 5 ms puede tumbar el servicio |
| **M9** | Squawk sobre los `.sql` ingenuos y seguros | Qué detecta un linter de migraciones en CI y qué no |
| **M10** | Renombrar una columna con Prisma y con Flyway | Prisma genera `DROP` + `ADD` (pierde los datos); Flyway aplica lo que uno escribe |

El SQL exacto de cada variante está en [`scripts/lib/escenarios.mjs`](scripts/lib/escenarios.mjs) y, como archivos, en [`migraciones/`](migraciones/).

## Requisitos

- Docker (probado con Docker Desktop 29.9 sobre WSL2). Usa la imagen `postgres:17` y el puerto **18543** del host (solo en `127.0.0.1`).
- Node.js 22 o superior (probado con 24.19).
- Java 21 o superior y Maven 3.9, solo para la parte de Flyway de `npm run orm` (probado con Java 26 y Maven 3.9.16).
- Unos 12 GB libres en el disco de Docker (plantilla, una copia por variante y hasta 8 GB de WAL) y 3 GB de RAM para el contenedor (`shared_buffers=2GB`).
- k6 **no** hace falta: la carga la genera un cliente Node (`scripts/lib/carga.mjs`).

## Cómo correrlo

```
npm install
npm run db:up          # levanta Postgres 17 (docker compose) en 127.0.0.1:18543
npm run preparar       # crea la plantilla con 10 M filas (≈35 s) y una sonda de 1000 filas
npm run escenarios     # M1–M8 con carga, 3 rondas; escribe results/ESCENARIOS.md (≈95 min; RONDAS=1 para ≈30 min)
npm run sql            # exporta las migraciones a migraciones/ingenuas y migraciones/seguras
npm run squawk         # M9; escribe results/SQUAWK.md
npm run orm            # M10 (Prisma y Flyway); escribe results/ORM.md
npm run db:down        # borra el contenedor y su volumen
```

O todo seguido (menos `db:down`): `npm run todo`.

Variables útiles (todas opcionales):

| Variable | Por defecto | Para qué |
|---|---|---|
| `FILAS` | `10000000` | Tamaño de `pedidos` (se fija en `npm run preparar`; úsenlo igual en `npm run escenarios`) |
| `ESCENARIOS` | todos | Solo algunos, por ejemplo `ESCENARIOS=M4,M8` |
| `RONDAS` | `3` | Cuántas veces se mide cada variante (el informe da mediana y rango) |
| `RITMO` / `POOL` | `200` / `20` | Peticiones por segundo y conexiones del pool de la carga |
| `UMBRAL_MS` | `100` | Desde cuántos ms una petición cuenta como bloqueada |
| `LOTE` | `50000` | Filas por lote en los rellenos |
| `SEMILLA` | `42` | Semilla de los datos y de la secuencia de peticiones |
| `PGPORT_HOST` / `PGPORT` | `18543` | Puerto del host si 18543 está ocupado (el primero para `docker compose`, el segundo para los scripts) |

Con una máquina lenta, `FILAS=2000000` da los mismos patrones en una quinta parte del tiempo (las duraciones bajan casi en proporción).

## Cómo se mide

1. `npm run preparar` crea dos bases plantilla: `demo_base` (10 M filas, datos generados dentro de Postgres con `setseed`) y `demo_sonda` (1000 filas, mismo esquema).
2. Para cada variante, `npm run escenarios` copia la plantilla a una base nueva (`CREATE DATABASE ... TEMPLATE`), así todas parten del mismo estado, y carga la tabla en memoria con `pg_prewarm`.
3. **Bloqueo**: cada paso se ejecuta primero en la sonda dentro de una transacción y se lee `pg_locks` antes del `COMMIT` (el modo exacto, aunque la sentencia dure milisegundos). Durante la corrida real, otra conexión consulta `pg_locks` cada ~20 ms y anota el bloqueo de la migración y cuántas sesiones de la carga esperan.
4. **Carga**: 1 s de calentamiento, 6 s de línea base, la migración, y 3 s más. La latencia se cuenta desde que cada petición *debía* salir, así que incluye la espera por una conexión libre del pool: es lo que siente el usuario.
5. **Rondas**: se recorren todos los escenarios 3 veces seguidas; el informe da la mediana y el rango, y el detalle por paso de la ronda de duración mediana.

Un detalle de Windows que costó una medición: `setTimeout` en Windows tiene una resolución de unos 15 ms, así que un cliente que programa las peticiones con `setTimeout` mide latencias falsas de 5 a 15 ms. El cliente usa `setImmediate` (ocupa un núcleo, pero sale a tiempo).

## Resultados de referencia

Medidos el 22 de octubre de 2026 en un portátil (Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11), con Docker Desktop (WSL2, 20 CPU y 31 GB para la VM) y el cliente en la misma máquina.

- [`results/ESCENARIOS.md`](results/ESCENARIOS.md): M1–M8, resumen y detalle paso a paso con el SQL. Datos crudos en `results/json/`.
- [`results/SQUAWK.md`](results/SQUAWK.md): M9, salida real de Squawk.
- [`results/ORM.md`](results/ORM.md): M10, el SQL que genera Prisma y lo que hace Flyway.

Lo principal (medianas de 3 rondas; detalle y rangos en `results/ESCENARIOS.md`):

| | Ingenua | Segura |
|---|---|---|
| **M1** `ADD COLUMN` | 5 ms, 0 peticiones bloqueadas | igual, con `lock_timeout` |
| **M2** default volátil | **12,7 s** con `AccessExclusiveLock`: 2628 peticiones bloqueadas, pausa de 12,6 s | 79 s en pasos; el bloqueo fuerte dura 12 ms; 549 bloqueadas (rango 14–551), pausa 0,5 s |
| **M3** `int → bigint` | **8,2 s** reescribiendo con todo bloqueado: 1653 bloqueadas, pausa 8,1 s | 93 s en 8 pasos; intercambio final de 50 ms; 463 bloqueadas (rango 9–2773), pausa 1,4 s |
| **M4** índice | 1,8 s de `ShareLock`: 281 bloqueadas, **también lecturas** (el pool se llena de escrituras en espera) | `CONCURRENTLY`: 3,2 s, 0 bloqueadas |
| **M5** `SET NOT NULL` | 0,49 s de `AccessExclusiveLock` recorriendo la tabla: 81 bloqueadas | `CHECK NOT VALID` + `VALIDATE` + `SET NOT NULL`: 0 bloqueadas |
| **M6** FK | 0,55 s de `ShareRowExclusiveLock`: 27 bloqueadas | `NOT VALID` + `VALIDATE`: 0 bloqueadas |
| **M7** relleno | **81 s** en un `UPDATE`: 14 858 bloqueadas, pausa de **80 s** (el pool entero queda esperando filas bloqueadas) | lotes de 50 000: 8 bloqueadas, pausa 0,24 s |
| **M8** cola de bloqueos | un `ALTER` de milisegundos espera 8 s detrás de un reporte y **todo** el tráfico espera detrás de él: 1636 bloqueadas, pausa 8 s | `lock_timeout = 200ms` + reintentos (13 intentos): cada intento frena el tráfico 200 ms como máximo: 270 bloqueadas, pausa máxima 0,22 s |

Sorpresas que vale la pena mirar en clase:

- **M4 y M7: un bloqueo que "solo afecta escrituras" también frena lecturas.** Las escrituras bloqueadas retienen sus conexiones; con un pool de 20, en pocos segundos todo el pool está esperando y las lecturas hacen cola en la aplicación, no en la base.
- **M7: lotes más chicos no siempre es mejor.** Lotes de 5000 con 20 ms de pausa tardaron 124 s y bloquearon más peticiones (mediana 156) que lotes de 50 000 (mediana 8). Hay que medir con la carga real.
- **M9: Squawk avisa en las 8 migraciones ingenuas, pero no siempre por la razón importante.** Acierta de lleno en M2 (default volátil), M3 (cambio de tipo), M4 (índice sin `CONCURRENTLY`), M5 (`SET NOT NULL`) y M6 (FK sin `NOT VALID`). En M1 y M8 solo pide `lock_timeout` (que es justo lo que falta). En **M7 no ve el problema**: el `UPDATE` de 10 millones de filas pasa sin aviso; solo avisa por el `ADD COLUMN` y por usar `smallint`. También avisa en casi todas las seguras (falta `lock_timeout` en pasos que lo necesitan, `DROP CONSTRAINT`, renombres) y no puede saber que el `SET NOT NULL` de M3 está respaldado por un `CHECK` validado. Con `--assume-in-transaction` muestra un problema real: si la herramienta ejecuta `ADD CONSTRAINT ... NOT VALID` y `VALIDATE` en la misma transacción, se pierde la ventaja; cada paso seguro debe ir en su propia migración.
- **M10: Prisma convierte el renombre en `DROP COLUMN` + `ADD COLUMN`** y los datos se pierden; con `@map` no hay migración. Flyway aplica el `RENAME COLUMN` escrito a mano y conserva los datos.

## Advertencias

- **Una sola máquina.** Postgres, el cliente de carga y el monitor comparten CPU y disco. Las duraciones absolutas cambian mucho con el hardware; lo que se mantiene es el **orden** (qué bloquea y qué no) y la **forma** (quién espera a quién).
- **Docker en Windows.** Postgres corre en la VM de WSL2 y los datos están en su disco virtual; el acceso desde Windows pasa por el reenvío de puertos de Docker Desktop. En Linux nativo las latencias base son menores.
- **Tres rondas**, no más. Las migraciones largas que bloquean (M2 ingenua, M3 ingenua, M7 ingenua, M8) dan cifras estables entre rondas. Las variantes seguras con rellenos largos (M2, M3 y M7 seguras) tienen rangos amplios: casi siempre van bien, pero alguna ronda tuvo una pausa de 2 a 4 s (checkpoints y escritura del WAL en el disco virtual de WSL, compartido con todo lo demás). Las cifras de las migraciones de milisegundos (M1, M2 constante) son ruido de la máquina.
- **La carga es pequeña y uniforme** (200 peticiones/s sobre ids al azar). Con más tráfico, la cola de M8 y el agotamiento del pool de M4/M7 crecen; con una tabla más ancha, las reescrituras tardan más.
- **El umbral de 100 ms** es arbitrario: sirve para contar, no es un SLO.
- Postgres 17. En Postgres 18 hay `NOT NULL ... NOT VALID` directo (sin el `CHECK` intermedio de M5); el resto no cambia.
