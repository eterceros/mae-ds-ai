# Rendimiento y latencia: servidor Java (cliente Node simétrico)

Servidor Java (Spring Boot 4.1.1 con Spring MVC y Tomcat para REST, grpc-java 1.83.1 sobre Netty para gRPC; java version "26.0.2" 2026-07-21) y cliente Node en la misma máquina (loopback). Mismos datos y mismo JSON que el servidor Node (ver java-server/README.md). Base simulada: 1 ms por consulta, máximo 10 a la vez. Cada cifra es la mediana de 3 rondas; entre paréntesis, el rango entre rondas. Las variantes se recorren en orden distinto en cada ronda. Antes de medir, cada variante corre 5 s a carga máxima para que la JVM compile el código (descartado).

- **Máx. llamadas/s:** bucle cerrado con 10 trabajadores (rendimiento máximo; puede estar limitado por el propio cliente, que es un solo proceso Node).
- **Latencia:** llegadas a ritmo fijo, común a las variantes del escenario (40 % de lo que aguanta la más lenta), con 2 s de calentamiento descartados y 8 s medidos. El tiempo cuenta desde que la llamada debió salir.
- En **P** cada "llamada" del cliente son 20 peticiones en paralelo; las llamadas/s y la latencia son de ese grupo de 20.

## A. Un estudiante

Ritmo común de la prueba de latencia: 772 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST | 2185.0 (2158.3–2193.3) | 2.0 (2.0–2.2) | 3.9 (3.3–4.1) | 5.5 (4.7–5.6) | 0 |
| gRPC | 1987.0 (1865.5–2076.8) | 2.4 (2.3–2.4) | 5.5 (5.2–5.5) | 11.9 (11.4–12.6) | 0 |

## B. Lista de 2000 estudiantes

Ritmo común de la prueba de latencia: 92 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST | 265.5 (241.5–278.3) | 8.1 (7.6–11.8) | 20.9 (11.0–294.3) | 33.3 (17.2–348.4) | 0 |
| gRPC | 331.3 (272.5–346.0) | 7.0 (6.8–8.0) | 12.6 (11.2–19.6) | 21.4 (19.5–43.7) | 0 |

## P. 20 llamadas pequeñas en paralelo (estudiantes 1 a 20, uno por llamada)

Ritmo común de la prueba de latencia: 58 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST (20 × GET /students/{id}) | 166.8 (161.5–177.3) | 7.5 (6.8–8.4) | 13.4 (11.4–16.6) | 25.3 (15.8–27.5) | 0 |
| gRPC (20 × GetStudent) | 177.5 (148.3–181.0) | 7.8 (7.4–9.0) | 15.7 (12.3–24.1) | 29.0 (20.0–32.5) | 0 |

