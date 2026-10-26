"""Generates the lab CSV of course enrollments with a fixed seed (standard library only).

The Node version (../node/generate.ts) produces the SAME bytes for the same arguments.

    python generate.py                      -> ../data/enrollments.csv, 50 000 rows, seed 2026
    python generate.py --rows 500000 --out ../data/enrollments-500k.csv
    python generate.py --clean              -> no invalid rows and no duplicates

About 3 % of the rows are invalid (bad date, bad email, negative amount, empty field,
extra column) and about 1 % repeat the external_id of an earlier row.
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
M32 = 0xFFFFFFFF

p = argparse.ArgumentParser()
p.add_argument("--rows", type=int, default=50000)
p.add_argument("--seed", type=int, default=2026)
p.add_argument("--clean", action="store_true")
p.add_argument("--out")
args = p.parse_args()
ROWS, CLEAN = args.rows, args.clean
OUT = Path(args.out).resolve() if args.out else HERE.parent / "data" / ("enrollments-clean.csv" if CLEAN else "enrollments.csv")

# mulberry32, same as the Node version (all arithmetic modulo 2**32)
state = args.seed & M32


def next_u32() -> int:
    global state
    state = (state + 0x6D2B79F5) & M32
    t = state
    t = ((t ^ (t >> 15)) * (t | 1)) & M32
    t = ((t + (((t ^ (t >> 7)) * (t | 61)) & M32)) & M32) ^ t
    return (t ^ (t >> 14)) & M32


def rnd(n: int) -> int:
    return next_u32() % n


FIRST = [
    ("Ana", "ana"), ("Bruno", "bruno"), ("Carla", "carla"), ("Diego", "diego"), ("Elena", "elena"),
    ("Fernando", "fernando"), ("Gabriela", "gabriela"), ("Hugo", "hugo"), ("Inés", "ines"), ("Javier", "javier"),
    ("Karen", "karen"), ("Luis", "luis"), ("María", "maria"), ("Nicolás", "nicolas"), ("Olga", "olga"),
    ("Pablo", "pablo"), ("Rocío", "rocio"), ("Sergio", "sergio"), ("Tania", "tania"), ("Víctor", "victor"),
]
LAST = [
    ("Rojas", "rojas"), ("Vargas", "vargas"), ("Mamani", "mamani"), ("Quispe", "quispe"), ("Gutiérrez", "gutierrez"),
    ("Flores", "flores"), ("Pérez", "perez"), ("Torrez", "torrez"), ("Choque", "choque"), ("Soliz", "soliz"),
    ("Montaño", "montano"), ("Arce", "arce"), ("Salazar", "salazar"), ("Camacho", "camacho"), ("Zeballos", "zeballos"),
    ("Ríos", "rios"), ("Medina", "medina"), ("Antezana", "antezana"), ("Ugarte", "ugarte"), ("Villca", "villca"),
]
DOMAINS = ["example.edu", "example.org", "example.com"]
# course code and base price in cents
COURSES = [
    ("ARQ-101", 35000), ("API-201", 42050), ("BD-110", 38000), ("PRG-105", 30000), ("RED-220", 39900),
    ("SEG-130", 45000), ("ING-140", 36075), ("EST-150", 28000), ("GES-160", 33000), ("MAT-170", 27500),
]
DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31]  # Jan..Oct 2026


def money(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def base_row(seq: int) -> dict:
    f = FIRST[rnd(len(FIRST))]
    l1 = LAST[rnd(len(LAST))]
    l2 = LAST[rnd(len(LAST))]
    n = rnd(100)
    d = DOMAINS[rnd(len(DOMAINS))]
    c = COURSES[rnd(len(COURSES))]
    discount = rnd(4) * 2500
    m = rnd(10)
    day = rnd(DAYS[m]) + 1
    return {
        "id": f"INS-{seq:07d}",
        "name": f"{f[0]} {l1[0]} {l2[0]}",
        "email": f"{f[1]}.{l1[1]}{n}@{d}",
        "course": c[0],
        "date": f"2026-{m + 1:02d}-{day:02d}",
        "cents": c[1] - discount,
        "first": f[0],
        "last": f"{l1[0]} {l2[0]}",
    }


def line(r: dict, amount: str | None = None) -> str:
    return ",".join([r["id"], r["name"], r["email"], r["course"], r["date"], money(r["cents"]) if amount is None else amount])


stats = {"rows": 0, "valid": 0, "duplicates": 0, "bad_date": 0, "bad_email": 0,
         "negative_amount": 0, "empty_field": 0, "extra_column": 0}
emitted: list[dict] = []  # valid rows already written (candidates for duplicates)
seq = 0

OUT.parent.mkdir(parents=True, exist_ok=True)
with open(OUT, "w", encoding="utf-8", newline="\n") as out:
    buf = ["external_id,student_name,email,course_code,enrolled_on,amount"]

    def flush():
        out.write("\n".join(buf) + "\n")
        buf.clear()

    for _ in range(ROWS):
        r = rnd(1000)
        if not CLEAN and r < 10 and emitted:
            # ~1 %: same external_id as an earlier row; half exact copies, half with another amount
            prev = emitted[rnd(len(emitted))]
            buf.append(line(prev) if rnd(2) == 0 else line(prev, money(prev["cents"] + 5000)))
            stats["duplicates"] += 1
        else:
            seq += 1
            row = base_row(seq)
            if not CLEAN and 10 <= r < 40:
                # ~3 %: invalid row, five kinds
                kind = rnd(5)
                if kind == 0:
                    y, mo, d = row["date"].split("-")
                    v = rnd(4)
                    row["date"] = [f"{d}/{mo}/{y}", f"{y}-02-30", f"{y}-13-{d}", f"{y}/{mo}/{d}"][v]
                    stats["bad_date"] += 1
                    buf.append(line(row))
                elif kind == 1:
                    v = rnd(3)
                    e = row["email"]
                    row["email"] = [e.replace("@", ".", 1), e.split("@")[0] + "@", e.replace("@", "@@", 1)][v]
                    stats["bad_email"] += 1
                    buf.append(line(row))
                elif kind == 2:
                    stats["negative_amount"] += 1
                    buf.append(line(row, "-" + money(row["cents"])))
                elif kind == 3:
                    v = rnd(5)
                    if v < 4:
                        row[["name", "email", "course", "date"][v]] = ""
                    stats["empty_field"] += 1
                    buf.append(line(row, "") if v == 4 else line(row))
                else:
                    # "Last Last, First": an unquoted comma inside the name -> 7 columns
                    row["name"] = f"{row['last']}, {row['first']}"
                    stats["extra_column"] += 1
                    buf.append(line(row))
            else:
                stats["valid"] += 1
                emitted.append(row)
                buf.append(line(row))
        stats["rows"] += 1
        if len(buf) >= 10000:
            flush()
    flush()

print(f"{OUT}\n{json.dumps(stats, separators=(',', ':'))}", file=sys.stderr)
