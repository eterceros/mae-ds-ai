# Con red limitada (Docker + tc netem)

El servicio corre en un contenedor Linux (node:22-alpine) y a lo que sale de él se le aplica **20 ms de retardo y 20mbit** con `tc netem`. El cliente corre en el host de Windows y entra por puertos publicados de Docker. Cada cifra es la mediana de 3 rondas (entre paréntesis, el rango). Latencia a ritmo fijo común (40 % de lo que aguanta la variante más lenta), 2 s de calentamiento y 8 s medidos.

## N1. Lista de 2000 estudiantes (una llamada grande)

Ritmo común de la prueba de latencia: 4 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST (JSON sin comprimir) | 11.0 (10.6–11.2) | 116.9 (116.8–118.6) | 123.0 (119.9–124.2) | 124.7 (121.7–126.0) | 0 |
| REST con gzip | 132.6 (132.6–132.8) | 37.0 (36.3–39.0) | 46.6 (40.6–49.6) | 47.2 (41.2–51.1) | 0 |
| gRPC (sin comprimir) | 10.2 (9.6–10.4) | 118.4 (117.2–121.2) | 131.3 (129.7–136.2) | 132.5 (131.0–138.1) | 0 |
| gRPC (sin comprimir) con ventana HTTP/2 ampliada | 16.4 (16.4) | 91.6 (90.3–92.0) | 98.3 (93.3–100.3) | 99.2 (93.4–102.0) | 0 |

## N2. 20 estudiantes pedidos de uno en uno, en paralelo (muchas llamadas pequeñas)

Ritmo común de la prueba de latencia: 4 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST, hasta 6 conexiones (como un navegador) | 12.2 (11.8–12.2) | 101.7 (99.6–102.3) | 114.3 (106.1–119.4) | 116.7 (116.4–122.3) | 0 |
| REST, conexiones sin tope | 207.8 (204.4–225.4) | 31.2 (28.9–31.6) | 41.3 (40.7–46.8) | 48.4 (43.2–50.6) | 0 |
| gRPC, un solo canal | 170.6 (170.2–175.8) | 32.4 (32.3–33.1) | 51.8 (50.5–57.4) | 53.4 (51.8–60.8) | 0 |

