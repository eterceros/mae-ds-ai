# Rendimiento y latencia (cliente Node simétrico)

Servidores y cliente en la misma máquina (loopback). Base simulada: 1 ms por consulta, máximo 10 a la vez. Cada cifra es la mediana de 3 rondas; entre paréntesis, el rango entre rondas. Las variantes se recorren en orden distinto en cada ronda.

- **Máx. llamadas/s:** bucle cerrado con 10 trabajadores (rendimiento máximo; puede estar limitado por el propio cliente, que es un solo proceso Node).
- **Latencia:** llegadas a ritmo fijo, común a las variantes del escenario (40 % de lo que aguanta la más lenta), con 2 s de calentamiento descartados y 8 s medidos. El tiempo cuenta desde que la llamada debió salir.

## A. Un estudiante (solo el nombre)

Ritmo común de la prueba de latencia: 582 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST | 3026.8 (2989.0–3112.5) | 1.8 (1.8–1.8) | 2.5 (2.5–2.9) | 3.4 (3.4–4.7) | 0 |
| GraphQL | 1616.0 (1541.0–1616.3) | 2.4 (2.3–2.4) | 3.5 (3.4–4.1) | 4.9 (4.6–6.1) | 0 |
| gRPC | 2103.5 (2033.0–2201.8) | 2.5 (2.5–2.6) | 4.0 (4.0–4.5) | 7.4 (6.7–8.3) | 0 |

## B. Lista de 2000 estudiantes

Ritmo común de la prueba de latencia: 27 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST | 331.0 (303.0–333.8) | 6.1 (5.1–6.1) | 9.9 (7.3–10.3) | 12.4 (9.6–17.0) | 0 |
| GraphQL | 64.0 (62.3–67.3) | 10.0 (9.8–10.9) | 19.0 (16.3–21.5) | 25.7 (20.2–25.8) | 0 |
| gRPC | 147.0 (142.3–169.8) | 9.0 (7.1–9.5) | 16.2 (14.5–16.6) | 19.5 (15.9–30.7) | 0 |

## C. 50 estudiantes con sus cursos

Ritmo común de la prueba de latencia: 24 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST ingenuo (1 + 50 llamadas) | 60.0 (57.5–62.5) | 90.8 (89.1–90.8) | 103.8 (99.1–112.0) | 120.8 (103.4–187.1) | 0 |
| REST con ?expand=courses | 1267.8 (1159.3–1347.5) | 3.8 (3.7–3.9) | 5.8 (5.2–5.9) | 7.9 (6.5–17.3) | 0 |
| GraphQL con dataloader | 268.8 (254.0–288.8) | 5.2 (4.6–5.7) | 8.5 (8.0–9.0) | 10.5 (10.3–11.5) | 0 |
| GraphQL sin dataloader (N+1) | 140.5 (130.5–147.5) | 8.6 (8.1–9.8) | 11.4 (10.6–12.3) | 13.6 (12.5–14.0) | 0 |
| gRPC | 792.0 (630.3–803.8) | 4.5 (4.3–5.0) | 6.4 (5.9–7.6) | 7.8 (7.4–10.2) | 0 |

## D1. Servicio a servicio: el gateway pide 20 estudiantes de uno en uno, en paralelo

Ritmo común de la prueba de latencia: 51 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| Gateway -> servicio por REST | 159.0 (152.0–168.3) | 6.8 (6.8–8.1) | 11.8 (11.5–17.5) | 18.7 (16.8–26.7) | 0 |
| Gateway -> servicio por gRPC | 152.3 (151.0–154.8) | 8.7 (8.3–9.3) | 14.7 (13.9–17.2) | 25.5 (20.4–33.6) | 0 |

## D2. Servicio a servicio: el gateway pide la lista de 2000 en una sola llamada

Ritmo común de la prueba de latencia: 56 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| Gateway -> servicio por REST | 281.0 (259.5–287.8) | 6.8 (6.0–7.3) | 11.0 (10.7–12.2) | 19.3 (18.3–24.1) | 0 |
| Gateway -> servicio por gRPC | 148.3 (145.0–155.0) | 9.2 (9.0–9.5) | 16.3 (15.8–17.1) | 28.9 (23.0–44.6) | 0 |

