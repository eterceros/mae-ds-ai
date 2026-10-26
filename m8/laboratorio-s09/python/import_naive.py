"""NAIVE IMPORTER (starting point of the S09 lab). Do NOT copy it as a model.

It works with a small, perfect file and breaks with a real one. Every weak spot is marked
with "PROBLEMA:". Your job is to write the improved version (in a new file) and measure both.

    python import_naive.py                          -> ../data/enrollments.csv
    python import_naive.py ../data/enrollments-clean.csv
    DATABASE_URL=postgresql://... python import_naive.py
"""
import os
import sys
import time
from pathlib import Path

import psycopg

from peak_memory import peak_rss_mb

HERE = Path(__file__).resolve().parent
FILE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent / "data" / "enrollments.csv"
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:lab@127.0.0.1:18450/lab")

INSERT = (
    "INSERT INTO enrollments (external_id, student_name, email, course_code, enrolled_on, amount) "
    "VALUES (%s, %s, %s, %s, %s, %s)"
)

t0 = time.perf_counter()
read = 0
executed = 0
error = None

with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
    try:
        # PROBLEMA: lee el archivo ENTERO en memoria. Con 50 000 filas pasa; con 500 000 o con
        # un archivo de varios GB la memoria crece con el archivo (o el proceso muere).
        with open(FILE, encoding="utf-8") as f:
            text = f.read()

        # PROBLEMA: split crea una segunda copia completa (una lista con todas las líneas),
        # y la comprensión de abajo una tercera (una lista de listas). Tres copias a la vez.
        lines = text.split("\n")

        # PROBLEMA: supone que la primera línea es el encabezado y no comprueba que las columnas
        # sean las esperadas ni que estén en ese orden.
        # PROBLEMA: split(",") no es un lector de CSV: no entiende comillas ("Rojas, Ana") ni
        # saltos de línea dentro de un campo, y no avisa si una fila trae columnas de más o de menos.
        rows = [line.split(",") for line in lines[1:] if line]
        read = len(rows)

        # PROBLEMA: UNA sola transacción para todo el archivo. La primera fila mala aborta la
        # transacción y se deshacen también las miles de filas buenas que ya se habían insertado.
        with conn.transaction(), conn.cursor() as cur:
            for r in rows:
                # PROBLEMA: no valida nada (fecha, correo, monto, campos vacíos); deja que la base
                # de datos lo descubra, con un error genérico y sin decir en qué línea estaba.
                # PROBLEMA: r[:6] descarta en silencio las columnas de más: una fila corrida
                # (nombre con coma) puede cargarse con los datos en la columna equivocada.
                # PROBLEMA: un INSERT por fila = una ida y vuelta a la base por fila (50 000 viajes).
                # PROBLEMA: INSERT sin ON CONFLICT: una fila repetida en el archivo, o volver a
                # ejecutar el import, choca con la clave única (y sin esa clave, duplicaría todo).
                cur.execute(INSERT, r[:6])
                executed += 1
    except (psycopg.Error, OSError) as e:
        # PROBLEMA: un error detiene todo. No hay archivo de rechazados con el motivo de cada
        # fila, así que para saber qué estaba mal hay que corregir y reintentar una fila a la vez.
        # (Al salir del bloque "with conn.transaction()" con una excepción, psycopg hace ROLLBACK.)
        error = str(e).strip().splitlines()[0]
    finally:
        in_table = conn.execute("SELECT count(*) FROM enrollments").fetchone()[0]

# Measurement (keep something like this in your improved version).
seconds = time.perf_counter() - t0
failed_at = f" (failed on data row {executed + 1}, line {executed + 2} of the file)" if error and read else ""
print(f"file:               {FILE}")
print(f"rows read:          {read}")
print(f"inserts executed:   {executed}{failed_at}")
print(f"rows in table now:  {in_table}")
print(f"result:             {'ERROR - ' + error if error else 'COMMIT'}")
print(f"time:               {seconds:.2f} s")
print(f"peak memory (RSS):  {peak_rss_mb():.1f} MB")
