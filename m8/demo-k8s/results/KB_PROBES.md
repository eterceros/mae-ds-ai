# KB · Liveness que consulta una dependencia frente a readiness bien usada

Medido el 2026-10-26 11:01 UTC · 12th Gen Intel(R) Core(TM) i9-12900H (20 hilos), 64 GB · Windows_NT 10.0.26200 · Node v24.19.0 · kubectl v1.36.1 · Kubernetes v1.37.0 (kind, contexto kind-s11-demo)

Mismo código y misma imagen; solo cambia la ruta de la *liveness* de `api` (2 réplicas):

- **antes** ([`antes/kb-liveness-con-dependencia.yaml`](../antes/kb-liveness-con-dependencia.yaml)): liveness → /salud/listo (consulta precios)
- **despues** ([`despues/api.yaml`](../despues/api.yaml)): liveness → /salud/vivo; readiness → /salud/listo

Ambas: readiness cada 2 s (2 fallos), liveness cada 5 s (3 fallos), startup cada 1 s. Procedimiento de cada corrida (`node --no-warnings scripts/kb-probes.ts`): pods nuevos de `api`; un pod de carga hace 10 peticiones/s durante 240 s a `http://api.s11/cotizacion` (por el Service, como otro servicio del clúster); en t = 20 s se apaga `precios` (réplicas a 0) y en t = 110 s se vuelve a encender (90 s caído). 3 corridas por variante, alternadas. Los endpoints listos y los reinicios se muestrean cada 2 s: los tiempos en segundos tienen esa resolución.

## Resumen (mediana y rango de 3 corridas)

| | antes | despues |
|---|---|---|
| Reinicios de `api` (2 pods) | **8 (8–9)** | **0 (0–0)** |
| … de ellos, después de que `precios` volvió | 0 (0–1) | 0 (0–0) |
| Peticiones fallidas (de 2400) | 905 (900–941) | 906 (904–916) |
| … mientras `precios` estaba caído | 905 (900–941) | 906 (904–916) |
| … después de que `precios` volvió | 0 (0–0) | 0 (0–0) |
| Segundos desde que `precios` vuelve hasta el primer 200 | 0 (0–0) | 0 (0–0) |
| Segundos hasta tener **los 2 pods** de nuevo en el Service | **2 (2–56)** | **0 (0–2)** |

## Cada corrida

| Variante | Corrida | Reinicios | Fallidas | Durante la caída | Tras volver | 1.er 200 tras volver (s) | 2 pods en el Service tras volver (s) | Motivos de los fallos |
|---|---|---|---|---|---|---|---|---|
| antes | 1 | 9 | 941 | 941 | 0 | 0 | 56 | http 502 121, ECONNREFUSED 64, TimeoutError 756 |
| despues | 1 | 0 | 916 | 916 | 0 | 0 | 0 | http 502 883, ECONNREFUSED 33 |
| antes | 2 | 8 | 905 | 905 | 0 | 0 | 2 | http 502 118, ECONNREFUSED 62, TimeoutError 725 |
| despues | 2 | 0 | 906 | 906 | 0 | 0 | 2 | http 502 875, ECONNREFUSED 31 |
| antes | 3 | 8 | 900 | 900 | 0 | 0 | 2 | http 502 143, ECONNREFUSED 72, TimeoutError 685 |
| despues | 3 | 0 | 904 | 904 | 0 | 0 | 0 | http 502 871, ECONNREFUSED 33 |

Los motivos son los que ve el cliente: `http 502` = la api respondió que `precios` no contesta; `ECONNREFUSED` = el Service no tenía pods listos; `TimeoutError` = sin respuesta en 2 s; `UND_ERR_SOCKET` = conexión cortada. La serie segundo a segundo (peticiones correctas y fallidas, endpoints listos, reinicios cada 2 s) está en [`raw/kb/`](raw/kb/).
