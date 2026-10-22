# M9. Squawk sobre las migraciones de la demo

Salida real de `squawk 2.70.0` (paquete npm `squawk-cli`), con `--pg-version=17.0`, generada con `npm run squawk` el 2026-10-22.
Los archivos `.sql` se generan con `npm run sql` a partir de los mismos escenarios que se midieron en `results/ESCENARIOS.md`.

## Migraciones ingenuas

Código de salida 1. 31 avisos en total.

| Archivo:línea | Sentencia | Regla | Mensaje de Squawk |
|---|---|---|---|
| `M1.sql`:3 | `ALTER TABLE pedidos ADD COLUMN cupon text;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M2.sql`:3 | `ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_rand...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M2.sql`:3 | `ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_rand...` | `adding-field-with-default` | Adding a generated column requires a table rewrite with an `ACCESS EXCLUSIVE` lock. In Postgres versions 11+, non-VOLATILE DEFAULTs can be added without a rewrite. |
| `M3.sql`:3 | `ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M3.sql`:3 | `ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;` | `changing-column-type` | Changing a column type requires an `ACCESS EXCLUSIVE` lock on the table which blocks reads and writes while the table is rewritten. Changing the type of the column may also break other clients reading from the table. |
| `M4.sql`:3 | `CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);` | `require-concurrent-index-creation` | During normal index creation, table updates are blocked, but reads are still allowed. |
| `M4.sql`:3 | `CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow SHARE lock operations |
| `M5.sql`:3 | `ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M5.sql`:3 | `ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;` | `adding-not-nullable-field` | Setting a column `NOT NULL` blocks reads while the table is scanned. |
| `M6.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow SHARE ROW EXCLUSIVE lock operations |
| `M6.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (...` | `constraint-missing-not-valid` | By default new constraints require a table scan and block writes to the table while that scan occurs. |
| `M6.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (...` | `adding-foreign-key-constraint` | Adding a foreign key constraint requires a table scan and a `SHARE ROW EXCLUSIVE` lock on both tables, which blocks writes to each table. |
| `M7.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M7.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `prefer-bigint-over-smallint` | Using 16-bit integer fields can result in hitting the max `int` limit. |
| `M8.sql`:4 | `ALTER TABLE pedidos ADD COLUMN cupon text;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |

Además: `require-statement-timeout` ×8, `prefer-robust-stmts` ×8 (avisan en casi toda sentencia; ver el README).

## Migraciones seguras

Código de salida 1. 61 avisos en total.

| Archivo:línea | Sentencia | Regla | Mensaje de Squawk |
|---|---|---|---|
| `M2_constante.sql`:3 | `ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M2_constante.sql`:3 | `ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0;` | `prefer-bigint-over-int` | Using 32-bit integer fields can result in hitting the max `int` limit. |
| `M2_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN token uuid;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M2_segura.sql`:15 | `ALTER TABLE pedidos DROP CONSTRAINT token_no_nulo;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M3_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN id_nuevo bigint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M3_segura.sql`:18 | `ALTER TABLE pedidos ALTER COLUMN id DROP IDENTITY;` | `ban-alter-identity` | Changing column identity may break inserts from existing clients. |
| `M3_segura.sql`:19 | `ALTER TABLE pedidos DROP CONSTRAINT pedidos_pkey;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M3_segura.sql`:20 | `ALTER TABLE pedidos RENAME COLUMN id TO id_viejo;` | `renaming-column` | Renaming a column may break existing clients. |
| `M3_segura.sql`:21 | `ALTER TABLE pedidos RENAME COLUMN id_nuevo TO id;` | `renaming-column` | Renaming a column may break existing clients. |
| `M3_segura.sql`:22 | `ALTER TABLE pedidos ALTER COLUMN id SET NOT NULL;` | `adding-not-nullable-field` | Setting a column `NOT NULL` blocks reads while the table is scanned. |
| `M3_segura.sql`:24 | `ALTER TABLE pedidos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDE...` | `ban-alter-identity` | Changing column identity may break inserts from existing clients. |
| `M3_segura.sql`:26 | `ALTER TABLE pedidos DROP COLUMN id_viejo;` | `ban-drop-column` | Dropping a column may break existing clients. |
| `M3_segura.sql`:27 | `ALTER TABLE pedidos DROP CONSTRAINT id_nuevo_no_nulo;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M4_segura.sql`:3 | `CREATE INDEX CONCURRENTLY pedidos_producto_idx ON pedidos (producto...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow SHARE UPDATE EXCLUSIVE lock operations |
| `M5_segura.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT region_no_nula CHECK (region IS ...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M5_segura.sql`:9 | `ALTER TABLE pedidos DROP CONSTRAINT region_no_nula;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M6_segura.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow SHARE ROW EXCLUSIVE lock operations |
| `M7_segura-lotes-chicos.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M7_segura-lotes-chicos.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `prefer-bigint-over-smallint` | Using 16-bit integer fields can result in hitting the max `int` limit. |
| `M7_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M7_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `prefer-bigint-over-smallint` | Using 16-bit integer fields can result in hitting the max `int` limit. |

Además: `require-statement-timeout` ×10, `prefer-robust-stmts` ×30 (avisan en casi toda sentencia; ver el README).

## Migraciones seguras con `--assume-in-transaction`

Como si la herramienta de migraciones envolviera cada archivo en una transacción (lo que hace Flyway por defecto en Postgres).

Código de salida 1. 38 avisos en total.

| Archivo:línea | Sentencia | Regla | Mensaje de Squawk |
|---|---|---|---|
| `M2_constante.sql`:3 | `ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M2_constante.sql`:3 | `ALTER TABLE pedidos ADD COLUMN prioridad integer NOT NULL DEFAULT 0;` | `prefer-bigint-over-int` | Using 32-bit integer fields can result in hitting the max `int` limit. |
| `M2_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN token uuid;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M2_segura.sql`:11 | `ALTER TABLE pedidos VALIDATE CONSTRAINT token_no_nulo;` | `constraint-missing-not-valid` | Using `NOT VALID` and `VALIDATE CONSTRAINT` in the same transaction will block all reads while the constraint is validated. |
| `M2_segura.sql`:15 | `ALTER TABLE pedidos DROP CONSTRAINT token_no_nulo;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M3_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN id_nuevo bigint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M3_segura.sql`:11 | `CREATE UNIQUE INDEX CONCURRENTLY pedidos_id_nuevo_key ON pedidos (i...` | `ban-concurrent-index-creation-in-transaction` | While regular index creation can happen inside a transaction, this is not allowed when the `CONCURRENTLY` option is used. |
| `M3_segura.sql`:15 | `ALTER TABLE pedidos VALIDATE CONSTRAINT id_nuevo_no_nulo;` | `constraint-missing-not-valid` | Using `NOT VALID` and `VALIDATE CONSTRAINT` in the same transaction will block all reads while the constraint is validated. |
| `M3_segura.sql`:18 | `ALTER TABLE pedidos ALTER COLUMN id DROP IDENTITY;` | `ban-alter-identity` | Changing column identity may break inserts from existing clients. |
| `M3_segura.sql`:19 | `ALTER TABLE pedidos DROP CONSTRAINT pedidos_pkey;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M3_segura.sql`:20 | `ALTER TABLE pedidos RENAME COLUMN id TO id_viejo;` | `renaming-column` | Renaming a column may break existing clients. |
| `M3_segura.sql`:21 | `ALTER TABLE pedidos RENAME COLUMN id_nuevo TO id;` | `renaming-column` | Renaming a column may break existing clients. |
| `M3_segura.sql`:22 | `ALTER TABLE pedidos ALTER COLUMN id SET NOT NULL;` | `adding-not-nullable-field` | Setting a column `NOT NULL` blocks reads while the table is scanned. |
| `M3_segura.sql`:24 | `ALTER TABLE pedidos ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDE...` | `ban-alter-identity` | Changing column identity may break inserts from existing clients. |
| `M3_segura.sql`:26 | `ALTER TABLE pedidos DROP COLUMN id_viejo;` | `ban-drop-column` | Dropping a column may break existing clients. |
| `M3_segura.sql`:27 | `ALTER TABLE pedidos DROP CONSTRAINT id_nuevo_no_nulo;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M4_segura.sql`:3 | `CREATE INDEX CONCURRENTLY pedidos_producto_idx ON pedidos (producto...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow SHARE UPDATE EXCLUSIVE lock operations |
| `M5_segura.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT region_no_nula CHECK (region IS ...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M5_segura.sql`:5 | `ALTER TABLE pedidos VALIDATE CONSTRAINT region_no_nula;` | `constraint-missing-not-valid` | Using `NOT VALID` and `VALIDATE CONSTRAINT` in the same transaction will block all reads while the constraint is validated. |
| `M5_segura.sql`:9 | `ALTER TABLE pedidos DROP CONSTRAINT region_no_nula;` | `ban-drop-constraint` | Dropping a constraint may remove a guarantee that existing clients assume. |
| `M6_segura.sql`:3 | `ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (...` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow SHARE ROW EXCLUSIVE lock operations |
| `M6_segura.sql`:5 | `ALTER TABLE pedidos VALIDATE CONSTRAINT pedidos_cliente_fk;` | `constraint-missing-not-valid` | Using `NOT VALID` and `VALIDATE CONSTRAINT` in the same transaction will block all reads while the constraint is validated. |
| `M7_segura-lotes-chicos.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M7_segura-lotes-chicos.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `prefer-bigint-over-smallint` | Using 16-bit integer fields can result in hitting the max `int` limit. |
| `M7_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `require-lock-timeout` | Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations |
| `M7_segura.sql`:3 | `ALTER TABLE pedidos ADD COLUMN region_codigo smallint;` | `prefer-bigint-over-smallint` | Using 16-bit integer fields can result in hitting the max `int` limit. |

Además: `require-statement-timeout` ×10, `prefer-robust-stmts` ×2 (avisan en casi toda sentencia; ver el README).

## Salida de consola completa (ingenuas)

`npx squawk --pg-version=17.0 migraciones/ingenuas/*.sql`

```text
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M1.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD COLUMN cupon text;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: ACCESS EXCLUSIVE lock; blocking: reads, writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M1.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD COLUMN cupon text;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[prefer-robust-stmts]: Missing `IF NOT EXISTS`, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M1.sql:3:21
  │
3 │ ALTER TABLE pedidos ADD COLUMN cupon text;
  │                     ━━━━━━━━━━━━━━━━━━━━━
  ╭╴
3 │ ALTER TABLE pedidos ADD COLUMN if not exists cupon text;
  ╰╴                               +++++++++++++
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M2.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: ACCESS EXCLUSIVE lock; blocking: reads, writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M2.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[prefer-robust-stmts]: Missing `IF NOT EXISTS`, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M2.sql:3:21
  │
3 │ ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
  │                     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ╭╴
3 │ ALTER TABLE pedidos ADD COLUMN if not exists token uuid NOT NULL DEFAULT gen_random_uuid();
  ╰╴                               +++++++++++++
warning[adding-field-with-default]: Adding a generated column requires a table rewrite with an `ACCESS EXCLUSIVE` lock. In Postgres versions 11+, non-VOLATILE DEFAULTs can be added without a rewrite.
  ╭▸ migraciones\ingenuas\M2.sql:3:60
  │
3 │ ALTER TABLE pedidos ADD COLUMN token uuid NOT NULL DEFAULT gen_random_uuid();
  │                                                            ━━━━━━━━━━━━━━━━━
  │
  ╰ help: Add the column as nullable, backfill existing rows, and add a trigger to update the column on write instead.
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M3.sql:3:1
  │
3 │ ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: ACCESS EXCLUSIVE lock; blocking: reads, writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M3.sql:3:1
  │
3 │ ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[prefer-robust-stmts]: Missing transaction, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M3.sql:3:21
  │
3 │ ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;
  ╰╴                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━
warning[changing-column-type]: Changing a column type requires an `ACCESS EXCLUSIVE` lock on the table which blocks reads and writes while the table is rewritten. Changing the type of the column may also break other clients reading from the table.
  ╭▸ migraciones\ingenuas\M3.sql:3:37
  │
3 │ ALTER TABLE pedidos ALTER COLUMN id TYPE bigint;
  ╰╴                                    ━━━━━━━━━━━
warning[prefer-robust-stmts]: Missing `IF NOT EXISTS`, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M4.sql:3:1
  │
3 │ CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Use an explicit name for a concurrently created index
  ╭╴
3 │ CREATE INDEX if not exists pedidos_producto_idx ON pedidos (producto_id);
  ╰╴             +++++++++++++
warning[require-concurrent-index-creation]: During normal index creation, table updates are blocked, but reads are still allowed.
  ╭▸ migraciones\ingenuas\M4.sql:3:1
  │
3 │ CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Use `concurrently` to avoid blocking writes.
  ╭╴
3 │ CREATE INDEX concurrently pedidos_producto_idx ON pedidos (producto_id);
  ╰╴             ++++++++++++
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow SHARE lock operations
  ╭▸ migraciones\ingenuas\M4.sql:3:1
  │
3 │ CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: SHARE lock; blocking: writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M4.sql:3:1
  │
3 │ CREATE INDEX pedidos_producto_idx ON pedidos (producto_id);
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M5.sql:3:1
  │
3 │ ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: ACCESS EXCLUSIVE lock; blocking: reads, writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M5.sql:3:1
  │
3 │ ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[prefer-robust-stmts]: Missing transaction, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M5.sql:3:21
  │
3 │ ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
  ╰╴                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
warning[adding-not-nullable-field]: Setting a column `NOT NULL` blocks reads while the table is scanned.
  ╭▸ migraciones\ingenuas\M5.sql:3:41
  │
3 │ ALTER TABLE pedidos ALTER COLUMN region SET NOT NULL;
  │                                         ━━━━━━━━━━━━
  │
  ╰ help: Make the field nullable and use a `CHECK` constraint instead.
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow SHARE ROW EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M6.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: SHARE ROW EXCLUSIVE lock; blocking: writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M6.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[constraint-missing-not-valid]: By default new constraints require a table scan and block writes to the table while that scan occurs.
  ╭▸ migraciones\ingenuas\M6.sql:3:21
  │
3 │ ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
  │                     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ╰ help: Use `NOT VALID` with a later `VALIDATE CONSTRAINT` call.
warning[prefer-robust-stmts]: Missing transaction, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M6.sql:3:21
  │
3 │ ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
  ╰╴                    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
warning[adding-foreign-key-constraint]: Adding a foreign key constraint requires a table scan and a `SHARE ROW EXCLUSIVE` lock on both tables, which blocks writes to each table.
  ╭▸ migraciones\ingenuas\M6.sql:3:25
  │
3 │ ALTER TABLE pedidos ADD CONSTRAINT pedidos_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes (id);
  │                         ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ╰ help: Add `NOT VALID` to the constraint in one transaction and then VALIDATE the constraint in a separate transaction.
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M7.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: ACCESS EXCLUSIVE lock; blocking: reads, writes, schema changes.
  ╭╴
3 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M7.sql:3:1
  │
3 │ ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
3 + set statement_timeout = '5s';
  ╰╴
warning[prefer-robust-stmts]: Missing `IF NOT EXISTS`, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M7.sql:3:21
  │
3 │ ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
  │                     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ╭╴
3 │ ALTER TABLE pedidos ADD COLUMN if not exists region_codigo smallint;
  ╰╴                               +++++++++++++
warning[prefer-bigint-over-smallint]: Using 16-bit integer fields can result in hitting the max `int` limit.
  ╭▸ migraciones\ingenuas\M7.sql:3:46
  │
3 │ ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
  │                                              ━━━━━━━━
  │
  ├ help: Use 64-bit integer values instead to prevent hitting this limit.
  ╭╴
3 - ALTER TABLE pedidos ADD COLUMN region_codigo smallint;
3 + ALTER TABLE pedidos ADD COLUMN region_codigo bigint;
  ╰╴
warning[require-lock-timeout]: Missing `set lock_timeout` before potentially slow ACCESS EXCLUSIVE lock operations
  ╭▸ migraciones\ingenuas\M8.sql:4:1
  │
4 │ ALTER TABLE pedidos ADD COLUMN cupon text;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `lock_timeout` before this statement. Statement requires: ACCESS EXCLUSIVE lock; blocking: reads, writes, schema changes.
  ╭╴
4 + set lock_timeout = '1s';
  ╰╴
warning[require-statement-timeout]: Missing `set statement_timeout` before potentially slow operations
  ╭▸ migraciones\ingenuas\M8.sql:4:1
  │
4 │ ALTER TABLE pedidos ADD COLUMN cupon text;
  │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  │
  ├ help: Configure a `statement_timeout` before this statement
  ╭╴
4 + set statement_timeout = '5s';
  ╰╴
warning[prefer-robust-stmts]: Missing `IF NOT EXISTS`, the migration can't be rerun if it fails part way through.
  ╭▸ migraciones\ingenuas\M8.sql:4:21
  │
4 │ ALTER TABLE pedidos ADD COLUMN cupon text;
  │                     ━━━━━━━━━━━━━━━━━━━━━
  ╭╴
4 │ ALTER TABLE pedidos ADD COLUMN if not exists cupon text;
  ╰╴                               +++++++++++++

Find detailed examples and solutions for each rule at https://squawkhq.com/docs/rules
Found 31 issues in 8 files (checked 8 source files)
```
