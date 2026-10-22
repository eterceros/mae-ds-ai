# M10. Renombrar una columna: qué SQL generan Prisma y Flyway

Generado con `npm run orm` el 2026-10-22. Prisma 7.10.1; Flyway 13.11.1 (flyway-maven-plugin) con Maven y Java de la máquina.

## Prisma

En `orm/prisma/1_antes.prisma` el modelo `Cliente` tiene `telefono`. En `2_renombrar.prisma` el campo se llama `celular`. Comando:

```
npx prisma migrate diff --config orm/prisma/prisma.config.ts --from-schema orm/prisma/1_antes.prisma --to-schema orm/prisma/2_renombrar.prisma --script
```

SQL generado (`orm/prisma/generado/2_renombrar.sql`):

```sql
-- AlterTable
ALTER TABLE "cliente" DROP COLUMN "telefono",
ADD COLUMN     "celular" TEXT;
```

Prisma no puede saber que es un renombre: ve una columna que desaparece y otra que aparece. Datos antes de aplicarlo:

| id | nombre | telefono |
|---|---|---|
| 1 | Ana | 70000001 |
| 2 | Luis | 70000002 |
| 3 | Rosa | NULL |

Después de aplicarlo:

| id | nombre | celular |
|---|---|---|
| 1 | Ana | NULL |
| 2 | Luis | NULL |
| 3 | Rosa | NULL |

**Los teléfonos se perdieron.**

`prisma migrate dev` sí avisa antes de crear la migración cuando hay datos (comprobado a mano con Prisma 7.10.1 sobre una base con 2 filas; no lo corre este script porque el comando es interactivo y en una terminal no interactiva se detiene con un error):

```text
⚠️  Warnings for the current datasource:

  • You are about to drop the column `telefono` on the `cliente` table, which still contains 2 non-null values.
```

Ese aviso aparece una vez, en la máquina de quien genera la migración. `prisma migrate deploy` en CI o en producción aplica el archivo sin preguntar, y un asistente de IA que genera y aplica la migración puede no mostrarlo.

Si solo se quiere otro nombre en el código, `@map` conserva la columna (`3_renombrar_con_map.prisma`). SQL generado:

```sql
-- This is an empty migration.
```

Si de verdad hay que renombrar la columna en la base, se edita a mano la migración generada (`ALTER TABLE "cliente" RENAME COLUMN "telefono" TO "celular";`) y se hace en pasos expand/contract si hay versiones de la aplicación que usan el nombre viejo.

## Flyway

Flyway no genera SQL: aplica, en orden de versión y una sola vez, los archivos `V<n>__<descripción>.sql` que uno escribe, y lo registra en `flyway_schema_history`. Para el renombre, el SQL es el que decide quien escribe la migración (`orm/flyway/src/main/resources/db/migration/V2__renombrar_telefono.sql`):

```sql
-- Flyway no genera SQL: ejecuta, en orden y una sola vez, el SQL que uno escribe.
-- El renombre lo decide quien escribe la migración: RENAME COLUMN conserva los datos y es instantáneo,
-- pero rompe a cualquier versión de la aplicación que todavía use el nombre viejo (ver expand/contract).
SET lock_timeout = '2s';
ALTER TABLE cliente RENAME COLUMN telefono TO celular;
```

Comando (desde `orm/flyway`):

```
mvn -Dflyway.url=jdbc:postgresql://127.0.0.1:18543/orm_flyway flyway:migrate flyway:info
```

Salida:

```text
Environment: default
Database: jdbc:postgresql:******** (PostgreSQL 17.11)
Schema history table "public"."flyway_schema_history" does not exist yet
Successfully validated 2 migrations (execution time 00:00.015s)
Creating Schema History table "public"."flyway_schema_history" ...
Current version of schema "public": << Empty Schema >>
Migrating schema "public" to version "1 - crear cliente"
Migrating schema "public" to version "2 - renombrar telefono"
Successfully applied 2 migrations to schema "public", now at version v2 (execution time 00:00.019s)
Environment: default
Database: jdbc:postgresql:******** (PostgreSQL 17.11)
Environment: default
Database: jdbc:postgresql:******** (PostgreSQL 17.11)
Schema version: 2
+-----------+---------+--------------------+------+---------------------+---------+----------+
| Category  | Version | Description        | Type | Installed On        | State   | Undoable |
+-----------+---------+--------------------+------+---------------------+---------+----------+
| Versioned | 1       | crear cliente      | SQL  | 2026-10-22 13:12:43 | Success | No       |
| Versioned | 2       | renombrar telefono | SQL  | 2026-10-22 13:12:43 | Success | No       |
+-----------+---------+--------------------+------+---------------------+---------+----------+
```

Datos después de V2 (los teléfonos siguen ahí):

| id | nombre | celular |
|---|---|---|
| 1 | Ana | 70000001 |
| 2 | Luis | 70000002 |
| 3 | Rosa | NULL |

`flyway_schema_history`:

| installed_rank | version | description | type | script | success |
|---|---|---|---|---|---|
| 1 | 1 | crear cliente | SQL | V1__crear_cliente.sql | true |
| 2 | 2 | renombrar telefono | SQL | V2__renombrar_telefono.sql | true |

## Qué enseña

- Las herramientas que **generan** migraciones a partir del modelo comparan dos esquemas, y en un esquema no hay "renombres": hay una columna que falta y otra que sobra. Prisma (medido aquí) genera borrar + agregar. drizzle-kit, en cambio, pregunta en la terminal si la columna nueva es un renombre (no se ejecutó en esta demo porque la pregunta es interactiva). En todos los casos hay que **leer el SQL generado** antes de aplicarlo; Squawk en CI ayuda (M9).
- Las herramientas que **aplican** SQL escrito a mano (Flyway, Liquibase con SQL, golang-migrate) no se equivocan así, pero tampoco protegen: el SQL es responsabilidad de quien lo escribe.
- `RENAME COLUMN` es instantáneo (solo catálogo) pero toma `AccessExclusiveLock` (por eso el `lock_timeout`, ver M8) y rompe a las instancias de la aplicación que aún usan el nombre viejo durante un despliegue gradual: en producción se hace con expand/contract (columna nueva, escribir en ambas, rellenar, cambiar lecturas, borrar la vieja).
