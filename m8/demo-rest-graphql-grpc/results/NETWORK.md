# Con red limitada (Docker + tc netem)

El servicio corre en un contenedor Linux (node:22-alpine) y a lo que sale de él se le aplica **20 ms de retardo y 20mbit** con `tc netem`. El cliente corre en el host de Windows y entra por puertos publicados de Docker. Cada cifra es la mediana de 3 rondas (entre paréntesis, el rango). Latencia a ritmo fijo común (40 % de lo que aguanta la variante más lenta), 2 s de calentamiento y 8 s medidos.

## N1. Lista de 2000 estudiantes (una llamada grande)

Ritmo común de la prueba de latencia: 4 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST (JSON sin comprimir) | 10.8 (10.8–11.2) | 118.2 (117.9–118.8) | 124.0 (123.5–126.3) | 126.4 (125.1–128.7) | 0 |
| REST con gzip | 132.6 (132.6) | 38.3 (37.8–38.6) | 46.8 (44.3–49.5) | 51.3 (47.6–51.8) | 0 |
| gRPC (sin comprimir) | 9.8 (9.8) | 123.9 (123.9–124.5) | 141.5 (138.9–985.8) | 152.3 (142.5–1010.1) | 0 |
| gRPC (sin comprimir) con ventana HTTP/2 ampliada | 16.4 (16.4–16.6) | 91.6 (90.6–93.7) | 103.5 (102.0–104.1) | 105.7 (105.4–110.4) | 0 |

## N2. 20 estudiantes pedidos de uno en uno, en paralelo (muchas llamadas pequeñas)

Ritmo común de la prueba de latencia: 4 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST, hasta 6 conexiones (como un navegador) | 11.2 (11.2–12.0) | 105.2 (102.8–105.8) | 118.8 (111.1–121.5) | 121.7 (116.5–123.7) | 0 |
| REST, conexiones sin tope | 196.4 (194.8–197.2) | 32.2 (29.9–34.0) | 44.3 (43.2–48.4) | 48.4 (45.2–48.8) | 0 |
| gRPC, un solo canal | 161.2 (136.6–218.2) | 34.0 (32.7–37.1) | 52.9 (48.1–56.3) | 54.6 (53.5–57.9) | 0 |

