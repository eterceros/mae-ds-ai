# Laboratorio de la sesión 9: importar datos sin romperse (mini-ETL)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 9 (viernes 30 de octubre de 2026)

- **En clase:** 45 minutos, después del bloque de integración con sistemas externos. Lo que no terminen en clase lo completan en casa.
- **Quién:** cada grupo. Elijan **una** opción: **A** (el CSV y el Postgres de esta carpeta) o **B** (datos de su propio producto).
- **Qué se hace:** parten de una **versión ingenua** de un importador (dada, en Node y en Python), escriben **su versión mejorada** y miden las dos con las mismas medidas.
- **Entrega:** el archivo `docs/laboratorios/importacion.md` en el repositorio del grupo, con el código de su versión mejorada en el mismo repositorio, hasta el **miércoles 11 de noviembre, 23:59**. La plantilla está al final de esta página.
- **Sin IA.** Este laboratorio se hace a mano: sin asistentes de IA, ni para escribir el importador ni para leer los resultados. La idea es que cada uno vea dónde se rompe una carga de datos y por qué.

## Antes de empezar

Dos palabras primero:

- **ETL** (*extract, transform, load*): sacar datos de una fuente (aquí un archivo CSV), revisarlos y transformarlos, y cargarlos en la base de datos. «Mini-ETL» porque es el que vive dentro de un backend (un script o un comando de su servicio), no una plataforma de datos.
- **Idempotente**: ejecutarlo dos veces deja la base igual que ejecutarlo una vez. Si el import se cae a la mitad, o alguien lo vuelve a lanzar con el mismo archivo, no aparecen filas repetidas ni cambios falsos.
- **Upsert**: «insertar o, si ya existe, actualizar», en una sola sentencia. En Postgres: `INSERT … ON CONFLICT (columna_única) DO UPDATE …` (o `DO NOTHING`). Necesita una clave única que identifique la fila; aquí, el id que viene del sistema de origen (`external_id`).
- **Tabla intermedia** (*staging*): una tabla donde se cargan primero los datos tal como vienen, para validarlos y pasarlos después a la tabla final con una sola sentencia.

Necesitan:

- **Docker** Desktop (Windows o macOS) o Docker Engine (Linux): `docker version` debe mostrar **Client** y **Server**. Solo se usa para Postgres.
- **Node 24** (la versión del curso; ejecuta TypeScript directamente con `node archivo.ts`) **o** **Python 3.10 o superior**. Basta uno de los dos; elijan el lenguaje de su backend.
- El puerto **18450** libre en su máquina (Postgres de este laboratorio).

Sobre los comandos: los bloques valen igual en **PowerShell** (Windows), **Terminal** (macOS) y cualquier shell de Linux, salvo donde se indica. En macOS y Linux el intérprete suele llamarse `python3`; en Windows, `python` (o `py`). Donde dice `python`, usen el suyo.

## Qué hay en esta carpeta

| Archivo | Qué es |
|---|---|
| [`compose.yaml`](compose.yaml) | Postgres 17.11 (proyecto Compose `s09-lab`) en `127.0.0.1:18450`, usuario `postgres`, contraseña `lab`, base `lab`. Crea la tabla al arrancar por primera vez. |
| [`sql/schema.sql`](sql/schema.sql) | La tabla final `enrollments` (inscripciones a cursos), con **clave única por `external_id`** y restricciones `CHECK` (correo con `@`, monto no negativo, nombre no vacío, código de curso). |
| [`node/generate.ts`](node/generate.ts) y [`python/generate.py`](python/generate.py) | Generador del CSV con **semilla fija**. Los dos producen **exactamente el mismo archivo** (mismos bytes). No necesitan paquetes. |
| [`node/import-naive.ts`](node/import-naive.ts) y [`python/import_naive.py`](python/import_naive.py) | La **versión ingenua** del importador. Cada punto débil está marcado con `// PROBLEMA:` o `# PROBLEMA:`. Al final imprime tiempo, memoria máxima y filas. |
| [`python/peak_memory.py`](python/peak_memory.py) | Función `peak_rss_mb()` para medir la memoria máxima del proceso en Python (Windows, macOS y Linux, sin paquetes). |
| `data/` | Ahí se escriben los CSV generados (no se suben al repositorio). |

El CSV tiene estas columnas:

```
external_id,student_name,email,course_code,enrolled_on,amount
INS-0000001,Tania Mamani Medina,tania.mamani57@example.edu,GES-160,2026-01-10,305.00
```

Con los valores por omisión (50 000 filas, semilla 2026) trae, a propósito, **1484 filas inválidas** (≈ 3 %) de cinco tipos y **501 filas repetidas** (≈ 1 %) por `external_id`:

| Tipo | Filas | Ejemplo |
|---|---:|---|
| Fecha mal escrita | 302 | `26/08/2026`, `2026-02-30`, `2026-13-08`, `2026/08/26` |
| Correo inválido | 277 | sin `@`, `nombre@` sin dominio, `@@` |
| Monto negativo | 293 | `-305.00` |
| Campo vacío | 284 | nombre, correo, curso, fecha o monto vacío |
| Columnas de más | 328 | `Zeballos Vargas, Olga` (una coma sin comillas dentro del nombre: 7 columnas) |
| Repetida por `external_id` | 501 | la mitad, copia exacta de una fila anterior; la otra mitad, el mismo id con otro monto (una «corrección») |

El generador imprime este resumen al terminar, para que puedan comprobar sus cuentas.

---

## Paso 1: levantar Postgres

Desde esta carpeta (`m8/laboratorio-s09/`):

```
docker compose up -d --wait
docker compose exec postgres psql -U postgres -d lab -c "\d enrollments"
```

Deben ver la tabla con la restricción `enrollments_external_id_key`. Para vaciar la tabla entre pruebas:

```
docker compose exec postgres psql -U postgres -d lab -c "TRUNCATE enrollments"
```

## Paso 2: instalar el lenguaje que van a usar y generar el CSV

**Node:**

```
cd node
npm install
node generate.ts
node generate.ts --clean
node generate.ts --rows 500000 --out ../data/enrollments-500k.csv
```

**Python** (con un entorno virtual, para no instalar nada en el Python del sistema):

```
cd python
python -m venv .venv
```

Actívenlo: en PowerShell `.venv\Scripts\Activate.ps1` (si PowerShell no permite ejecutar scripts: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, una sola vez); en macOS, Linux o Git Bash `source .venv/bin/activate` (en Git Bash: `source .venv/Scripts/activate`). Luego:

```
pip install -r requirements.txt
python generate.py
python generate.py --clean
python generate.py --rows 500000 --out ../data/enrollments-500k.csv
```

Quedan tres archivos en `data/`:

| Archivo | Filas | Para qué |
|---|---:|---|
| `enrollments.csv` | 50 000 | el archivo «real», con inválidas y repetidas |
| `enrollments-clean.csv` | 50 000 | sin inválidas ni repetidas: mide la velocidad pura y la segunda ejecución |
| `enrollments-500k.csv` | 500 000 | diez veces más grande: muestra cómo crece la memoria |

Comprueben que su archivo es idéntico al de todos (huella SHA-256):

```
Get-FileHash ..\data\enrollments.csv          # PowerShell
shasum -a 256 ../data/enrollments.csv         # macOS
sha256sum ../data/enrollments.csv             # Linux o Git Bash
```

| Archivo | SHA-256 |
|---|---|
| `enrollments.csv` | `c96f4f9a4264f2898b585f3332c8f49c344d9519611409aab0183e168ca52922` |
| `enrollments-clean.csv` | `9d269f5cbce4ca183f1a0c55a63985a61f20e07ff373a834e85bebbfad3b76f4` |
| `enrollments-500k.csv` | `469ae29b5541dee3bf0f911845070d0d0c7891afc7e6099c0aa0317f4584ac72` |

(`Get-FileHash` lo muestra en mayúsculas; es el mismo valor.)

## Paso 3: ejecutar la versión ingenua

Lean primero el código y los comentarios `PROBLEMA:`. Después, con la tabla vacía, ejecuten estas cuatro corridas en orden (en `node/` con `node import-naive.ts`, o en `python/` con `python import_naive.py`):

```
node import-naive.ts                                  # 1. el archivo real
node import-naive.ts ../data/enrollments-clean.csv    # 2. el archivo limpio
node import-naive.ts ../data/enrollments-clean.csv    # 3. el mismo archivo otra vez
node import-naive.ts ../data/enrollments-500k.csv     # 4. el grande (memoria)
```

Anoten la salida de cada una: la van a poner en el entregable.

Si su Postgres no está en `127.0.0.1:18450` (por ejemplo, en la opción B), definan la variable `DATABASE_URL` antes de ejecutar: `$env:DATABASE_URL = "postgres://usuario:clave@host:puerto/base"` en PowerShell, `export DATABASE_URL=...` en macOS o Linux.

## Qué van a ver con la versión ingenua

Medido en la máquina del docente (una corrida por caso; es una referencia, no un resultado: midan en la suya).

| Corrida | Node | Python | Qué pasó |
|---|---|---|---|
| 1. `enrollments.csv` (tabla vacía) | 41 INSERT ejecutados, falla en la línea 43; **0 filas** en la tabla; 0,14 s; 106 MB | igual: falla en la línea 43, **0 filas**; 0,31 s; 78 MB | `date/time field value out of range: "26/08/2026"`. La primera fila mala aborta la transacción y se deshacen también las 41 buenas. El error no dice nada de las otras 1483 inválidas ni de las 501 repetidas: hay que corregir y volver a intentar, una por una. |
| 2. `enrollments-clean.csv` (tabla vacía) | **50 000 filas**, COMMIT; **54,7 s**; 144 MB | **50 000 filas**, COMMIT; **125,9 s**; 79 MB | Funciona, pero lento: 50 000 idas y vueltas a la base, una por fila (≈ 1,1 ms por fila en Node). |
| 3. `enrollments-clean.csv` otra vez | falla en la primera fila; siguen 50 000 filas | igual | `duplicate key value violates unique constraint "enrollments_external_id_key"`. Volver a ejecutar el mismo import **falla** en vez de no hacer nada. Sin esa clave única, habría **duplicado las 50 000 filas** en silencio. |
| 4. `enrollments-500k.csv` | falla en la primera fila (ya estaban las de la corrida 2); **390 MB** de memoria máxima | igual; **418 MB** | Antes de insertar nada, leer el archivo entero (más las copias de `split`) ya ocupa **3,7 veces** (Node) y **5,4 veces** (Python) el pico con el archivo de 50 000 (corrida 1). La memoria crece con el archivo. |

Además, cosas que **no** se ven en la salida pero están ahí:

- **Postgres acepta algunas fechas «mal escritas».** Con la configuración por omisión (`DateStyle = ISO, MDY`), `2026/03/05` se lee como 5 de marzo y `05/03/2026` como **3 de mayo** (mes primero). En `enrollments.csv` hay 108 fechas con barras que la base aceptaría sin error: 74 en formato `AAAA/MM/DD` y 34 en formato `DD/MM/AAAA` con el día ≤ 12, que se cargarían **con el mes y el día cambiados** (las otras 45 `DD/MM/AAAA` sí dan error). Dejar la validación a la base de datos no alcanza.
- **Las filas con columnas de más** se cortan a 6 columnas (`slice(0, 6)` / `r[:6]`) sin aviso: con `Zeballos Vargas, Olga` el apellido queda como nombre, `" Olga"` como correo, el correo como curso y el curso como fecha. Aquí la base la rechaza porque `API-201` no es una fecha; si la columna de más cayera en otro lugar, o la tabla no tuviera tipos y restricciones estrictos, la fila se cargaría corrida.
- **Las 501 repetidas**: si las inválidas no detuvieran la carga, la primera repetida la detendría igual (clave única). El archivo no dice cuál de las dos versiones es la buena: lo deciden ustedes.

Banco de pruebas: Intel Core i9-12900H, 64 GB de RAM, Windows 11, Docker Desktop 4.96.1 (WSL2), Postgres 17.11 en contenedor. Node 24.19.0 con `pg` 8.23.1, ejecutado en Windows. Python 3.14.9 con `psycopg` 3.3.6, ejecutado **dentro de un contenedor** `python:3.14-slim` (Linux) que llega a Postgres por `host.docker.internal`; esa ruta de red agrega latencia por fila, así que el tiempo de Python **no** es comparable con el de Node. Ustedes midan los dos lados (ingenua y mejorada) **en las mismas condiciones**.

---

## Paso 4: escribir la versión mejorada

Escríbanla en un archivo nuevo (por ejemplo `import-better.ts` o `import_better.py`) en el repositorio del grupo, en el mismo lenguaje que la ingenua que eligieron. No modifiquen la ingenua: la necesitan para comparar. Pueden agregar tablas (intermedia, de rechazados, de corridas) en su propio archivo SQL.

Lo que tiene que lograr (cómo lo logran lo deciden ustedes y lo explican en el entregable):

1. **Leer por partes**, sin cargar el archivo entero en memoria (*streaming*): la memoria máxima con 500 000 filas tiene que quedar parecida a la de 50 000.
2. **Leer CSV de verdad**: comillas, número de columnas, encabezado esperado. En Python, el módulo `csv` de la biblioteca estándar; en Node, un lector de CSV (por ejemplo `csv-parse`) o uno propio sobre `readline`, justificando por qué alcanza.
3. **Validar cada fila** antes de tocar la base: fecha en formato `AAAA-MM-DD` y existente, correo con forma válida, monto numérico y no negativo, campos obligatorios no vacíos, código de curso con el formato de la tabla.
4. **No detenerse por una fila mala**: las filas inválidas van a un **archivo de rechazados** con el número de línea, el valor original y el **motivo**; las buenas se cargan.
5. **Decidir qué hacer con las repetidas** (dentro del archivo y respecto de lo que ya está en la base) y aplicarlo de forma consistente: por ejemplo, «gana la última aparición del archivo». Escriban la regla en el entregable.
6. **Cargar por lotes** (por ejemplo, de 1000 filas), no fila por fila: `INSERT` de varias filas a la vez, o `COPY` a una tabla intermedia y de ahí a la final.
7. **Upsert idempotente** contra la clave única `external_id`: **ejecutar dos veces el mismo archivo no cambia nada** la segunda vez (ni filas nuevas, ni `updated_at` tocado en filas que no cambiaron).
8. **Transacciones del tamaño adecuado**: decidan si una transacción por lote o una sola al final (con tabla intermedia) y expliquen qué pasa si el proceso se cae a la mitad y lo vuelven a lanzar.
9. **Imprimir un resumen**: filas leídas, cargadas (insertadas y actualizadas por separado), sin cambios, rechazadas por motivo, repetidas, tiempo y memoria máxima.

Relación con sesiones anteriores: la clave única y el cambio de esquema siguen las reglas de migraciones de la S06; la idempotencia es la misma idea del consumidor idempotente de la S08, aplicada a un archivo en vez de a mensajes.

La demo del docente ([`../demo-integracion/`](../demo-integracion/), escenario I2) se muestra en clase con sus cifras. Úsenla para comparar resultados, no para copiar código: su versión tiene que poder explicarla línea por línea.

## Qué medir

Midan **la ingenua y la mejorada**, con los mismos archivos y en la misma máquina. Para el tiempo, al menos **3 corridas** de cada una y reporten la mediana (para la ingenua con el archivo limpio basta 1 si tarda mucho; díganlo).

| Medida | Cómo |
|---|---|
| **Tiempo total** | Dentro del programa, desde antes de abrir el archivo hasta después del último `COMMIT`: `performance.now()` en Node, `time.perf_counter()` en Python (así lo hace la ingenua). |
| **Memoria máxima** | Ver la sección siguiente. Con `enrollments.csv` y con `enrollments-500k.csv`. |
| **Filas cargadas** | Lo que informa su programa (insertadas / actualizadas) y comprobado en la base: `SELECT count(*), count(DISTINCT external_id) FROM enrollments;` (los dos números deben coincidir). |
| **Filas rechazadas** | Por motivo, desde su archivo de rechazados. Comparen con el resumen del generador. |
| **Filas repetidas** | Cuántas encontró su programa y qué hizo con ellas. |
| **Segunda ejecución** | Ejecuten otra vez con el mismo archivo, sin vaciar la tabla. Deben salir 0 insertadas y 0 actualizadas, y la base igual: `SELECT count(*), max(updated_at) FROM enrollments;` antes y después. |
| **Caída a la mitad** (opcional) | Corten el proceso con Ctrl+C a mitad de la carga, vuelvan a lanzarlo y comprueben que el resultado final es el mismo que sin la caída. |

### Cómo medir la memoria

Se mide la **memoria residente máxima** (*peak RSS*): lo más alto que llegó a ocupar el proceso en RAM durante toda la ejecución. Una sola lectura al final no sirve si el pico fue a la mitad; por eso se usa el máximo que guarda el sistema operativo.

**Node:**

- `process.resourceUsage().maxRSS` devuelve el máximo en **kilobytes** (funciona en Windows, macOS y Linux). Es lo que imprime la ingenua: `process.resourceUsage().maxRSS / 1024` en MB.
- `process.memoryUsage()` da el valor **actual** (`rss`, y `heapUsed`, que es solo la memoria de objetos de JavaScript). Sirve para ver cómo cambia durante la carga, no para el máximo.

**Python:**

- `from peak_memory import peak_rss_mb` (archivo de esta carpeta) y `print(peak_rss_mb())` al final. Por dentro usa `resource.getrusage` en macOS y Linux (ojo: `ru_maxrss` viene en **bytes** en macOS y en **kilobytes** en Linux) y `GetProcessMemoryInfo` en Windows (el módulo `resource` no existe en Windows).
- `tracemalloc` (biblioteca estándar) mide solo la memoria que pidió el código Python, sin el intérprete ni el driver: `tracemalloc.start()` al principio y `tracemalloc.get_traced_memory()[1]` (el pico, en bytes) al final. Sirve para ver qué parte del pico es de sus datos. Hace el programa más lento: no midan el tiempo en la misma corrida.

**Desde fuera del programa** (para comprobar, en cualquier lenguaje):

- Linux: `/usr/bin/time -v node import-better.ts` → línea `Maximum resident set size (kbytes)`.
- macOS: `/usr/bin/time -l python import_better.py` → línea `maximum resident set size` (en bytes).
- Windows: no hay un equivalente directo en PowerShell; usen la medición dentro del programa.

---

## Opción B: con datos de su propio producto

En vez de inscripciones, importen una entidad de **su** proyecto (productos, clientes, pedidos, turnos…) desde un CSV.

1. Escriban un generador con **semilla fija** (pueden adaptar `generate.ts` o `generate.py`) que produzca al menos **50 000 filas** y **500 000** para la prueba de memoria, con los mismos tipos de errores: ≈ 3 % inválidas (al menos fecha mal escrita, un campo con formato inválido, un número fuera de rango, campo vacío y columnas de más) y ≈ 1 % repetidas por el id externo.
2. La tabla destino es la de su producto, con una **clave única** por el id que viene del sistema de origen. Si no la tiene, agréguenla con una **migración** (S06), no a mano.
3. Usen como versión ingenua un importador equivalente al de esta carpeta (todo en memoria, fila por fila, una transacción), adaptado a su tabla, y midan las dos versiones igual que en la opción A.
4. Pueden usar el Postgres de este `compose.yaml` o el de su propio `compose.yaml` (la actividad 7). Anoten cuál.

---

## Bajar todo

```
docker compose down -v
```

(`-v` borra también el volumen con los datos de Postgres; la próxima vez la tabla se crea de nuevo, vacía.)

---

## Plantilla del entregable: `docs/laboratorios/importacion.md`

Copien esto en su repositorio y complétenlo.

```markdown
# Laboratorio S09: importar datos sin romperse

- Integrantes:
- Opción: A (CSV de inscripciones del docente) / B (datos de nuestro producto: entidad ...)
- Lenguaje y versión: Node ... (driver `pg` ...) / Python ... (driver `psycopg` ...)
- Código de la versión mejorada: `ruta/al/archivo`
- Fecha:
- Máquina: procesador, RAM, sistema operativo, Docker (versión), Postgres (versión)

## Lo que hace la versión ingenua
(Salida de las cuatro corridas del paso 3, tal cual. En dos o tres líneas: qué falló y por qué.)

## Antes y después

Archivo de 50 000 filas, salvo donde se indica. Tiempo: mediana de N corridas.

| Medida | Ingenua | Mejorada | Cómo se midió |
|---|---:|---:|---|
| Tiempo con `enrollments.csv` | | | |
| Tiempo con el archivo limpio | | | |
| Memoria máxima, 50 000 filas | | | |
| Memoria máxima, 500 000 filas | | | |
| Filas cargadas (insertadas / actualizadas) | | | |
| Filas rechazadas (total) | | | |
| Filas repetidas encontradas | | | |
| Segunda ejecución: insertadas / actualizadas | | | |
| Segunda ejecución: ¿la base quedó igual? | | | consulta usada: |
| Filas en la tabla al final (`count(*)` / `count(DISTINCT external_id)`) | | | |

### Rechazadas por motivo

| Motivo | Filas | Ejemplo (línea y valor) |
|---|---:|---|
| | | |

## Decisiones
- Lectura por partes: cómo (lector de CSV, tamaño de lote).
- Validación: qué reglas y dónde (programa / base de datos).
- Repetidas: qué regla usamos y por qué.
- Carga: INSERT de varias filas / COPY / tabla intermedia; upsert (`ON CONFLICT ...`) y cómo evitamos actualizar filas que no cambiaron.
- Transacciones: tamaño, y qué pasa si el proceso se cae a la mitad.

## Qué no medimos o no resolvimos
(Lo que quedó fuera, lo que no les convenció, lo que cambiaría con un archivo diez veces más grande.)

## Comandos usados
(Los comandos tal como los ejecutaron, en orden.)
```
