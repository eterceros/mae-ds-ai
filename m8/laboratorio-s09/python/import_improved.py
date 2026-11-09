"""IMPORTADOR MEJORADO (solución del docente del laboratorio S09). Compárenlo con import_naive.py:
cada «CORRECCIÓN:» de este archivo responde a un «PROBLEMA:» de la ingenua.

    python import_improved.py                                 -> ../data/enrollments.csv
    python import_improved.py ../data/enrollments-500k.csv
    python import_improved.py <csv> <archivo-de-rechazados.csv>
    DATABASE_URL=postgresql://... python import_improved.py

Cómo trabaja, en tres fases:
  1. Lee el CSV por partes, valida cada fila y escribe las válidas en la tabla intermedia
     (enrollments_staging) en lotes de BATCH filas; las inválidas van al archivo de rechazados.
  2. Pasa de la intermedia a la final (enrollments) en lotes de BATCH external_id, con un upsert
     idempotente; cada lote es una transacción.
  3. Borra la intermedia de esta corrida, anota las cuentas en import_runs e imprime el resumen.

Regla de repetidas: si un external_id aparece varias veces en el archivo, GANA LA ÚLTIMA APARICIÓN
(la línea más alta), porque en este archivo la repetición con otro monto es una «corrección».
Frente a lo que ya está en la base: si los datos son iguales no se toca la fila; si cambiaron, se actualiza.

Dependencias: solo psycopg (la que ya declara requirements.txt). El CSV se lee con el módulo csv
de la biblioteca estándar.
"""
import csv
import datetime
import os
import re
import sys
import time
from collections import deque
from pathlib import Path

import psycopg

from peak_memory import peak_rss_mb

HERE = Path(__file__).resolve().parent
FILE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "data" / "enrollments.csv"
REJECTS = (Path(sys.argv[2]).resolve() if len(sys.argv) > 2
           else HERE.parent / "results" / f"rechazados-{FILE.stem}-python.csv")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:lab@127.0.0.1:18450/lab")
try:
    BATCH = int(os.environ.get("BATCH", "1000"))
except ValueError:
    BATCH = 0
if BATCH <= 0:
    sys.exit(f"BATCH debe ser un entero mayor que 0 (vino: {os.environ.get('BATCH')})")
HEADER = ["external_id", "student_name", "email", "course_code", "enrolled_on", "amount"]
# Una comilla sin cerrar no puede tragarse el resto del archivo: si la fila sigue abierta tras
# MAX_RECORD_LINES líneas (o llega el final del archivo, o el campo pasa el límite del módulo csv),
# se rechaza SOLO su primera línea y las siguientes se vuelven a leer como filas normales.
MAX_RECORD_LINES = 20

t0 = time.perf_counter()

# ---------------------------------------------------------------------------------------------
# Validación
# ---------------------------------------------------------------------------------------------

# [0-9] y no \d: en Python \d acepta también dígitos de otros alfabetos (por ejemplo, «٣»).
RE_ID = re.compile(r"INS-[0-9]{7}")
RE_EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")      # la misma forma que el CHECK de la tabla
RE_COURSE = re.compile(r"[A-Z]{2,4}-[0-9]{3}")           # el mismo formato que el CHECK de la tabla
RE_DATE = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
RE_AMOUNT = re.compile(r"-?[0-9]+(\.[0-9]{1,2})?")


def is_iso_date(s: str) -> bool:
    """AAAA-MM-DD y una fecha que exista (2026-02-30 y 2026-13-08 no existen)."""
    m = RE_DATE.fullmatch(s)   # fullmatch: «$» de re aceptaría un salto de línea al final
    if not m:
        return False
    try:
        datetime.date(int(m[1]), int(m[2]), int(m[3]))
    except ValueError:
        return False
    return True


def validate(fields: list[str], line: int):
    """Devuelve (fila, None, None) si es válida, o (None, motivo, detalle) si no.

    CORRECCIÓN (no valida nada; la base lo descubre con un error genérico y sin línea): cada fila se
    valida aquí, antes de tocar la base, y la que no pasa devuelve un motivo corto y estable (para
    contar) y un detalle legible (para quien corrige el archivo). No se valida con la base porque
    Postgres acepta 2026/03/05 y lee 05/03/2026 como 3 de mayo (DateStyle = ISO, MDY).
    CORRECCIÓN (r[:6] descarta columnas de más en silencio): una fila con otro número de columnas se
    rechaza entera; no se intenta adivinar qué campo se corrió.
    """
    if len(fields) != len(HEADER):
        return None, "numero_de_columnas", f"se esperaban {len(HEADER)} columnas y hay {len(fields)}"
    values = [f.strip() for f in fields]
    external_id, student_name, email, course_code, enrolled_on, amount = values
    for name, value in zip(HEADER, values):
        if value == "":
            return None, "campo_vacio", f"{name} vacío"
    if not RE_ID.fullmatch(external_id):
        return None, "external_id_invalido", f"external_id con formato inválido: {external_id}"
    if not RE_EMAIL.fullmatch(email):
        return None, "correo_invalido", f"correo con formato inválido: {email}"
    if not RE_COURSE.fullmatch(course_code):
        return None, "curso_invalido", f"código de curso inválido: {course_code}"
    if not is_iso_date(enrolled_on):
        return None, "fecha_invalida", f"fecha inválida (se espera AAAA-MM-DD existente): {enrolled_on}"
    if not RE_AMOUNT.fullmatch(amount):
        return None, "monto_invalido", f"monto no numérico: {amount}"
    if amount.startswith("-"):
        return None, "monto_negativo", f"monto negativo: {amount}"
    if float(amount) >= 1e8:
        return None, "monto_fuera_de_rango", f"monto mayor que numeric(10,2): {amount}"
    return (line, external_id, student_name, email, course_code, enrolled_on, amount), None, None


def csv_field(s: str) -> str:
    return '"' + s.replace('"', '""') + '"' if re.search(r'[",\r\n]', s) else s


# ---------------------------------------------------------------------------------------------
# Lectura
# ---------------------------------------------------------------------------------------------

class UnclosedQuote(Exception):
    """La fila en curso abrió una comilla y no la cerró a tiempo."""


class Lines:
    """Las líneas físicas del archivo, una por vez, para csv.reader.

    Anota qué líneas tomó la fila en curso (`taken`, con su número), corta la fila si pasa de
    MAX_RECORD_LINES o si el archivo termina con la comilla abierta (UnclosedQuote), y permite
    devolver líneas (`push_back`) para volver a leerlas.
    """

    def __init__(self, f):
        self.f = f
        self.back: deque[tuple[int, str]] = deque()
        self.line_no = 0
        self.taken: list[tuple[int, str]] = []

    def __iter__(self):
        return self

    def __next__(self) -> str:
        if len(self.taken) >= MAX_RECORD_LINES:
            raise UnclosedQuote
        if self.back:
            item = self.back.popleft()
        else:
            text = next(self.f, "")
            if text == "":
                if self.taken:          # el reader pidió otra línea a mitad de fila: comilla abierta
                    raise UnclosedQuote
                raise StopIteration
            self.line_no += 1
            item = (self.line_no, text)
        self.taken.append(item)
        return item[1]

    def push_back(self, items):
        self.back.extendleft(reversed(items))


def read_csv(f):
    """Devuelve (línea donde EMPIEZA la fila, campos o None, texto original) por cada fila.

    campos None = comilla sin cerrar: se entrega solo la primera línea de la fila y las demás se
    vuelven a leer desde cero con un csv.reader nuevo, así una comilla suelta no se lleva filas válidas.
    """
    lines = Lines(f)
    reader = csv.reader(lines)
    while True:
        lines.taken = []
        try:
            fields = next(reader)
        except StopIteration:
            return
        except (UnclosedQuote, csv.Error):   # csv.Error: p. ej., un campo más largo que el límite del módulo
            (first_no, first_text), *rest = lines.taken
            lines.push_back(rest)
            reader = csv.reader(lines)        # el reader anterior quedó a mitad de fila
            yield first_no, None, first_text.rstrip("\r\n")
            continue
        yield lines.taken[0][0], fields, None


# ---------------------------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------------------------

# CORRECCIÓN (un INSERT por fila = 50 000 idas y vueltas): un solo INSERT por lote de BATCH filas, que
# recibe siete listas (psycopg las envía como arreglos) y las convierte en filas con unnest. Cada INSERT
# es su propia transacción (autocommit): si el proceso muere aquí, la tabla final no cambió y la
# intermedia se descarta al relanzar.
STAGE = """
INSERT INTO enrollments_staging (run_id, line, external_id, student_name, email, course_code, enrolled_on, amount)
SELECT %s, * FROM unnest(%s::int[], %s::text[], %s::text[], %s::text[], %s::text[], %s::date[], %s::numeric[])
"""

# CORRECCIÓN (INSERT sin ON CONFLICT: repetir el import falla o duplica): upsert idempotente desde la
# intermedia, de a BATCH external_id por transacción, recorridos en orden (keyset: «los siguientes
# después del último que procesé»).
#  - DISTINCT ON (external_id) ... ORDER BY external_id, line DESC: una fila por id, la última del
#    archivo (la regla de repetidas). Como se deduplica sobre TODA la corrida y no por lote de lectura,
#    una repetida que cae en otro lote no hace que la segunda ejecución «corrija» y «descorrija».
#    Además evita «ON CONFLICT DO UPDATE command cannot affect row a second time».
#  - ON CONFLICT (external_id) DO UPDATE: si ya existe, se actualiza; nunca se duplica.
#  - WHERE ... IS DISTINCT FROM ...: si los datos son iguales no se escribe nada (ni updated_at), así
#    la segunda ejecución da 0 insertadas y 0 actualizadas.
#  - RETURNING (xmax = 0): true = insertada, false = actualizada (truco conocido de Postgres, no
#    documentado como contrato; alternativa: contar antes y después).
MERGE = """
WITH src AS (
  SELECT DISTINCT ON (external_id) external_id, student_name, email, course_code, enrolled_on, amount
    FROM enrollments_staging
   WHERE run_id = %(run)s AND external_id > %(last)s
   ORDER BY external_id, line DESC
   LIMIT %(batch)s
), up AS (
  INSERT INTO enrollments AS e (external_id, student_name, email, course_code, enrolled_on, amount)
  SELECT external_id, student_name, email, course_code, enrolled_on, amount FROM src
  ON CONFLICT (external_id) DO UPDATE
     SET student_name = EXCLUDED.student_name, email = EXCLUDED.email, course_code = EXCLUDED.course_code,
         enrolled_on = EXCLUDED.enrolled_on, amount = EXCLUDED.amount, updated_at = now()
   WHERE (e.student_name, e.email, e.course_code, e.enrolled_on, e.amount)
         IS DISTINCT FROM (EXCLUDED.student_name, EXCLUDED.email, EXCLUDED.course_code, EXCLUDED.enrolled_on, EXCLUDED.amount)
  RETURNING (xmax = 0) AS ins
)
SELECT (SELECT count(*) FROM src)::int            AS keys,
       (SELECT max(external_id) FROM src)         AS last_key,
       (SELECT count(*) FROM up WHERE ins)::int     AS inserted,
       (SELECT count(*) FROM up WHERE NOT ins)::int AS updated
"""

DUPLICATES = """
SELECT count(*)::int AS ids, coalesce(sum(n - 1), 0)::int AS extra_rows,
       count(*) FILTER (WHERE versions > 1)::int AS ids_different
  FROM (SELECT external_id, count(*) AS n,
               count(DISTINCT (student_name, email, course_code, enrolled_on, amount)) AS versions
          FROM enrollments_staging WHERE run_id = %s
         GROUP BY external_id HAVING count(*) > 1) t
"""


def stage_batch(conn, run_id, rows):
    cols = list(zip(*rows))   # de filas a columnas: (lines, ids, names, ...)
    conn.execute(STAGE, [run_id, *[list(c) for c in cols]])


# ---------------------------------------------------------------------------------------------
# Programa
# ---------------------------------------------------------------------------------------------

# CORRECCIÓN (supone el encabezado sin comprobarlo): se lee la primera fila ANTES de conectarse y de
# anotar la corrida en import_runs. Si las columnas no son las esperadas o vienen en otro orden, se
# detiene sin tocar la base, en vez de rechazar 50 000 filas una por una.
with open(FILE, newline="", encoding="utf-8-sig") as f:
    header = [h.strip() for h in next(csv.reader(f), [])]
if header != HEADER:
    sys.exit(f"encabezado inesperado en la línea 1: {','.join(header)}")

with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
    conn.execute((HERE.parent / "sql" / "staging.sql").read_text(encoding="utf-8"))

    # Una sola carga a la vez: con dos cargas simultáneas no se duplicarían filas (lo impide la clave
    # única), pero se esperarían entre ellas y se mezclarían sus cuentas. El candado dura lo que la conexión.
    if not conn.execute("SELECT pg_try_advisory_lock(hashtext('s09-enrollments-import'))").fetchone()[0]:
        sys.exit("Hay otra carga en curso (candado tomado). Esperen a que termine.")
    # Con el candado tomado nadie más está cargando: lo que haya en la intermedia es de una corrida que
    # se cayó o se cortó, y se descarta (la tabla final no depende de eso; ver la fase 2).
    conn.execute("TRUNCATE enrollments_staging")
    run_id = conn.execute("INSERT INTO import_runs (file, tool) VALUES (%s, 'python') RETURNING id",
                          [str(FILE)]).fetchone()[0]

    # ----- Fase 1: leer, validar, rechazar o poner en la intermedia -----
    read = valid = rejected = staged_batches = merged_batches = 0
    by_reason: dict[str, int] = {}
    batch = []
    REJECTS.parent.mkdir(parents=True, exist_ok=True)

    # CORRECCIÓN (lee el archivo ENTERO / tres copias): el archivo se recorre fila por fila; en memoria
    # hay un búfer de lectura y un lote, no el archivo.
    # CORRECCIÓN (split(",") no es un lector de CSV): el módulo csv respeta comillas, comillas
    # dobladas y saltos de línea dentro de un campo (RFC 4180). newline="" es obligatorio para él, y
    # "utf-8-sig" quita el BOM que agrega Excel.
    with open(FILE, newline="", encoding="utf-8-sig") as f, \
         open(REJECTS, "w", newline="", encoding="utf-8") as out:
        records = read_csv(f)
        rejects = csv.writer(out, lineterminator="\n")
        rejects.writerow(["linea", "motivo", "detalle", "fila_original"])

        next(records, None)             # el encabezado, ya comprobado
        for line, fields, raw in records:
            if fields is None:          # comilla sin cerrar: se rechaza esta línea y se sigue con la siguiente
                row, reason, detail = None, "comilla_sin_cerrar", ("comilla sin cerrar: se rechaza esta línea"
                                                                   " y las siguientes se leen como filas nuevas")
            elif not fields:            # línea vacía
                continue
            else:
                row, reason, detail = validate(fields, line)
            read += 1
            if row is None:
                # CORRECCIÓN (un error detiene todo y no hay registro de rechazados): la fila mala va al
                # archivo de rechazados con su línea, su motivo y la fila original, y la carga sigue.
                rejected += 1
                by_reason[reason] = by_reason.get(reason, 0) + 1
                original = raw if fields is None else ",".join(csv_field(x) for x in fields)
                rejects.writerow([line, reason, detail, original])
                continue
            valid += 1
            batch.append(row)
            if len(batch) >= BATCH:
                stage_batch(conn, run_id, batch)
                staged_batches += 1
                batch = []
        if batch:
            stage_batch(conn, run_id, batch)
            staged_batches += 1
            batch = []
    # La intermedia se acaba de llenar y Postgres todavía no tiene estadísticas de ella: sin ANALYZE,
    # cada lote de la fase 2 ordena TODAS las filas que quedan (medido: 29 ms por lote con 48 000
    # filas, y crece con el archivo); con ANALYZE recorre el índice y se detiene a las BATCH filas.
    conn.execute("ANALYZE enrollments_staging")
    t_staged = time.perf_counter()

    dup_ids, dup_rows, dup_different = conn.execute(DUPLICATES, [run_id]).fetchone()

    # ----- Fase 2: de la intermedia a la final, de a BATCH ids por transacción -----
    # CORRECCIÓN (UNA transacción para todo el archivo): una transacción por lote de BATCH ids. Una fila
    # mala ya no puede abortar nada (no llega a la base), y si el proceso se corta aquí, la final queda
    # con algunos lotes ya fusionados, cada uno con su valor definitivo (la última aparición del
    # archivo). Relanzar con el mismo archivo deja exactamente el mismo resultado.
    print("fase 2: fusionando…", file=sys.stderr, flush=True)   # marca para la demostración de la caída a la mitad
    inserted = updated = keys = 0
    last_key = ""
    while True:
        with conn.transaction():
            k, lk, i, u = conn.execute(MERGE, {"run": run_id, "last": last_key, "batch": BATCH}).fetchone()
        if k == 0:
            break
        merged_batches += 1
        keys += k
        inserted += i
        updated += u
        last_key = lk
    unchanged = keys - inserted - updated

    # ----- Fase 3: limpiar, registrar y resumir -----
    conn.execute("DELETE FROM enrollments_staging WHERE run_id = %s", [run_id])
    conn.execute(
        """UPDATE import_runs SET finished_at = clock_timestamp(), rows_read = %s, rejected = %s,
                  duplicates = %s, inserted = %s, updated = %s, unchanged = %s WHERE id = %s""",
        [read, rejected, dup_rows, inserted, updated, unchanged, run_id])
    t_done = time.perf_counter()
    in_table, distinct_ids = conn.execute(
        "SELECT count(*), count(DISTINCT external_id) FROM enrollments").fetchone()

seconds = t_done - t0
accounts_ok = read == valid + rejected and valid == keys + dup_rows and keys == inserted + updated + unchanged


def fmt(n: int) -> str:
    return str(n).rjust(7)


print(f"archivo:                 {FILE}")
print(f"corrida (import_runs):   {run_id}")
print(f"filas leídas:            {fmt(read)}")
print(f"rechazadas:              {fmt(rejected)}   -> {REJECTS}")
for reason, n in sorted(by_reason.items(), key=lambda kv: -kv[1]):
    print(f"  {reason:<22}{fmt(n)}")
print(f"válidas:                 {fmt(valid)}")
print(f"repetidas (external_id): {fmt(dup_rows)}   en {dup_ids} ids; {dup_different} con datos distintos (gana la última aparición)")
print(f"ids únicos:              {fmt(keys)}")
print(f"insertadas:              {fmt(inserted)}")
print(f"actualizadas:            {fmt(updated)}")
print(f"sin cambios:             {fmt(unchanged)}")
print(f"filas en la tabla:       {fmt(in_table)}   (external_id distintos: {distinct_ids})")
print(f"cuentas:                 {'cierran' if accounts_ok else 'NO CIERRAN'} (leídas = válidas + rechazadas; válidas = únicas + repetidas; únicas = insertadas + actualizadas + sin cambios)")
print(f"resultado:               COMMIT ({staged_batches} lotes a la intermedia, {merged_batches} lotes de fusión de {BATCH})")
print(f"tiempo:                  {seconds:.2f} s   (leer+validar+intermedia {t_staged - t0:.2f} s, fusión {t_done - t_staged:.2f} s)")
print(f"memoria máxima (RSS):    {peak_rss_mb():.1f} MB")
