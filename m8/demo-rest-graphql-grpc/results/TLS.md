# Costo de TLS y de abrir conexiones nuevas (REST HTTP/1.1 frente a gRPC HTTP/2)

Servidor (proceso Node aparte, sin NestJS, sin base simulada) y cliente en la misma máquina (loopback). Misma llamada en todos los casos: `GetStudent` / `GET /students/7`, que devuelve el mismo estudiante. Certificado autofirmado de demo (RSA 2048, validado por el cliente). Cada cifra es la mediana de 3 rondas; entre paréntesis, el rango entre rondas. Las variantes se recorren en orden distinto en cada ronda.

- **Máx. llamadas/s:** bucle cerrado (10 trabajadores en la conexión persistente; 4 en la nueva, para no agotar puertos efímeros). Puede estar limitado por el propio cliente, que es un solo proceso Node.
- **Latencia:** llegadas a ritmo fijo, común a las cuatro variantes del escenario (40 % de lo que aguanta la más lenta), con 2 s de calentamiento descartados y 8 s medidos. El tiempo cuenta desde que la llamada debió salir.
- **Conexión nueva:** cada llamada abre y cierra su conexión (REST: agente nuevo, sin reanudar la sesión TLS; gRPC: cliente y canal nuevos). Cada una deja un socket en TIME_WAIT, y el rango de puertos efímeros es finito, así que el ritmo de la prueba de latencia se limita a 100 llamadas/s como máximo.
- **Persistente:** REST abre varios sockets HTTP/1.1 (uno por llamada en vuelo) y gRPC multiplexa todo en una sola conexión HTTP/2; es la diferencia de diseño, no un truco de la medición.

## P. Conexión persistente (keep-alive / un solo canal gRPC)

Ritmo común de la prueba de latencia: 729 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST HTTP/1.1, sin TLS | 3463.3 (3100.5–3567.5) | 0.6 (0.5–0.6) | 1.2 (0.9–1.3) | 1.9 (1.3–7.2) | 0 |
| REST HTTP/1.1, con TLS | 2373.8 (2255.8–2451.3) | 0.7 (0.6–0.7) | 1.5 (1.3–35.0) | 4.0 (2.3–184.4) | 0 |
| gRPC HTTP/2, sin TLS | 2887.0 (2450.0–3420.5) | 0.9 (0.8–1.0) | 2.5 (1.9–3.5) | 8.1 (6.2–9.5) | 0 |
| gRPC HTTP/2, con TLS | 3311.8 (2965.5–3479.0) | 0.9 (0.9–1.0) | 2.1 (2.0–5.0) | 5.6 (5.4–10.1) | 0 |

## N. Conexión nueva en cada llamada (TCP + TLS + SETTINGS de HTTP/2 por llamada)

Ritmo común de la prueba de latencia: 17 llamadas/s.

| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |
|---|---:|---:|---:|---:|---:|
| REST HTTP/1.1, sin TLS | 475.0 (471.3–478.0) | 3.1 (2.9–3.1) | 4.4 (4.3–4.6) | 7.0 (5.5–8.3) | 0 |
| REST HTTP/1.1, con TLS | 142.3 (137.3–143.7) | 8.9 (8.3–9.3) | 13.7 (13.4–13.7) | 15.3 (15.2–17.0) | 0 |
| gRPC HTTP/2, sin TLS | 73.7 (73.3–77.0) | 15.6 (15.1–15.7) | 19.1 (19.0–19.3) | 22.0 (21.8–22.6) | 0 |
| gRPC HTTP/2, con TLS | 50.0 (43.7–50.3) | 23.8 (23.5–24.7) | 31.1 (29.0–32.2) | 34.7 (32.4–38.2) | 0 |

