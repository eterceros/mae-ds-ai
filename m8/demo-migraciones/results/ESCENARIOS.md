# Resultados: migraciones de esquema con carga concurrente

Medido el 2026-10-22 con `npm run escenarios`. Archivo generado; no editar a mano (los datos crudos están en `results/json/`).

## Máquina y versiones

- Equipo: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200.
- Docker 29.9.2 (Docker Desktop con WSL2; 20 CPU y 31 GB asignados a la VM de Docker).
- PostgreSQL 17.11 (Debian 17.11-1.pgdg13+2) (imagen `postgres:17`), con `shared_buffers=2GB`, `max_wal_size=8GB`, `maintenance_work_mem=512MB`.
- Node v24.19.0, driver `pg` 8.23.1. Cliente, servidor y Docker en la misma máquina.

## Cómo leer las tablas

- Tabla `pedidos` con **10.000.000 filas** (≈1,2 GB con sus índices) y `clientes` con 100.000. Cada variante corre sobre una copia nueva de la misma base.
- Carga: **200 peticiones/s a ritmo fijo** (70 % lecturas por id, 20 % UPDATE por id, 10 % INSERT), atendidas por un pool de **20 conexiones**, como una aplicación. La latencia se cuenta desde que la petición debió salir: incluye la espera por una conexión libre.
- **Bloqueadas**: peticiones que tardaron más de 100 ms, desde que empezó la migración hasta el final de la prueba (incluye la cola que queda al terminar). Se da la mediana del total, el rango entre rondas y cuántas fueron lecturas (L) y escrituras (E) en la ronda de la mediana. Sin migración, este número es 0 o casi 0.
- **Pausa máx.**: la petición más lenta en ese mismo intervalo.
- **p50 / p99 antes**: 6 s de línea base. **Durante**: peticiones que debían salir mientras corría la migración (como mínimo 1 s, para que las migraciones instantáneas tengan muestra).
- **Bloqueo más fuerte**: el modo de bloqueo de tabla más fuerte que pidió la migración sobre `pedidos` (o `clientes`) y cuánto duraron los pasos que lo pidieron, **incluida la espera hasta obtenerlo** (en M8 casi todo ese tiempo es espera, y mientras se espera también se bloquea a los demás). **Paso más largo**: el bloqueo de tabla del paso que más tardó; en los rellenos (M7) el daño lo hacen los bloqueos de fila de un `UPDATE` largo, que `pg_locks` muestra como `RowExclusiveLock` sobre la tabla. Se lee de `pg_locks` de dos formas: ejecutando cada paso dentro de una transacción en una base de 1000 filas (sonda) y consultando `pg_locks` cada 20 ms durante la corrida real (observado).

## Resumen

Cada variante se midió **3 veces** (rondas completas, una detrás de otra). Las cifras son la **mediana**; entre paréntesis, el rango entre rondas. Los bloqueos son los de la ronda de duración mediana.

| Escenario | Variante | Bloqueo más fuerte, tiempo de sus pasos | Paso más largo: bloqueo, tiempo | Duración (s) | Bloqueadas: total (rango) · L / E | Pausa máx. (ms) | p50 antes → durante (ms) | p99 antes → durante (ms) | Errores |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| M1 | ingenua | AccessExclusive, 0.003 s | AccessExclusive, 0.003 s | 0.005 (0.005–0.012) | 0 · 0 / 0 | 21 (12–67) | 2.2 → 1.9 | 34 → 6.5 | 0 |
| M1 | segura | AccessExclusive, 0.006 s | AccessExclusive, 0.006 s | 0.009 (0.008–0.019) | 0 · 0 / 0 | 14 (9.1–25) | 2.5 → 3.0 | 15 → 8.9 | 0 |
| M2 | constante | AccessExclusive, 0.004 s | AccessExclusive, 0.004 s | 0.006 (0.004–0.007) | 0 · 0 / 0 | 29 (14–38) | 2.3 → 2.5 | 9.2 → 11 | 0 |
| M2 | volátil (ingenua) | AccessExclusive, 12.70 s | AccessExclusive, 12.70 s | 12.71 (12.65–13.21) | 2628 (2586–2702) · 1826 / 802 | 12637 (12570–13125) | 3.7 → 6608 | 20 → 12523 | 0 |
| M2 | volátil (segura) | AccessExclusive, 0.012 s | RowExclusive, 78.03 s | 78.63 (75.83–80.13) | 549 (14–551) · 186 / 363 | 515 (456–2102) | 1.8 → 1.8 | 8.1 → 284 | 0 |
| M3 | ingenua | AccessExclusive, 8.15 s | AccessExclusive, 8.15 s | 8.15 (8.01–8.58) | 1653 (1622–1730) · 1155 / 498 | 8068 (7937–8493) | 3.7 → 4139 | 14 → 7989 | 0 |
| M3 | segura | AccessExclusive, 0.050 s | RowExclusive, 90.32 s | 93.28 (77.96–96.10) | 463 (9–2773) · 154 / 309 | 1368 (190–3932) | 2.1 → 2.6 | 9.2 → 399 | 0 |
| M4 | ingenua | Share, 1.78 s | Share, 1.78 s | 1.78 (1.75–2.33) | 281 (278–390) · 172 / 109 | 1760 (1732–2309) | 2.0 → 596 | 8.0 → 1707 | 0 |
| M4 | segura | ShareUpdateExclusive, 3.23 s | ShareUpdateExclusive, 3.23 s | 3.23 (2.91–3.44) | 0 (0–20) · 0 / 0 | 18 (16–189) | 2.9 → 1.7 | 19 → 15 | 0 |
| M5 | ingenua | AccessExclusive, 0.49 s | AccessExclusive, 0.49 s | 0.49 (0.49–0.55) | 81 (80–92) · 63 / 18 | 486 (482–545) | 2.8 → 28 | 16 → 479 | 0 |
| M5 | segura | AccessExclusive, 0.007 s | ShareUpdateExclusive, 0.34 s | 0.35 (0.35–0.50) | 0 · 0 / 0 | 28 (14–79) | 3.5 → 3.1 | 15 → 11 | 0 |
| M6 | ingenua | ShareRowExclusive, 0.55 s | ShareRowExclusive, 0.55 s | 0.55 (0.54–0.73) | 27 (24–63) · 6 / 21 | 535 (519–710) | 2.2 → 3.3 | 15 → 525 | 0 |
| M6 | segura | ShareRowExclusive, 0.005 s | ShareUpdateExclusive, 0.54 s | 0.55 (0.54–0.64) | 0 · 0 / 0 | 24 (18–33) | 3.5 → 2.3 | 14 → 8.0 | 0 |
| M7 | ingenua | AccessExclusive, 0.002 s | RowExclusive, 81.05 s | 81.05 (72.53–83.41) | 14858 (13277–15725) · 10344 / 4514 | 79539 (71015–82487) | 3.0 → 33001 | 14 → 71681 | 0 |
| M7 | segura, lotes de 50000 | AccessExclusive, 0.003 s | RowExclusive, 77.32 s | 77.33 (67.50–83.93) | 8 (3–2277) · 0 / 8 | 242 (224–4342) | 2.2 → 2.3 | 9.4 → 13 | 0 |
| M7 | segura, lotes de 5000 y pausa de 20 ms | AccessExclusive, 0.003 s | RowExclusive, 123.73 s | 123.74 (121.63–124.49) | 156 (96–468) · 78 / 78 | 905 (842–2219) | 2.2 → 2.2 | 11 → 32 | 0 |
| M8 | ingenua | AccessExclusive, 8.00 s | AccessExclusive, 8.00 s | 8.03 (8.03–8.04) | 1636 (1630–1638) · 1148 / 488 | 8001 (7998–8009) | 2.9 → 4126 | 8.7 → 7923 | 0 |
| M8 | segura | AccessExclusive, 8.45 s | AccessExclusive, 8.45 s | 8.48 (8.47–8.53) | 270 (258–272) · 185 / 85 | 215 (207–223) | 2.4 → 3.0 | 13 → 200 | 0 |

## M1. ADD COLUMN anulable, sin valor por defecto

Es instantáneo (solo cambia el catálogo), pero igual toma AccessExclusiveLock: por eso importa M8.

### M1 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Agregar columna | AccessExclusiveLock (pedidos) | — | 0 | 0.003 |

Ronda representativa (1): duración 0.005 s. Desde el inicio de la migración: 600 peticiones, 0 bloqueadas (0 lecturas, 0 escrituras), pausa máxima 12 ms, 0 errores. p50/p99 antes 1.8/7.2 ms; durante 1.8/5.5 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.005 s · 0 · 12 ms · 7.2 → 5.5 ms
- Ronda 2: 0.012 s · 0 · 67 ms · 36 → 33 ms
- Ronda 3: 0.005 s · 0 · 21 ms · 34 → 6.5 ms

```sql
ALTER TABLE pedidos ADD COLUMN cupon text;
```

### M1 segura

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Agregar columna con lock_timeout | AccessExclusiveLock (pedidos) | — | 0 | 0.006 |

Ronda representativa (2): duración 0.009 s. Desde el inicio de la migración: 602 peticiones, 0 bloqueadas (0 lecturas, 0 escrituras), pausa máxima 9.1 ms, 0 errores. p50/p99 antes 2.5/15 ms; durante 3.0/7.2 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.008 s · 0 · 14 ms · 32 → 8.9 ms
- Ronda 2: 0.009 s · 0 · 9.1 ms · 15 → 7.2 ms
- Ronda 3: 0.019 s · 0 · 25 ms · 14 → 12 ms

```sql
SET lock_timeout = '2000ms';
ALTER TABLE pedidos ADD COLUMN cupon text;
RESET lock_timeout;
```

## M2. ADD COLUMN con DEFAULT: constante frente a volátil

Desde Postgres 11 un DEFAULT constante no reescribe la tabla; uno volátil (gen_random_uuid(), clock_timestamp()) sí.

### M2 constante

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| DEFAULT constante | AccessExclusiveLock (pedidos) | — | 0 | 0.004 |

Ronda representativa (1): duración 0.006 s. Desde el inicio de la migración: 602 peticiones, 0 bloqueadas (0 lecturas, 0 escrituras), pausa máxima 29 ms, 0 errores. p50/p99 antes 1.9/6.1 ms; durante 1.8/10 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.006 s · 0 · 29 ms · 6.1 → 10 ms
- Ronda 2: 0.007 s · 0 · 14 ms · 9.6 → 11 ms
- Ronda 3: 0.004 s · 0 · 38 ms · 9.2 → 23 ms

```sql
ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0;
```

### M2 volátil (ingenua)

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| DEFAULT volátil | AccessExclusiveLock (pedidos) | AccessExclusiveLock (pedidos) | 20 | 12.70 |

Ronda representativa (2): duración 12.71 s. Desde el inicio de la migración: 3141 peticiones, 2628 bloqueadas (1826 lecturas, 802 escrituras), pausa máxima 12637 ms, 0 errores. p50/p99 antes 3.7/20 ms; durante 6608/12523 ms (2541 peticiones). En la línea base hubo 1 peticiones de más de 100 ms (ruido de la máquina).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 13.21 s · 2702 · 13125 ms · 40 → 13003 ms (5 peticiones lentas ya en la línea base)
- Ronda 2: 12.71 s · 2628 · 12637 ms · 20 → 12523 ms (1 peticiones lentas ya en la línea base)
- Ronda 3: 12.65 s · 2586 · 12570 ms · 18 → 12449 ms

```sql
ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
```

### M2 volátil (segura)

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Columna anulable sin default | AccessExclusiveLock (pedidos) | — | 0 | 0.002 |
| Default solo para filas nuevas | AccessExclusiveLock (pedidos) | — | 0 | 0.002 |
| Rellenar por lotes (201 lotes) | RowExclusiveLock (pedidos) | RowExclusiveLock (pedidos) | 0 | 78.03 |
| CHECK sin validar | AccessExclusiveLock (pedidos) | — | 0 | 0.003 |
| Validar el CHECK | ShareUpdateExclusiveLock (pedidos) | ShareUpdateExclusiveLock (pedidos) | 0 | 0.57 |
| SET NOT NULL (usa el CHECK, no recorre) | AccessExclusiveLock (pedidos) | — | 0 | 0.002 |
| Quitar el CHECK | AccessExclusiveLock (pedidos) | — | 0 | 0.002 |

Ronda representativa (2): duración 78.63 s. Desde el inicio de la migración: 16327 peticiones, 549 bloqueadas (186 lecturas, 363 escrituras), pausa máxima 515 ms, 0 errores. p50/p99 antes 1.8/8.1 ms; durante 2.1/284 ms (15727 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 80.13 s · 551 · 2102 ms · 8.1 → 1258 ms
- Ronda 2: 78.63 s · 549 · 515 ms · 8.1 → 284 ms
- Ronda 3: 75.83 s · 14 · 456 ms · 9.2 → 58 ms

```sql
ALTER TABLE pedidos ADD COLUMN token uuid;
ALTER TABLE pedidos ALTER COLUMN token SET DEFAULT gen_random_uuid();
-- repetir para a = 1, 1+50000, ... hasta max(id), cada lote en su propia transacción:
UPDATE pedidos SET token = gen_random_uuid() WHERE id >= :a AND id < :a + 50000 AND token IS NULL;
ALTER TABLE pedidos ADD CONSTRAINT token_no_nulo CHECK (token IS NOT NULL) NOT VALID;
ALTER TABLE pedidos VALIDATE CONSTRAINT token_no_nulo;
ALTER TABLE pedidos ALTER COLUMN token SET NOT NULL;
ALTER TABLE pedidos DROP CONSTRAINT token_no_nulo;
```

## M3. Cambiar el tipo de la clave primaria: integer → bigint

ALTER COLUMN TYPE reescribe la tabla y todos sus índices con AccessExclusiveLock. La vía segura es una columna nueva, un trigger, relleno por lotes, índice CONCURRENTLY y un intercambio corto.

### M3 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Cambiar el tipo | AccessExclusiveLock (pedidos) | AccessExclusiveLock (pedidos) | 20 | 8.15 |

Ronda representativa (3): duración 8.15 s. Desde el inicio de la migración: 2230 peticiones, 1653 bloqueadas (1155 lecturas, 498 escrituras), pausa máxima 8068 ms, 0 errores. p50/p99 antes 3.7/20 ms; durante 4139/7989 ms (1630 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 8.58 s · 1730 · 8493 ms · 6.3 → 8409 ms
- Ronda 2: 8.01 s · 1622 · 7937 ms · 14 → 7859 ms
- Ronda 3: 8.15 s · 1653 · 8068 ms · 20 → 7989 ms

```sql
ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;
```

### M3 segura

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Columna nueva | AccessExclusiveLock (pedidos) | — | 0 | 0.003 |
| Función que copia id | — | — | 0 | 0.004 |
| Trigger para filas nuevas y modificadas | ShareRowExclusiveLock (pedidos) | — | 0 | 0.002 |
| Rellenar por lotes (201 lotes) | RowExclusiveLock (pedidos) | RowExclusiveLock (pedidos) | 0 | 90.32 |
| Índice único sin bloquear escrituras | no transaccional | ShareUpdateExclusiveLock (pedidos) | 0 | 2.44 |
| CHECK sin validar | AccessExclusiveLock (pedidos) | — | 0 | 0.002 |
| Validar el CHECK | ShareUpdateExclusiveLock (pedidos) | ShareUpdateExclusiveLock (pedidos) | 0 | 0.45 |
| Intercambio en una transacción corta | AccessExclusiveLock (pedidos) | — | 0 | 0.045 |

Ronda representativa (1): duración 93.28 s. Desde el inicio de la migración: 19257 peticiones, 463 bloqueadas (154 lecturas, 309 escrituras), pausa máxima 1368 ms, 0 errores. p50/p99 antes 1.9/5.6 ms; durante 1.1/399 ms (18657 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 93.28 s · 463 · 1368 ms · 5.6 → 399 ms
- Ronda 2: 77.96 s · 9 · 190 ms · 9.2 → 14 ms
- Ronda 3: 96.10 s · 2773 · 3932 ms · 12 → 3019 ms

```sql
ALTER TABLE pedidos ADD COLUMN id_nuevo bigint;
CREATE FUNCTION pedidos_copiar_id() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.id_nuevo := NEW.id; RETURN NEW; END $$;
CREATE TRIGGER pedidos_copiar_id BEFORE INSERT OR UPDATE ON pedidos FOR EACH ROW EXECUTE FUNCTION pedidos_copiar_id();
-- repetir para a = 1, 1+50000, ... hasta max(id), cada lote en su propia transacción:
UPDATE pedidos SET id_nuevo = id WHERE id >= :a AND id < :a + 50000 AND id_nuevo IS NULL;
CREATE UNIQUE INDEX CONCURRENTLY pedidos_id_nuevo_key ON pedidos (id_nuevo);
ALTER TABLE pedidos ADD CONSTRAINT id_nuevo_no_nulo CHECK (id_nuevo IS NOT NULL) NOT VALID;
ALTER TABLE pedidos VALIDATE CONSTRAINT id_nuevo_no_nulo;
BEGIN;
SET LOCAL lock_timeout = '2s';
ALTER TABLE pedidos ALTER COLUMN id DROP IDENTITY;
ALTER TABLE pedidos DROP CONSTRAINT pedidos_pkey;
ALTER TABLE pedidos RENAME COLUMN id TO id_viejo;
ALTER TABLE pedidos RENAME COLUMN id_nuevo TO id;
ALTER TABLE pedidos ALTER COLUMN id SET NOT NULL;            -- no recorre: usa el CHECK validado
ALTER TABLE pedidos ADD CONSTRAINT pedidos_pkey PRIMARY KEY USING INDEX pedidos_id_nuevo_key;
ALTER TABLE pedidos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (START WITH <max(id)+1>);
DROP TRIGGER pedidos_copiar_id ON pedidos;
ALTER TABLE pedidos DROP COLUMN id_viejo;                    -- instantáneo: solo marca la columna
ALTER TABLE pedidos DROP CONSTRAINT id_nuevo_no_nulo;
COMMIT;
```

## M4. CREATE INDEX frente a CREATE INDEX CONCURRENTLY

CREATE INDEX toma ShareLock: las lecturas siguen, pero toda escritura espera. CONCURRENTLY toma ShareUpdateExclusiveLock y tarda más, sin cortar escrituras.

### M4 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Crear índice | ShareLock (pedidos) | ShareLock (pedidos) | 20 | 1.78 |

Ronda representativa (3): duración 1.78 s. Desde el inicio de la migración: 956 peticiones, 281 bloqueadas (172 lecturas, 109 escrituras), pausa máxima 1760 ms, 0 errores. p50/p99 antes 2.0/8.0 ms; durante 596/1707 ms (356 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 2.33 s · 390 · 2309 ms · 5.5 → 2226 ms
- Ronda 2: 1.75 s · 278 · 1732 ms · 11 → 1679 ms
- Ronda 3: 1.78 s · 281 · 1760 ms · 8.0 → 1707 ms

```sql
CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);
```

### M4 segura

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Crear índice CONCURRENTLY | no transaccional | ShareUpdateExclusiveLock (pedidos) | 0 | 3.23 |

Ronda representativa (2): duración 3.23 s. Desde el inicio de la migración: 1246 peticiones, 20 bloqueadas (0 lecturas, 20 escrituras), pausa máxima 189 ms, 0 errores. p50/p99 antes 2.9/38 ms; durante 1.7/154 ms (646 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 3.44 s · 0 · 16 ms · 5.2 → 6.4 ms
- Ronda 2: 3.23 s · 20 · 189 ms · 38 → 154 ms
- Ronda 3: 2.91 s · 0 · 18 ms · 19 → 15 ms

```sql
CREATE INDEX CONCURRENTLY pedidos_producto_idx ON pedidos (producto_id);
```

## M5. SET NOT NULL directo frente a CHECK NOT VALID + VALIDATE + SET NOT NULL

SET NOT NULL recorre toda la tabla con AccessExclusiveLock. Con un CHECK validado antes (ShareUpdateExclusiveLock), Postgres 12+ se salta el recorrido.

### M5 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| SET NOT NULL | AccessExclusiveLock (pedidos) | AccessExclusiveLock (pedidos) | 20 | 0.49 |

Ronda representativa (2): duración 0.49 s. Desde el inicio de la migración: 699 peticiones, 80 bloqueadas (62 lecturas, 18 escrituras), pausa máxima 486 ms, 0 errores. p50/p99 antes 2.8/26 ms; durante 15/479 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.55 s · 92 · 545 ms · 16 → 534 ms
- Ronda 2: 0.49 s · 80 · 486 ms · 26 → 479 ms
- Ronda 3: 0.49 s · 81 · 482 ms · 15 → 472 ms

```sql
ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
```

### M5 segura

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| CHECK sin validar | AccessExclusiveLock (pedidos) | — | 0 | 0.004 |
| Validar el CHECK | ShareUpdateExclusiveLock (pedidos) | ShareUpdateExclusiveLock (pedidos) | 0 | 0.34 |
| SET NOT NULL (usa el CHECK) | AccessExclusiveLock (pedidos) | — | 0 | 0.001 |
| Quitar el CHECK | AccessExclusiveLock (pedidos) | — | 0 | 0.002 |

Ronda representativa (2): duración 0.35 s. Desde el inicio de la migración: 671 peticiones, 0 bloqueadas (0 lecturas, 0 escrituras), pausa máxima 14 ms, 0 errores. p50/p99 antes 3.6/9.6 ms; durante 3.1/11 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.50 s · 0 · 79 ms · 15 → 72 ms
- Ronda 2: 0.35 s · 0 · 14 ms · 9.6 → 11 ms
- Ronda 3: 0.35 s · 0 · 28 ms · 16 → 11 ms

```sql
ALTER TABLE pedidos ADD CONSTRAINT region_no_nula CHECK (region IS NOT NULL) NOT VALID;
ALTER TABLE pedidos VALIDATE CONSTRAINT region_no_nula;
ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
ALTER TABLE pedidos DROP CONSTRAINT region_no_nula;
```

## M6. Clave foránea directa frente a NOT VALID + VALIDATE

ADD FOREIGN KEY valida todas las filas con ShareRowExclusiveLock en ambas tablas: bloquea escrituras. NOT VALID es instantáneo y VALIDATE solo toma ShareUpdateExclusiveLock.

### M6 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Agregar FK | ShareRowExclusiveLock (pedidos), ShareRowExclusiveLock (clientes) | ShareRowExclusiveLock (clientes), ShareRowExclusiveLock (pedidos) | 20 | 0.55 |

Ronda representativa (2): duración 0.55 s. Desde el inicio de la migración: 711 peticiones, 27 bloqueadas (6 lecturas, 21 escrituras), pausa máxima 535 ms, 0 errores. p50/p99 antes 3.4/15 ms; durante 3.3/525 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.73 s · 63 · 710 ms · 20 → 700 ms
- Ronda 2: 0.55 s · 27 · 535 ms · 15 → 525 ms
- Ronda 3: 0.54 s · 24 · 519 ms · 8.1 → 507 ms

```sql
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
```

### M6 segura

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| FK sin validar | ShareRowExclusiveLock (pedidos), ShareRowExclusiveLock (clientes) | — | 0 | 0.005 |
| Validar la FK | ShareUpdateExclusiveLock (pedidos), RowShareLock (clientes) | ShareUpdateExclusiveLock (pedidos), RowShareLock (clientes) | 0 | 0.54 |

Ronda representativa (2): duración 0.55 s. Desde el inicio de la migración: 710 peticiones, 0 bloqueadas (0 lecturas, 0 escrituras), pausa máxima 18 ms, 0 errores. p50/p99 antes 3.5/14 ms; durante 2.3/8.0 ms (200 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 0.64 s · 0 · 24 ms · 11 → 8.0 ms
- Ronda 2: 0.55 s · 0 · 18 ms · 14 → 8.0 ms
- Ronda 3: 0.54 s · 0 · 33 ms · 16 → 18 ms

```sql
ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id) NOT VALID;
ALTER TABLE pedidos VALIDATE CONSTRAINT pedidos_cliente_fk;
```

## M7. Relleno de una columna nueva: un solo UPDATE frente a lotes

Un UPDATE de toda la tabla bloquea cada fila hasta el COMMIT: las escrituras de la aplicación sobre esas filas esperan y agotan el pool. Por lotes, cada bloqueo dura una fracción de segundo.

### M7 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Columna nueva | AccessExclusiveLock (pedidos) | AccessExclusiveLock (pedidos) | 1 | 0.002 |
| Rellenar en un UPDATE | RowExclusiveLock (pedidos) | RowExclusiveLock (pedidos) | 0 | 81.05 |

Ronda representativa (1): duración 81.05 s. Desde el inicio de la migración: 16811 peticiones, 14858 bloqueadas (10344 lecturas, 4514 escrituras), pausa máxima 79539 ms, 0 errores. p50/p99 antes 1.0/14 ms; durante 33001/71681 ms (16211 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 81.05 s · 14858 · 79539 ms · 14 → 71681 ms
- Ronda 2: 83.41 s · 15725 · 82487 ms · 11 → 74830 ms
- Ronda 3: 72.53 s · 13277 · 71015 ms · 28 → 63254 ms

```sql
ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
UPDATE pedidos SET region_codigo = CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END;
```

### M7 segura, lotes de 50000

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Columna nueva | AccessExclusiveLock (pedidos) | — | 0 | 0.003 |
| Rellenar por lotes de 50000 (201 lotes) | RowExclusiveLock (pedidos) | RowExclusiveLock (pedidos) | 0 | 77.32 |

Ronda representativa (1): duración 77.33 s. Desde el inicio de la migración: 16066 peticiones, 3 bloqueadas (0 lecturas, 3 escrituras), pausa máxima 224 ms, 0 errores. p50/p99 antes 1.2/5.5 ms; durante 1.0/11 ms (15466 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 77.33 s · 3 · 224 ms · 5.5 → 11 ms
- Ronda 2: 67.50 s · 8 · 242 ms · 9.4 → 13 ms
- Ronda 3: 83.93 s · 2277 · 4342 ms · 10 → 3470 ms

```sql
ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
-- repetir para a = 1, 1+50000, ... hasta max(id), cada lote en su propia transacción:
UPDATE pedidos SET region_codigo = CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END WHERE id >= :a AND id < :a + 50000 AND region_codigo IS NULL;
```

### M7 segura, lotes de 5000 y pausa de 20 ms

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Columna nueva | AccessExclusiveLock (pedidos) | — | 0 | 0.003 |
| Rellenar por lotes de 5000 con pausa (2001 lotes) | RowExclusiveLock (pedidos) | RowExclusiveLock (pedidos) | 0 | 123.73 |

Ronda representativa (3): duración 123.74 s. Desde el inicio de la migración: 25349 peticiones, 468 bloqueadas (312 lecturas, 156 escrituras), pausa máxima 2219 ms, 0 errores. p50/p99 antes 3.2/8.4 ms; durante 2.2/966 ms (24749 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 124.49 s · 156 · 905 ms · 14 → 32 ms
- Ronda 2: 121.63 s · 96 · 842 ms · 11 → 26 ms
- Ronda 3: 123.74 s · 468 · 2219 ms · 8.4 → 966 ms

```sql
ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
-- repetir para a = 1, 1+5000, ... hasta max(id), cada lote en su propia transacción, con 20 ms de pausa entre lotes:
UPDATE pedidos SET region_codigo = CASE region WHEN 'andina' THEN 1 WHEN 'valles' THEN 2 WHEN 'llanos' THEN 3 END WHERE id >= :a AND id < :a + 5000 AND region_codigo IS NULL;
```

## M8. Cola de bloqueos: transacción larga + ALTER instantáneo

El ALTER (instantáneo) espera AccessExclusiveLock detrás de una transacción de 8 s; mientras espera, todas las peticiones nuevas hacen cola detrás de él. Con lock_timeout y reintentos, el ALTER se rinde rápido y la aplicación sigue.

### M8 ingenua

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Otra sesión abre una transacción que lee pedidos y no termina en 8 s | — | — | 0 | 0.026 |
| ALTER sin lock_timeout | AccessExclusiveLock (pedidos) | —; esperó AccessExclusiveLock (pedidos) | 20 | 8.00 |

Ronda representativa (1): duración 8.03 s. Desde el inicio de la migración: 2207 peticiones, 1636 bloqueadas (1148 lecturas, 488 escrituras), pausa máxima 8001 ms, 0 errores. p50/p99 antes 2.9/11 ms; durante 4122/7923 ms (1607 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 8.03 s · 1636 · 8001 ms · 11 → 7923 ms
- Ronda 2: 8.04 s · 1638 · 8009 ms · 7.6 → 7929 ms
- Ronda 3: 8.03 s · 1630 · 7998 ms · 8.7 → 7919 ms

```sql
-- sesión 2 (por ejemplo, un reporte)
BEGIN;
SELECT count(*) FROM pedidos WHERE id < 1000;  -- toma AccessShareLock hasta el COMMIT
-- ... 8 s después: COMMIT;
ALTER TABLE pedidos ADD COLUMN cupon text;
```

### M8 segura

| Paso | Bloqueo (sonda) | Bloqueo observado | Cargas esperando un lock (máx.) | Duración (s) |
|---|---|---|---:|---:|
| Otra sesión abre una transacción que lee pedidos y no termina en 8 s | — | — | 0 | 0.018 |
| ALTER con lock_timeout = 200 ms y reintentos cada 500 ms (13 intentos) | AccessExclusiveLock (pedidos) | —; esperó AccessExclusiveLock (pedidos) | 20 | 8.45 |

Ronda representativa (3): duración 8.48 s. Desde el inicio de la migración: 2295 peticiones, 272 bloqueadas (185 lecturas, 87 escrituras), pausa máxima 215 ms, 0 errores. p50/p99 antes 2.4/13 ms; durante 3.0/201 ms (1696 peticiones).

Por ronda (duración · bloqueadas · pausa máx. · p99 antes → durante):

- Ronda 1: 8.47 s · 258 · 207 ms · 9.7 → 199 ms
- Ronda 2: 8.53 s · 270 · 223 ms · 34 → 200 ms
- Ronda 3: 8.48 s · 272 · 215 ms · 13 → 201 ms

```sql
-- sesión 2 (por ejemplo, un reporte)
BEGIN;
SELECT count(*) FROM pedidos WHERE id < 1000;  -- toma AccessShareLock hasta el COMMIT
-- ... 8 s después: COMMIT;
SET lock_timeout = '200ms';
-- reintentar ante el error 55P03 (lock_not_available), esperando 500 ms entre intentos:
ALTER TABLE pedidos ADD COLUMN cupon text;
RESET lock_timeout;
```
