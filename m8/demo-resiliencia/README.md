# Resiliencia en el código de una llamada (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 8

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni tokens de ningún servicio.

## Qué muestra

Un servicio **A** llama por HTTP a un servicio **B**. Entre los dos hay un [Toxiproxy](https://github.com/Shopify/toxiproxy) (2.13.0), un proxy TCP que se controla por su API y sirve para **romper la red a propósito**: hacer que B tarde, que la conexión quede colgada o que el puerto se cierre. Con esas fallas se mide qué le pasa a A sin protección y con cada protección, **escrita en el código de la llamada**:

| | Protección | Qué enseña |
|---|---|---|
| **R1** | Ninguna (el cliente de `src/antes/`) | Si B tarda, A tarda lo mismo; si B se cuelga, A espera para siempre y acumula llamadas abiertas |
| **R2** | Timeout (`AbortSignal.timeout`) | Acota la espera: la latencia de A deja de depender de B, a cambio de errores rápidos |
| **R3** | Timeout + reintentos con backoff exponencial y *jitter* | Convierte la mayoría de esos errores en éxitos, a cambio de más peticiones a B (solo si la operación es idempotente) |
| **R4** | Reintentos sin espera, con backoff sin *jitter* y con *jitter* | Sin espera, los intentos se gastan antes de que B vuelva; sin *jitter*, los clientes que fallaron juntos reintentan juntos: picos contra un B que se está recuperando |
| **R5** | Circuit breaker ([opossum](https://github.com/nodeshift/opossum) 10.0.0) | Con B caído, deja de llamarlo: falla en 1 ms en vez de esperar el timeout, y B no recibe tráfico mientras tanto |
| **R6** | Bulkhead (limitador de concurrencia) | Una dependencia lenta no se lleva el pool de conexiones que comparte con otra ruta sana |

R0 es la línea base: B sano, sin protección.

El código de A está partido en **antes y después**: `src/antes/` es el cliente que escribe alguien con apuro o una IA sin revisar, y `src/despues/` el mismo cliente corregido, con cada corrección comentada. [`DIFERENCIAS.md`](DIFERENCIAS.md) pone lado a lado cada problema, su línea, la corrección y la cifra medida.

**Qué no es esta demo.** La resiliencia aquí vive en el código de UNA llamada entre dos servicios. No hay *failover*, réplicas, alta disponibilidad, autoescalado ni ingeniería del caos sobre la infraestructura: eso es de otros módulos. La teoría de circuit breaker y reintentos se vio en el módulo 4; aquí se ve el código y lo que se mide.

## Piezas

| Pieza | Dónde | Notas |
|---|---|---|
| A (Node 24.22.1, TypeScript) | `127.0.0.1:18200` | `src/a.ts`: una ruta por escenario; `GET /stats` da contadores, estado del breaker y llamadas en curso |
| B (Node 24.22.1, TypeScript) | `127.0.0.1:18201` | `src/b.ts`: responde al instante y cuenta lo que recibe (`GET /stats`) |
| Toxiproxy 2.13.0 | API en `127.0.0.1:18210` | tres proxies hacia B: `b` (R1-R5), `b_lento` y `b_rapido` (R6); `toxiproxy/toxiproxy.json` |
| k6 2.3.0 | contenedor de un solo uso | `k6/*.js`; genera la carga desde la red de Docker y guarda su resumen en `results/raw/` |

Todo en Docker Compose (proyecto `s08-resil`), puertos altos y solo en `127.0.0.1`. Las imágenes están fijadas por versión y *digest*.

Archivos que vale la pena leer, en este orden:

- [`DIFERENCIAS.md`](DIFERENCIAS.md): tabla de cada problema, su línea en `antes/`, el cambio en `despues/` y la cifra medida.
- `src/antes/cliente-b.ts`: el cliente de B que escribe alguien con apuro (o una IA sin revisar): sin plazo, reintenta enseguida, sin breaker ni límite. Cada problema, marcado `// PROBLEMA:`.
- `src/despues/`: el mismo cliente corregido, cada cambio marcado `// CORRECCIÓN:`. `cliente-b.ts` (plazo con `AbortSignal.timeout`, reintentos con backoff exponencial y tres tipos de *jitter*, solo si la operación es idempotente), `breaker.ts` (opossum) y `bulkhead.ts` (limitador de concurrencia).
- `src/a.ts`: el servidor de A; qué ruta usa qué pieza. `src/http-get.ts`: el GET compartido, con un detalle de Node que la demo descubrió (ver «Problemas encontrados»).
- `spring/ClienteB.java`: lo mismo en Spring (Resilience4j 2.4 y `@Retryable`/`@ConcurrencyLimit` de Spring Framework 7). **No medido.**

## Requisitos

- Docker (probado con Docker Desktop, motor 29.9.2, Compose v5.6.0).
- Node.js 24 o superior en la máquina (probado con 24.19.0), solo para el script que orquesta las corridas. Node 24 ejecuta los `.ts` directamente: no hay paso de compilación.
- k6 **no** hace falta instalarlo: corre en un contenedor (`grafana/k6:2.3.0`).

## Cómo correrlo

```
npm install            # solo para el chequeo de tipos (npm run typecheck); A y B se instalan en su imagen
npm run up             # construye A y B, levanta A, B y Toxiproxy (espera a que estén sanos)
npm run r0             # línea base                    (~2 min)
npm run r1             # R1 sin protección             (~4 min)
npm run r2             # R2 timeout                    (~4 min)
npm run r3             # R3 timeout + reintentos       (~4 min)
npm run r4             # R4 sin espera / sin jitter / con jitter (~1 min)
npm run r5             # R5 circuit breaker            (~11 min)
npm run r6             # R6 bulkhead                   (~4 min)
npm run medir          # todo lo anterior seguido      (~30 min)
npm run down           # borra contenedores y red
```

Cada comando corre cada escenario 3 veces (`RONDAS=1 npm run r5` para una sola), guarda los datos crudos en `results/raw/` y regenera [`results/ESCENARIOS.md`](results/ESCENARIOS.md) con las medianas. `npm run informe` lo regenera sin volver a medir.

Para probar a mano (con `npm run up` hecho):

```
curl http://127.0.0.1:18200/r2                                   # una llamada con timeout
curl -X POST http://127.0.0.1:18210/proxies/b/toxics \
  -d '{"name":"lento","type":"latency","stream":"downstream","attributes":{"latency":2000}}'
curl -w " %{http_code} %{time_total}s\n" http://127.0.0.1:18200/r1   # tarda 2 s
curl -w " %{http_code} %{time_total}s\n" http://127.0.0.1:18200/r2   # 504 a los 300 ms
curl -X POST http://127.0.0.1:18210/reset                        # quita las fallas
curl http://127.0.0.1:18200/stats                                # contadores de A y estado del breaker
```

## Resultados de referencia

Medidos el 24 de octubre de 2026 en un portátil (Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11, Docker Desktop 29.9.2 con WSL2). k6, A, Toxiproxy y B corren en contenedores en la misma máquina. Mediana de 3 corridas por escenario; las tablas completas, con rangos, desgloses y la serie en el tiempo de R4, están en [`results/ESCENARIOS.md`](results/ESCENARIOS.md). La tabla de cada problema con su línea de código y su cifra está en [`DIFERENCIAS.md`](DIFERENCIAS.md).

**R0–R3** (50 pet/s, 30 s; en R1–R3 el 20 % de las llamadas a B tardan 2 s o se cuelgan). Latencia medida por k6, en ms:

| Escenario | p50 | p95 | % errores | Llamadas a B por petición | Llamadas colgadas en A al terminar |
|---|---:|---:|---:|---:|---:|
| R0 B sano, sin protección | 3,1 | 4,4 | 0 | 1,00 | 0 |
| R1 sin protección, 20 % lentas | 3,2 | 2004 | 0 | 1,00 | 0 |
| R1 sin protección, 20 % colgadas | 3,0 | 10 001 (k6 abandona a los 10 s) | 20,2 | 1,00 | **301** |
| R2 timeout 300 ms, 20 % lentas | 2,8 | 301 | 19,3 | 1,00 | 0 |
| R2 timeout 300 ms, 20 % colgadas | 2,8 | 301 | 21,1 | 1,00 | 0 |
| R3 timeout + 2 reintentos, 20 % lentas | 3,0 | 352 | **0,9** | 1,26 | 0 |
| R3 timeout + 2 reintentos, 20 % colgadas | 2,9 | 349 | **0,7** | 1,24 | 0 |

**R4** (B da 503 durante 1 s; llegan 50 peticiones a la vez; hasta 6 intentos):

| Reintentos | % errores | p50 (ms) | Llamadas que recibe B | Máx. de reintentos que llegan a B en 50 ms |
|---|---:|---:|---:|---:|
| `antes/`: enseguida, sin espera | **100** | 151 | 300 (en 200 ms) | 83 |
| Backoff 200→2000 ms, sin jitter | 0 | 1447 | 200 | 50 (los 50 juntos, 4 veces) |
| Backoff + jitter completo | 2,0 | 1456 | 254 | 19 |
| Backoff + jitter «igual» (mitad fija, mitad al azar) | 0 | 1243 | 219 | 28 |

**R5** (50 pet/s; B falla de los 10 a los 20 s; plazo de 500 ms):

| Variante | p50 durante la falla (ms) | Llamadas de A a B durante la falla (de ~500) | El breaker abre a los | % errores después de que B vuelve |
|---|---:|---:|---:|---:|
| B colgado, sin breaker | 501 | 500 | - | 0 |
| B colgado, breaker con ventana de 10 s | 500 | 253 | 5,0 s | 20,2 |
| B colgado, breaker con ventana de 2 s | **0,7** | **74** | 1,4 s | 9,8 |
| B caído, sin breaker | 1,6 | 500 | - | 0 |
| B caído, breaker con ventana de 10 s | 1,2 | 252 | 5,0 s | 10,4 |
| B caído, breaker con ventana de 2 s | 0,6 | **55** | 1,0 s | 11,0 |

**R6** (ruta lenta a 30 pet/s, cuyo B tarda 2 s, y ruta rápida a 50 pet/s, compartiendo un pool de 20 conexiones):

| Variante | Rápida: p95 (ms) | Rápida: % errores | Lenta: % errores |
|---|---:|---:|---:|
| Sin bulkhead | 2502 | **95,7** | 97,8 (timeouts) |
| Bulkhead de 10 en la ruta lenta | **3,9** | **0,0** | 83,4 (rechazadas al instante) |

**Úsenlos como orden de magnitud, no como verdad.** Todo corre en una máquina y las fallas son artificiales y limpias (latencia fija, conexión que nunca contesta, puerto cerrado).

## Qué enseña cada escenario

**R1. Sin plazo, la latencia de B es la latencia de A, y lo colgado se acumula.** Con el 20 % de las llamadas lentas, el p95 de A es exactamente el retraso de B (2004 ms). Con el 20 % colgadas es peor: k6 abandona a los 10 s, pero A no se entera (nada cancela su llamada a B) y termina la corrida con 301 llamadas abiertas, cada una con su socket y su memoria. Sostenido en el tiempo, eso agota descriptores de archivo o el pool de conexiones, y entonces fallan también las llamadas que estaban bien.

**R2. El timeout no arregla B: acota cuánto daño hace.** Con `AbortSignal.timeout(300)` el p95 queda en 301 ms pase lo que pase en B, y no queda nada colgado. El 20 % de llamadas malas sigue ahí, pero como un error rápido (504) en vez de una espera larga. Un timeout bien elegido está algo por encima de la latencia normal de B (aquí ~3 ms) y por debajo de lo que el cliente de A está dispuesto a esperar.

**R3. Los reintentos convierten errores pasajeros en éxitos, y los pagan con carga.** Como cada intento cae en una conexión nueva, la probabilidad de que los 3 sean malos es 0,2³ = 0,8 %; se midió 0,9 % y 0,7 %. El precio es un 25 % más de llamadas a B (1,26 por petición) y un p95 de 352 ms (un intento perdido más la espera). Solo vale para operaciones **idempotentes**: aquí todas son `GET`. Y si B falla porque está saturado, ese 25 % extra empeora su problema: por eso los reintentos van acotados.

**R4. Reintentar enseguida no sirve; sin jitter, los reintentos llegan en ráfagas.** El cliente de `antes/` gasta sus 6 intentos en unos 150 ms, mucho antes de que B se recupere al segundo: 100 % de errores y 300 llamadas a B en 200 ms. Con backoff exponencial todos llegan a B cuando ya volvió (0 % de errores), pero como todos esperan lo mismo, llegan **juntos**: 50 reintentos en el mismo intervalo de 50 ms, cuatro veces seguidas (la serie en el tiempo está en `results/ESCENARIOS.md`). Con jitter se reparten (19 como máximo con jitter completo). El jitter completo tiene un costo que no siempre se cuenta: algunas esperas al azar salen cortas, esos clientes agotan sus intentos antes de que B vuelva (2 % de errores) y B recibe más llamadas (254 frente a 200). El jitter «igual» queda en medio: 0 % de errores y picos de 28.

**R5. El breaker deja de llamar a un B que no responde, y su ventana decide cuándo.** Con B colgado y sin breaker, cada petición espera los 500 ms del plazo y A le lanza a B 500 llamadas que van a fallar. Con breaker y ventana de 2 s, abre a los 1,4 s: las peticiones fallan en 0,7 ms y B recibe solo 74 (las de antes de abrir y una de prueba cada 2 s). Con la ventana de 10 s, que es el valor por omisión de opossum, abre recién a los 5 s: el porcentaje de fallos se calcula sobre los últimos 10 s, y la mitad fueron buenos. Con B **caído** (conexión rechazada) fallar ya es rápido sin breaker (p50 1,6 ms); lo que ahorra ahí es carga sobre B (55 llamadas en vez de 500). El precio, en los dos casos: cuando B vuelve, el circuito sigue abierto hasta la siguiente llamada de prueba, y entre el 10 y el 20 % de las peticiones de los 10 s siguientes fallan sin necesidad (0 % sin breaker). Ese es el compromiso de `resetTimeout`.

**R6. Sin compartimentos, la dependencia lenta se lleva a la sana.** Las dos rutas comparten 20 conexiones salientes. La lenta necesita unas 60 a la vez (30 pet/s × 2 s), ocupa el pool entero, y la rápida, cuyo B está perfecto, espera una conexión hasta vencer su plazo: 95,7 % de errores. Con un límite de 10 llamadas a la vez en la ruta lenta, siempre quedan 10 conexiones para la rápida: 0 % de errores y p95 de 3,9 ms. La ruta lenta rechaza al instante lo que sobra (503 en ~1 ms), que es mejor que tenerlo esperando 2,5 s para fallar igual. En Node el bucle de eventos no se bloquea esperando a B, pero los pools sí se agotan (conexiones salientes, pool de la base de datos); en Java con hilos bloqueantes, lo que se agota son los hilos del servidor.

## Problemas encontrados al armar la demo

- **El timeout con `node:http` no era total** mientras la petición esperaba una conexión libre del pool: el error recién se emitía cuando el pool le daba un socket. En una corrida exploratoria de R6, la ruta rápida tenía un p50 de 16,9 s con un plazo de 2,5 s. Se corrigió en `src/http-get.ts` (rechazar apenas se aborta la señal); detalle en `DIFERENCIAS.md`.
- **«Colgado» con Toxiproxy hay que aplicarlo en el sentido A→B** (`stream: "upstream"`). Aplicado a la respuesta, B contesta, cierra su lado y Toxiproxy corta la conexión de A: se ve un `ECONNRESET` inmediato, no un cuelgue.
- **Toxiproxy decide la falla por conexión, no por petición.** Por eso A abre una conexión por llamada (`keepAlive: false`); con conexiones reutilizadas, «el 20 % de las llamadas» sería «todas las llamadas de algunas conexiones».
- **En R4, con 200 peticiones simultáneas, el propio stack era el cuello de botella** (la primera ola tardaba ~200 ms en entrar) y tapaba los picos. Con 50 se ven limpios.

## Decisiones de la demo

- **`node:http` y no NestJS**: el objeto de estudio es la llamada a B, no el framework; en NestJS las mismas piezas van en un servicio o un *interceptor*. `node:http` y no `fetch` para controlar el pool de conexiones (R6) y abrir una conexión por llamada; `fetch(url, { signal: AbortSignal.timeout(ms) })` es la misma idea.
- **TypeScript sin compilar**: Node 24 quita los tipos al cargar los `.ts` (solo sintaxis «borrable»: nada de `enum` ni `namespace`). `npm run typecheck` pasa `tsc` para verificar los tipos.
- **Reintentos y bulkhead escritos a mano** (unas 30 líneas) para que se vea que no hay magia; el circuit breaker con opossum, porque su máquina de estados (ventana, semiabierto) conviene no reinventarla.
- **k6 con modelo abierto** (`constant-arrival-rate`): las peticiones llegan a ritmo fijo aunque A se ponga lento, como con usuarios reales. Con un modelo cerrado (N usuarios que esperan su respuesta), un A lento recibiría menos carga y escondería el problema.
- **k6 solo como evidencia** de lo que hace cada protección, no para optimizar ni para comparar rendimiento.

## Versiones (verificadas el 24 de octubre de 2026)

| Software | Versión | Imagen o paquete |
|---|---|---|
| Node.js (A y B) | 24.22.1 | `node:24.22.1-slim@sha256:55fb5f5a…` |
| Toxiproxy | 2.13.0 (14 oct 2026) | `ghcr.io/shopify/toxiproxy:2.13.0@sha256:5d3dae09…` |
| k6 | 2.3.0 | `grafana/k6:2.3.0@sha256:2dd4756e…` |
| opossum | 10.0.0 (requiere Node 22, 24 o 26) | npm, versión exacta |
| TypeScript (solo `typecheck`) | 5.9.3 | npm, versión exacta |
| Resilience4j (solo el fragmento de Spring, no medido) | 2.4.0 | `io.github.resilience4j:resilience4j-spring-boot4:2.4.0` (existe en Maven Central) |
| Spring Framework (solo el fragmento, no medido) | 7.0.x (documentación consultada: 7.0.10) | `@Retryable`, `@ConcurrencyLimit`, `@EnableResilientMethods` en `org.springframework.resilience.annotation` |

Toxiproxy 2.13 agregó un token opcional para su API (`TOXIPROXY_AUTH_TOKEN`) y avisa en el log si la API no tiene token y escucha fuera de *loopback*. La demo no lo usa: la API solo se publica en `127.0.0.1`.

## Qué no se midió

- **El fragmento de Spring** (`spring/ClienteB.java`): equivalente en intención, no compilado ni corrido. Dos diferencias que importan, según la documentación de Spring 7: `@ConcurrencyLimit` hace **esperar** al hilo cuando se llega al límite (no rechaza como el bulkhead de la demo; el `@Bulkhead` de Resilience4j con `max-wait-duration: 0` sí rechaza), y el `jitter` de `@Retryable` suma un retardo al azar acotado por el valor que se le da, no es el «jitter completo» de la demo. Spring Framework 7 no trae circuit breaker: para eso, Resilience4j.
- **Una red real**: pérdida de paquetes, latencia variable, DNS, TLS.
- **El costo de las protecciones** en condiciones normales (muy pequeño frente a lo medido; no es el tema).
- **Los valores elegidos** (300 ms, 2 reintentos, ventana de 2 s, límite de 10) son ejemplos para estos tiempos, no recomendaciones.
- **Reintentar operaciones no idempotentes**, el **presupuesto de reintentos** y **propagar el plazo** a B: se explican en la sesión, no se miden aquí.
- **Failover, réplicas, alta disponibilidad, autoescalado o caos de infraestructura**: fuera del alcance de este módulo.
