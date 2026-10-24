# K6. Migraciones como servicio que corre una vez

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1.

[`despues/compose.yaml`](../despues/compose.yaml) tiene tres servicios: `postgres` (con healthcheck), `migrate` (la misma imagen que la API con `command: ["node", "dist/migrate.js"]`, `depends_on: postgres: service_healthy`) y `api` (`depends_on: migrate: service_completed_successfully`). El aplicador de migraciones ([`api/src/migrate.ts`](../api/src/migrate.ts)) lleva la cuenta en `schema_migrations` y aplica cada archivo en su propia transacción. Es el mismo patrón que en la S06 con Flyway o Prisma: aquí lo que importa es **cuándo** corre.

## 1. Primera vez (volumen vacío), 3 corridas

Momentos medidos desde que arrancó el contenedor de Postgres (`docker inspect`: `StartedAt`, `FinishedAt` y el primer chequeo de salud correcto), en segundos; mediana y rango.

| Momento | s desde que arranca Postgres |
|---|---:|
| Postgres pasa su healthcheck | 1.25 (1.2–2.3) |
| `migrate` arranca | 1.75 (1.7–2.7) |
| `migrate` termina (código 0) | 1.95 (1.9–2.9) |
| `api` arranca | 2.45 (2.4–3.4) |
| `api` pasa su healthcheck | 4.69 (4.6–5.7) |
| `docker compose up -d --wait` devuelve (código 0) | 5.84 (5.6–6.7) (desde que se lanzó el comando) |

En las 3 corridas el orden fue el mismo: migrate arrancó después del healthcheck de Postgres y la API después de que migrate terminó.

Salida de `migrate`:

```
migracion aplicada: 001_crear_items.sql
migraciones: 1 aplicadas, 0 ya estaban
```

`GET /items` devolvió 3 filas creadas por la migración.

## 2. Segunda vez sobre la misma base

`docker compose down` (sin `-v`) y `up -d --wait` otra vez (código 0). `migrate` vuelve a correr, ve que la migración ya está registrada y termina sin hacer nada:

```
migraciones: 0 aplicadas, 1 ya estaban
```

`schema_migrations`: 001_crear_items.sql.

## 3. Una migración con error

Se suma [`despues/compose.migracion-con-error.yaml`](../despues/compose.migracion-con-error.yaml), que agrega [`002_columna_rota.sql`](../despues/migraciones-con-error/002_columna_rota.sql) (un `ALTER TABLE ... ADD COLUMN` y un `UPDATE` que usa una columna inexistente).

- `docker compose up -d --wait` termina con código **1**:

  ```
   Container s08-docker-migrate-1 Waiting 
   Container s08-docker-migrate-1 Error service "migrate" didn't complete successfully: exit 1
  service "migrate" didn't complete successfully: exit 1
  ```
- `migrate`: estado `exited`, código de salida **1**. Su salida:

  ```
  migracion aplicada: 001_crear_items.sql
  Migracion fallida: fallo 002_columna_rota.sql: column "stock" does not exist
  ```
- `api`: contenedor creado pero **nunca arrancó** (estado `created`, sin fecha de inicio).
- En la base quedó registrada solo `001_crear_items.sql` y la tabla `items` tiene las columnas `id, nombre, precio`: el `ADD COLUMN categoria` de la migración rota se deshizo junto con el `UPDATE`, porque iban en la misma transacción.

## Por qué

- **`service_completed_successfully`** hace que Compose espere a que `migrate` **termine con código 0** antes de arrancar la API. Si termina con otro código, el contenedor de la API queda creado pero no arranca y `up --wait` falla: nunca hay una API nueva corriendo sobre un esquema viejo o a medio migrar.
- **Una sola vez y antes**, en lugar de migrar dentro del arranque de la API: si hubiera varias réplicas de la API, todas intentarían migrar a la vez. Con un servicio aparte corre una sola instancia. (En Kubernetes el equivalente es un `Job` o un *init container*.)
- **Idempotente**: correr `migrate` de nuevo es seguro porque registra lo aplicado; por eso puede ir en cada `up`.
- **Transacción por archivo**: en Postgres el DDL es transaccional, así que una migración que falla a la mitad no deja el esquema a medias. Las migraciones que no pueden ir en transacción (`CREATE INDEX CONCURRENTLY`, S06) necesitan su propio archivo.
- **Detalle de Compose**: `docker compose up --wait migrate` (pedir solo el servicio que termina) devuelve error aunque `migrate` salga con 0, porque `--wait` espera servicios en ejecución. Para correrlo suelto: `docker compose run --rm migrate`.
