# OA, desglose de todas las peticiones de despues

Generado por `scripts/oa-desglose.ts` el 2026-10-26T10:11:34.910Z, sobre las trazas de las 3 corridas de despues de `scripts/oa-od.ts` (las mismas de [OA-OD_P95_A_TRAZA.md](OA-OD_P95_A_TRAZA.md)).
«Lenta» = span de la API >= 300 ms. Causa: precios >= 300 ms, COMMIT >= 50 ms.

| corrida | peticiones | sin traza en Tempo | lentas | solo precios | precios + COMMIT | solo COMMIT | otra | COMMIT p50 / p95 / máx (ms) | COMMIT >= 50 ms |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 601 | 0 | 66 | 55 | 5 | 6 | 0 | 1.7 / 87.7 / 557.2 | 62 |
| 2 | 600 | 0 | 60 | 57 | 3 | 0 | 0 | 1.5 / 28.3 / 162.0 | 19 |
| 3 | 601 | 0 | 60 | 58 | 2 | 0 | 0 | 1.7 / 39.9 / 164.5 | 19 |

Total: 186 lentas; 170 solo por precios, 10 por precios y COMMIT, 6 solo por COMMIT, 0 por otra cosa. COMMIT en las 1802 peticiones: mediana 1.6 ms, p95 54.1 ms, p99 157.8 ms, máx 557.2 ms (6 % >= 50 ms).
