# Demo de resiliencia: resultados medidos (R0–R6)

Generado por `scripts/informe.ts` con las corridas de `scripts/medir.ts` (2026-10-24). Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200; Docker Desktop con WSL2 (motor 29.9.2). Todo corre en contenedores en la misma máquina: k6 2.3.0 → A (Node 24.22.1) → Toxiproxy 2.13.0 → B (Node 24.22.1); opossum 10.0.0.

Cada cifra es la **mediana de 3 corridas**; entre paréntesis, el rango (mín–máx). Latencias en milisegundos, medidas por k6 desde que envía la petición a A hasta que recibe la respuesta. «% errores» = respuestas de A que no son 2xx más las que k6 abandonó al vencer su propio timeout. Los datos crudos están en `results/raw/`.

## R0–R3. B lento o colgado: sin protección, con timeout y con reintentos

Carga a ritmo fijo: 50 peticiones por segundo durante 30 s (modelo abierto: si A se pone lento, las peticiones siguen llegando). En R1–R3, Toxiproxy afecta al 20 % de las conexiones de A a B, elegidas al azar: «lento» = la respuesta de B llega 2 s tarde; «colgado» = la conexión queda abierta y no pasa nada, nunca. A abre una conexión por llamada, así que la falla se decide llamada por llamada. En los casos «colgado», k6 abandona la petición a los 10 s.

| Escenario | p50 | p95 | p99 | máx. | % errores | Llamadas a B por petición | Peticiones que recibió B | Máx. en curso en A | Llamadas colgadas en A al terminar |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **R0** Línea base: B sano, sin protección | 3.1 | 4.4 (4.2–4.4) | 6.0 | 24.0 | 0.0 (0.0–0.0) | 1.00 | 1500 | 2 | 0 |
| **R1-lento** Sin protección, 20 % de llamadas a B tardan 2 s | 3.2 | 2004 (2004–2004) | 2005 | 2007 | 0.0 (0.0–0.0) | 1.00 | 1500 | 30 | 0 |
| **R1-colgado** Sin protección, 20 % de llamadas a B se cuelgan | 3.0 | 10001 (10001–10001) | 10001 | 10002 | 20.2 (19.4–20.3) | 1.00 | 1191 | 302 | 301 |
| **R2-lento** Timeout de 300 ms, 20 % lentas | 2.8 | 301 (301–301) | 302 | 303 | 19.3 (17.5–19.5) | 1.00 | 1500 | 9 | 0 |
| **R2-colgado** Timeout de 300 ms, 20 % colgadas | 2.8 | 301 (301–301) | 302 | 303 | 21.1 (20.3–21.5) | 1.00 | 1183 | 9 | 0 |
| **R3-lento** Timeout de 300 ms + 2 reintentos (backoff + jitter), 20 % lentas | 3.0 | 352 (351–353) | 742 | 1036 | 0.9 (0.7–1.3) | 1.26 | 1889 | 13 | 0 |
| **R3-colgado** Timeout de 300 ms + 2 reintentos (backoff + jitter), 20 % colgadas | 2.9 | 349 (348–612) | 729 | 1029 | 0.7 (0.5–1.1) | 1.24 | 1490 | 10 | 0 |

Respuestas de A por motivo (suma de las corridas):

- **R1-lento**: 200: 4501
- **R1-colgado**: 200: 3577
- **R2-lento**: 200: 3655; 504 timeout: 846
- **R2-colgado**: 200: 3558; 504 timeout: 944
- **R3-lento**: 200: 4457; 504 timeout: 44
- **R3-colgado**: 200: 4468; 504 timeout: 34

«Llamadas colgadas en A al terminar»: llamadas de A a B que seguían abiertas al acabar la carga. k6 ya había abandonado esas peticiones, pero A no se entera y su llamada a B sigue esperando. «Máx. en curso en A»: el máximo de peticiones atendiéndose a la vez en A. En R1-colgado, el «máx.» de latencia es el timeout de k6 (10 s), no el de A, que no tiene.

## R4. Reintentos sin espera, sin jitter y con jitter

B responde 503 durante 1 s y, justo en ese momento, llegan 50 peticiones a la vez (como cuando B se reinicia con muchos clientes conectados). Cada petición hace hasta 6 intentos en total, con espera base de 200 ms que se duplica hasta un tope de 2 s (200, 400, 800, 1600, 2000 ms) y plazo de 1 s por intento. «antes» (el cliente de `src/antes/`) reintenta enseguida, sin esperar; sin jitter, todas esperan exactamente lo mismo; con jitter completo, cada una espera al azar entre 0 y ese valor; con jitter «igual», la mitad fija más la mitad al azar.

| Variante | % errores | p50 | p95 | máx. | Peticiones que recibió B | Máx. llegadas a B en 50 ms | Máx. de reintentos que llegan a B en 50 ms | Máx. de reintentos en 10 ms | Reintentos |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **R4-antes-sin-espera** | 100 (100–100) | 151 | 195 | 196 | 300 (300–300) | 84 (78–97) | 83 (73–97) | 19 (17–21) | 250 |
| **R4-sin-jitter** | 0.0 (0.0–0.0) | 1447 | 1462 | 1466 | 200 (200–200) | 50 (50–50) | 50 (36–50) | 17 (15–19) | 150 |
| **R4-jitter-completo** | 2.0 (0.0–6.0) | 1456 | 2340 | 2798 | 254 (251–255) | 56 (40–62) | 19 (15–20) | 7 (6–7) | 204 |
| **R4-jitter-igual** | 0.0 (0.0–0.0) | 1243 | 2274 | 2476 | 219 (218–220) | 50 (50–50) | 28 (23–31) | 12 (7–13) | 169 |

Peticiones que llegan a B en cada intervalo de 100 ms, contando desde la primera (una corrida representativa por variante; la columna es el inicio del intervalo en ms):

| Variante | 0 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200 | 1300 | 1400 | 1500 | 1600 | 1700 | 1800 | 1900 | 2000 | 2100 | 2200 | 2300 | 2400 | 2500 | 2600 | 2700 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R4-antes-sin-espera | 150 | 150 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| R4-sin-jitter | 50 | 0 | 50 | 0 | 0 | 0 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| R4-jitter-completo | 75 | 27 | 27 | 15 | 17 | 10 | 11 | 6 | 11 | 7 | 7 | 6 | 2 | 2 | 2 | 6 | 4 | 1 | 5 | 5 | 3 | 1 | 0 | 1 | 2 | 0 | 0 | 2 |
| R4-jitter-igual | 50 | 44 | 6 | 14 | 20 | 15 | 1 | 1 | 4 | 16 | 8 | 15 | 4 | 2 | 0 | 0 | 1 | 3 | 3 | 3 | 1 | 4 | 3 | 0 | 1 | 0 | 0 | 0 |

## R5. Circuit breaker (opossum 10) con B colgado o caído

50 peticiones por segundo durante 30 s. De los 10 a los 20 s, B falla en todas las llamadas: «colgado» = Toxiproxy acepta la conexión y no deja pasar nada (tóxico `timeout` con `timeout: 0`); «caído» = Toxiproxy cierra el puerto (`enabled: false`) y conectar falla al instante. A llama con plazo de 500 ms. El breaker abre cuando falla más del 50 % de las llamadas (con un mínimo de 10) en la ventana de los últimos 10 s o 2 s, queda abierto 2 s y luego deja pasar una llamada de prueba (semiabierto): si sale bien, cierra; si no, vuelve a abrir.

| Variante | Antes: p95 | Falla: p50 | Falla: p95 | Falla: % errores | Llamadas de A a B durante la falla | Después: % errores | Después: p95 | Breaker: ms hasta abrir | Aperturas | ms hasta cerrar tras volver B |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **R5-colgado-sin-breaker** B colgado de 10 a 20 s; timeout 500 ms, sin breaker | 3.7 | 501 | 502 (502–502) | 100 | 500 (500–500) | 0.0 (0.0–0.0) | 3.9 | - | - | - |
| **R5-colgado-breaker-10s** Lo mismo + breaker, ventana de 10 s (valor por omisión de opossum) | 4.0 | 500 | 502 (502–502) | 99.8 | 253 (253–254) | 20.2 (20.0–20.2) | 4.2 | 5020 (5020–5022) | 3 (3–3) | 2018 (2016–2020) |
| **R5-colgado-breaker-2s** Lo mismo + breaker, ventana de 2 s | 4.8 | 0.7 | 501 (501–501) | 99.8 | 74 (73–74) | 9.8 (9.8–10.0) | 4.0 | 1419 (1419–1420) | 4 (4–4) | 979 (978–1003) |
| **R5-caido-sin-breaker** B caído (conexión rechazada) de 10 a 20 s; sin breaker | 3.7 | 1.6 | 14.0 (2.7–15.8) | 99.8 | 500 (500–500) | 0.0 (0.0–0.0) | 3.8 | - | - | - |
| **R5-caido-breaker-10s** Lo mismo + breaker, ventana de 10 s | 4.1 | 1.2 | 2.5 (2.1–9.7) | 100 | 252 (252–253) | 10.4 (10.2–10.6) | 4.3 | 5001 (4980–5018) | 3 (3–3) | 1058 (1038–1079) |
| **R5-caido-breaker-2s** Lo mismo + breaker, ventana de 2 s | 3.7 | 0.6 | 1.7 (1.7–2.1) | 100 | 55 (55–56) | 11.0 (11.0–11.2) | 4.3 | 1020 (1018–1021) | 5 (5–5) | 1117 (1111–1119) |

Unas 500 peticiones llegan a A durante los 10 s de falla. «Llamadas de A a B»: intentos que A lanzó de verdad hacia B (con el circuito abierto, opossum rechaza sin llamar). Los tiempos del breaker se cuentan desde que k6 inyecta la falla y desde que la retira.

Secuencia del breaker en R5-colgado-breaker-10s, corrida 1 (segundos desde que empieza la falla; la falla termina a los 10 s): abre 5.02 s → semiabierto 7.02 s → abre 7.54 s → semiabierto 9.54 s → abre 10.00 s → semiabierto 12.00 s → cierra 12.02 s.

Secuencia del breaker en R5-colgado-breaker-2s, corrida 1 (segundos desde que empieza la falla; la falla termina a los 10 s): abre 1.42 s → semiabierto 3.42 s → abre 3.92 s → semiabierto 5.92 s → abre 6.44 s → semiabierto 8.44 s → abre 8.96 s → semiabierto 10.96 s → cierra 10.98 s.

Secuencia del breaker en R5-caido-breaker-10s, corrida 1 (segundos desde que empieza la falla; la falla termina a los 10 s): abre 5.02 s → semiabierto 7.02 s → abre 7.05 s → semiabierto 9.05 s → abre 9.06 s → semiabierto 11.06 s → cierra 11.08 s.

Secuencia del breaker en R5-caido-breaker-2s, corrida 1 (segundos desde que empieza la falla; la falla termina a los 10 s): abre 1.02 s → semiabierto 3.02 s → abre 3.04 s → semiabierto 5.04 s → abre 5.06 s → semiabierto 7.06 s → abre 7.08 s → semiabierto 9.08 s → abre 9.10 s → semiabierto 11.10 s → cierra 11.12 s.

## R6. Bulkhead: que una dependencia lenta no arrastre a la otra

Dos rutas de A al mismo tiempo durante 30 s: `/r6/lento` (30 pet/s; su B tarda 2 s en todas las llamadas) y `/r6/rapido` (50 pet/s; su B está sano). Las dos comparten el pool de conexiones salientes de A, limitado a 20 conexiones; plazo de 2,5 s por llamada (incluye la espera por una conexión libre). Con bulkhead, la ruta lenta acepta como mucho 10 llamadas a la vez y rechaza al instante (503) las que sobran.

| Variante | Rápida: p50 | Rápida: p95 | Rápida: % errores | Lenta: p50 | Lenta: p95 | Lenta: % errores | Lenta: rechazadas por el bulkhead | Lenta: timeouts | Lenta: respuestas 200 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **R6-sin-bulkhead** | 2501 | 2502 (2502–2502) | 95.7 (95.7–95.7) | 2501 | 2502 | 97.8 (97.8–97.8) | 0 | 881 | 20 |
| **R6-con-bulkhead** | 2.7 | 3.9 (3.8–4.0) | 0.0 (0.0–0.0) | 0.7 | 2004 | 83.4 (83.3–83.4) | 751 | 0 | 150 |

## Qué no se midió

- **El fragmento de Spring** (`spring/ClienteB.java`: Resilience4j 2.4 y `@Retryable`/`@ConcurrencyLimit` de Spring Framework 7) es equivalente en intención, **no medido**: no se compiló ni se corrió contra esta demo.
- **Una red real.** A, B, Toxiproxy y k6 corren en la misma máquina, en la red de Docker Desktop. Las fallas son las que inyecta Toxiproxy (latencia fija, conexión colgada, puerto cerrado), no las de una red real (pérdida de paquetes, latencia variable, DNS, TLS).
- **El costo de cada protección en condiciones normales** (cuánto suma un breaker o un limitador por llamada): es muy pequeño frente a lo medido aquí y no es el tema de la sesión.
- **Ajuste fino de parámetros.** Los valores (300 ms, 2 reintentos, ventana de 2 o 10 s, límite de 10) son ejemplos razonables para estos tiempos, no recomendaciones; en un sistema real salen de las latencias medidas de B y de lo que el negocio tolera.
- **Presupuesto de reintentos** (limitar los reintentos a un % de las llamadas) y **propagar el plazo** a B (que B sepa cuánto le queda al cliente): se explican en la sesión, no están en la demo.
- **Failover, alta disponibilidad, autoescalado o caos en infraestructura**: fuera del alcance de este módulo; aquí la resiliencia está solo en el código de UNA llamada.
