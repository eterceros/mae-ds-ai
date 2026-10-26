# Experimentos y demos del docente – Módulo 8

> **Son demostraciones del docente: no hay nada que entregar.** Se publican para repasarlas después de clase y, si quieren, reproducirlas. Ninguna necesita claves ni tokens de servicios externos.

Este archivo reúne en un solo lugar las demos medidas del módulo y sus resultados principales. Las cifras están copiadas de los archivos `results/` de cada demo; allí están las tablas completas, con rangos y detalle.

| Demo | Sesión | Pregunta | Tiempo de la corrida completa | Resultados |
|---|---|---|---|---|
| [`demo-rest-graphql-grpc/`](demo-rest-graphql-grpc/) | 5 | ¿Cuándo conviene REST, GraphQL o gRPC sobre el mismo servicio? | ≈ 37-46 min (más `payloads` y `codec`) | [7 archivos](#1-rest-graphql-y-grpc-sobre-el-mismo-servicio-sesión-5) |
| [`demo-migraciones/`](demo-migraciones/) | 6 | ¿Qué migraciones de esquema cortan el servicio y cómo hacerlas sin cortarlo? | ≈ 95 min (≈ 30 min con `RONDAS=1`) | [3 archivos](#2-migraciones-de-esquema-sin-cortar-el-servicio-sesión-6) |
| [`demo-cache/`](demo-cache/) | 6 | ¿Cuándo ayuda una caché (Redis/Valkey), cuándo basta un índice y qué problemas trae? | ≈ 23 min | [5 archivos](#3-caché-con-postgres-redis-y-valkey-sesión-6) |
| [`demo-docker/`](demo-docker/) | 8 | ¿Qué cambia en tamaño, CVE, privilegios, secretos y arranque al corregir un Dockerfile y un Compose escritos con apuro? | ver el [README de la demo](demo-docker/README.md) (K1-K7) | [7 archivos](#4-docker-y-compose-antes-y-después-sesión-8) |
| [`demo-resiliencia/`](demo-resiliencia/) | 8 | ¿Qué protecciones en el código de una llamada (timeout, reintentos, breaker, bulkhead) evitan que un servicio lento o caído arrastre al que lo llama? | ≈ 30 min (`npm run medir`) | [1 archivo](#5-resiliencia-en-el-código-de-una-llamada-sesión-8) |
| [`demo-mensajeria/`](demo-mensajeria/) | 8 | ¿Qué se pierde o se duplica entre Postgres y RabbitMQ, y cómo se evita (outbox, idempotencia, DLQ, cola para el LLM)? | ≈ 50 min (Q7 ≈ 30 min) | [7 archivos](#6-mensajería-con-postgres-y-rabbitmq-sesión-8) |
| [`demo-k8s/`](demo-k8s/) | 11 | ¿Qué ven (y qué no) la validación contra el servidor y kube-linter en un manifiesto generado por IA, y qué hacen las probes, los Secrets y una HTTPRoute? | ver el [README de la demo](demo-k8s/README.md) (KA-KD; KB ≈ 30 min) | [5 archivos](#7-kubernetes-desde-el-desarrollador-sesión-11) |
| [`demo-otel/`](demo-otel/) | 11 | ¿Cómo se pasa de «el p95 es alto» a «este span de `precios`» con OpenTelemetry, y dónde se corta la traza? | ≈ 14 min (`oa-od` ≈ 8 min, `ob-oc` ≈ 6 min) | [4 archivos](#8-opentelemetry-aplicado-sesión-11) |
| [`demo-seguridad/`](demo-seguridad/) | 12 | ¿Qué deja pasar una API con OAuth 2 / OIDC ingenuo (BOLA, tokens manipulados, SSRF, servicios sin autenticar) y qué lo cierra? | ver el [README de la demo](demo-seguridad/README.md) (`npm run all`) | [7 archivos](#9-seguridad-de-apis-sesión-12) |

**Advertencia común:** cada demo se midió en **una sola máquina** (un portátil con Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11), con cliente y servidores juntos. Úsenlas como orden de magnitud y para ver **qué** cambia y **por qué**, no como cifras absolutas: en otro hardware, o con una red real entre máquinas, los números cambian y a veces también el orden.

---

## 1. REST, GraphQL y gRPC sobre el mismo servicio (sesión 5)

Carpeta: [`demo-rest-graphql-grpc/`](demo-rest-graphql-grpc/) · guion paso a paso: [`GUION.md`](demo-rest-graphql-grpc/GUION.md)

### Qué pregunta responde

¿Importa el estilo de API (REST, GraphQL, gRPC) en bytes, número de viajes, capacidad y latencia? ¿En qué condiciones gana cada uno? Un servicio de estudiantes en NestJS expone los mismos datos de las tres maneras, con una base simulada (1 ms por consulta, máximo 10 a la vez), y un gateway mide la comunicación servicio a servicio.

### Cómo correrla

Desde `m8/demo-rest-graphql-grpc/` (Node 22+; Docker solo para `network` y `stream`; Java 25+ y Maven solo para `java`; `openssl` solo para `tls`):

```
npm install
npm run build
npm start                 # en otra terminal
npm run payloads          # bytes, peticiones y consultas
npm run codec             # costo de JSON y protobuf (solo CPU)
npm run bench             # 10-15 min
npm run network           # 8-12 min (Docker + tc netem)
npm run stream            # ≈ 5 min (Docker)
npm run tls               # ≈ 8 min
(cd java-server && mvn -q package -DskipTests) && npm run java   # ≈ 6 min
```

Los tiempos son los que indica `GUION.md`; `payloads` y `codec` no tienen tiempo indicado.

### Cifras principales

| Medición | Variante | Cifra | Fuente |
|---|---|---|---|
| B. Lista de 2000, bytes del cuerpo | REST / GraphQL / gRPC | 213,080 / 213,103 / 146,059 | PAYLOADS |
| B. Lista de 2000, bytes con gzip | REST / GraphQL / gRPC | 17,534 / 17,566 / 17,445 | PAYLOADS |
| C. 50 estudiantes con cursos, peticiones y consultas a la base | REST ingenuo | 51 peticiones, 51 consultas | PAYLOADS |
| | REST con ?expand=courses | 1 petición, 2 consultas | PAYLOADS |
| | GraphQL sin dataloader (N+1) | 1 petición, 51 consultas | PAYLOADS |
| A. Un estudiante, máx. llamadas/s | REST / GraphQL / gRPC | 3026.8 / 1616.0 / 2103.5 | LATENCY |
| B. Lista de 2000, máx. llamadas/s | REST / GraphQL / gRPC | 331.0 / 64.0 / 147.0 | LATENCY |
| C. 50 con cursos, máx. llamadas/s | REST ingenuo / REST ?expand / GraphQL con dataloader / GraphQL N+1 / gRPC | 60.0 / 1267.8 / 268.8 / 140.5 / 792.0 | LATENCY |
| Codificar 2000 estudiantes (ms por operación) | JSON.stringify / protobuf | 0.295 / 0.847 | CODEC |
| N1. Lista de 2000 con 20 ms y 20mbit, p50 (ms) | REST sin comprimir / REST con gzip / gRPC / gRPC con ventana HTTP/2 ampliada | 116.9 / 37.0 / 118.4 / 91.6 | NETWORK |
| N2. 20 llamadas pequeñas en paralelo con red limitada, p50 (ms) | REST hasta 6 conexiones / REST sin tope / gRPC un canal | 101.7 / 31.2 / 32.4 | NETWORK |
| Servidor Java, lista de 2000, máx. llamadas/s | REST / gRPC | 265.5 / 331.3 | JAVA |
| Streaming con red limitada, primer estudiante (ms) | REST arreglo JSON / REST NDJSON / gRPC unario / gRPC streaming | 115.8 / 37.4 / 86.8 / 24.4 | STREAM |
| Conexión nueva en cada llamada, máx. llamadas/s | REST sin TLS / REST con TLS / gRPC sin TLS / gRPC con TLS | 475.0 / 142.3 / 73.7 / 50.0 | TLS |

Las cifras de capacidad y latencia son la mediana de 3 rondas (los rangos están en cada archivo).

### Conclusión

- **El diseño pesa más que el estilo.** El REST ingenuo de C (51 viajes) da 60.0 llamadas/s; el mismo REST con `?expand=courses` da 1267.8. GraphQL sin dataloader hace 51 consultas a la base.
- **Con servidor Node en una máquina, REST es el más rápido** (A y B); GraphQL pierde mucho en listas grandes.
- **gRPC gana en condiciones concretas:** menos bytes sin comprimir (que con red limitada se notan si se ajusta la ventana HTTP/2), muchas llamadas pequeñas frente a un tope de conexiones HTTP/1.1 (N2), *streaming* y servidor compilado (Java, lista de 2000). Pero REST con gzip supera a todos en N1, y abrir una conexión nueva por llamada castiga mucho a gRPC.
- **No hay un ganador:** "gRPC es más rápido" no es una regla; depende del escenario.

### Máquina, versiones y advertencias

- Medido el 21 de octubre de 2026 en el portátil indicado arriba; cliente Node (probado con Node 24.19) y servidor en la misma máquina (loopback).
- En `network` y `stream` el servidor corre en un contenedor Docker (`node:22-alpine`); en `JAVA.md` el servidor es Spring Boot 4.1.1 y grpc-java 1.83.1 (Java 26.0.2). **No se pueden comparar cifras de Java con cifras de Node.**
- La base de datos es simulada; no mide ninguna base real.
- La primera versión de la demo daba resultados que contradecían la teoría por errores del experimento; `GUION.md` (sección 10) cuenta cuáles fueron.

### Archivos de resultados

[`PAYLOADS.md`](demo-rest-graphql-grpc/results/PAYLOADS.md) ·
[`LATENCY.md`](demo-rest-graphql-grpc/results/LATENCY.md) ·
[`CODEC.md`](demo-rest-graphql-grpc/results/CODEC.md) ·
[`NETWORK.md`](demo-rest-graphql-grpc/results/NETWORK.md) ·
[`JAVA.md`](demo-rest-graphql-grpc/results/JAVA.md) ·
[`STREAM.md`](demo-rest-graphql-grpc/results/STREAM.md) ·
[`TLS.md`](demo-rest-graphql-grpc/results/TLS.md)

---

## 2. Migraciones de esquema sin cortar el servicio (sesión 6)

Carpeta: [`demo-migraciones/`](demo-migraciones/)

### Qué pregunta responde

¿Qué bloqueo toma cada `ALTER` en Postgres y cuánto tráfico de la aplicación detiene, y cómo se hace la misma migración sin cortar el servicio? Sobre una tabla `pedidos` de 10 millones de filas, con una carga de 200 peticiones/s (pool de 20 conexiones), se aplica cada migración en versión **ingenua** y **segura** (M1–M8); además, qué detecta el linter Squawk (M9) y qué SQL generan Prisma y Flyway al renombrar una columna (M10).

### Cómo correrla

Desde `m8/demo-migraciones/` (Docker, Node 22+, unos 12 GB libres en el disco de Docker; Java 21+ y Maven solo para la parte de Flyway):

```
npm install
npm run db:up          # Postgres 17 en 127.0.0.1:18543
npm run preparar       # plantilla con 10 M filas (≈ 35 s)
npm run escenarios     # M1–M8, 3 rondas (≈ 95 min; RONDAS=1 para ≈ 30 min)
npm run sql            # exporta las migraciones a archivos .sql
npm run squawk         # M9
npm run orm            # M10 (Prisma y Flyway)
npm run db:down        # borra el contenedor y su volumen
```

O todo seguido (menos `db:down`): `npm run todo`. Con `FILAS=2000000` se ven los mismos patrones en una quinta parte del tiempo.

### Cifras principales

Medianas de 3 rondas, de [`ESCENARIOS.md`](demo-migraciones/results/ESCENARIOS.md). "Bloqueadas" = peticiones de la aplicación que tardaron más de 100 ms.

| Escenario | Variante | Duración (s) | Bloqueadas | Pausa máx. (ms) |
|---|---|---:|---:|---:|
| M1 `ADD COLUMN` | ingenua | 0.005 | 0 | 21 |
| | segura | 0.009 | 0 | 14 |
| M2 default volátil | ingenua | 12.71 | 2628 | 12637 |
| | segura | 78.63 | 549 | 515 |
| M3 `int → bigint` | ingenua | 8.15 | 1653 | 8068 |
| | segura | 93.28 | 463 | 1368 |
| M4 índice | ingenua | 1.78 | 281 | 1760 |
| | segura (`CONCURRENTLY`) | 3.23 | 0 | 18 |
| M5 `SET NOT NULL` | ingenua | 0.49 | 81 | 486 |
| | segura | 0.35 | 0 | 28 |
| M6 FK | ingenua | 0.55 | 27 | 535 |
| | segura | 0.55 | 0 | 24 |
| M7 relleno | ingenua (un `UPDATE`) | 81.05 | 14858 | 79539 |
| | segura, lotes de 50000 | 77.33 | 8 | 242 |
| | segura, lotes de 5000 y pausa de 20 ms | 123.74 | 156 | 905 |
| M8 cola de bloqueos | ingenua | 8.03 | 1636 | 8001 |
| | segura (`lock_timeout` + reintentos) | 8.48 | 270 | 215 |

M9 ([`SQUAWK.md`](demo-migraciones/results/SQUAWK.md)): 31 avisos en las 8 migraciones ingenuas, 61 en las seguras. M10 ([`ORM.md`](demo-migraciones/results/ORM.md)): Prisma convierte el renombre en `DROP COLUMN` + `ADD COLUMN` y los teléfonos se pierden; Flyway aplica el `RENAME COLUMN` escrito a mano y los conserva.

### Conclusión

- **Las versiones ingenuas que reescriben o recorren la tabla con un bloqueo fuerte detienen el tráfico entero** mientras duran (M2, M3, M7, M8); las seguras tardan igual o más, pero la aplicación casi no lo nota.
- **Un bloqueo que "solo afecta escrituras" también frena lecturas** (M4, M7): las escrituras en espera retienen las conexiones del pool y las lecturas hacen cola en la aplicación.
- **Un `ALTER` de milisegundos puede tumbar el servicio** si espera detrás de una transacción larga (M8); `lock_timeout` con reintentos lo evita.
- **Las herramientas ayudan pero no bastan:** Squawk no ve el `UPDATE` gigante de M7, y Prisma convierte un renombre en pérdida de datos. Hay que leer el SQL y medir con la carga real (lotes más chicos no siempre es mejor: M7).

### Máquina, versiones y advertencias

- Medido el 22 de octubre de 2026 en el portátil indicado arriba, con Docker 29.9.2 (Docker Desktop con WSL2; 20 CPU y 31 GB para la VM), PostgreSQL 17.11 (`shared_buffers=2GB`), Node v24.19.0 y `pg` 8.23.1. Squawk 2.70.0, Prisma 7.10.1, Flyway 13.11.1.
- **Una sola máquina:** Postgres, el cliente de carga y el monitor comparten CPU y disco. Lo que se mantiene en otro hardware es el orden (qué bloquea y qué no) y la forma (quién espera a quién), no las duraciones.
- Las variantes seguras con rellenos largos (M2, M3 y M7 seguras) tienen rangos amplios entre rondas; las cifras de las migraciones de milisegundos (M1, M2 constante) son ruido de la máquina.
- La carga es pequeña y uniforme, y el umbral de 100 ms es arbitrario (sirve para contar, no es un SLO).

### Archivos de resultados

[`ESCENARIOS.md`](demo-migraciones/results/ESCENARIOS.md) ·
[`SQUAWK.md`](demo-migraciones/results/SQUAWK.md) ·
[`ORM.md`](demo-migraciones/results/ORM.md) ·
datos crudos en [`results/json/`](demo-migraciones/results/json/)

---

## 3. Caché con Postgres, Redis y Valkey (sesión 6)

Carpeta: [`demo-cache/`](demo-cache/)

### Qué pregunta responde

¿Cuánto mejora una caché una consulta costosa, cuándo basta con un índice o con `ETag`, y qué problemas trae la caché (estampida, datos obsoletos, memoria llena)? Además: ¿Valkey sirve como reemplazo de Redis con el mismo código?, y dos usos que no son caché (*rate limiting* y rankings). Una API en Node (Fastify) sirve el resumen de ventas de un producto sobre una tabla `orders` de 3 millones de filas.

### Cómo correrla

Desde `m8/demo-cache/` (Docker y Node 22+):

```
npm install
npm run up            # Postgres, Redis y Valkey en Docker
npm run seed          # ≈ 10 s
npm run read          # C1-C5, ≈ 10 min
npm run stampede      # C6, ≈ 3 min
npm run stale         # C7, ≈ 2 min
npm run structures    # C8, ≈ 1 min
npm run eviction      # C9, ≈ 7 min
npm run down          # borra contenedores y datos
```

### Cifras principales

**C1-C5. Lecturas** (mediana de 3 rondas; sin índice salvo C2):

| Variante | Máx. pet/s | p50 (ms) | p99 (ms) | Consultas a PG por 1000 pet. |
|---|---:|---:|---:|---:|
| C1 sin caché | 71.0 | 46.3 | 61.4 | 1000 |
| C3a ETag sobre el cuerpo | 66.3 | 47.5 | 75.7 | 1000 |
| C3b ETag por versión del producto | 116.8 | 2.7 | 55.5 | 1554 |
| C4 Redis cache-aside, TTL 30 s | 130.3 | 2.7 | 58.8 | 549 |
| C5 Valkey cache-aside, TTL 30 s | 128.5 | 2.6 | 61.5 | 551 |
| C2 solo índice | 2323.5 | 2.0 | 6.1 | 1000 |
| C2 + Redis cache-aside, TTL 30 s | 2396.8 | 1.4 | 5.5 | 190 |

**C6. Estampida** (consultas a Postgres al vencer una clave caliente, dos instancias de la API):

| Defensa | Ráfaga de 200 peticiones | Carga sostenida 10 s (TTL 1000 ms) | p99 sostenido (ms) |
|---|---:|---:|---:|
| Sin defensa | 200 | 400 | 410.2 |
| Single-flight por proceso | 2 | 18 | 51.1 |
| Candado distribuido (SET NX PX) | 1 | 9 | 59.0 |
| XFetch | 50 | 47 | 45.7 |
| Stale-while-revalidate | 1 | 10 | 47.9 |

**C7. Datos obsoletos** (TTL 5 s, ventana mediana): solo TTL 2063 ms; invalidar al escribir 38 ms; invalidar con una lectura lenta en vuelo 5064 ms; con doble borrado 345 ms.

**C8. Estructuras:** en el borde entre dos segundos, la ventana fija acepta 20 peticiones en ~100 ms y la deslizante 10 (límite: 10 por s). Top 10 de productos: SQL p50 138.8 ms; `ZREVRANGE` p50 0.7 ms (Redis) y 0.6 ms (Valkey).

**C9. Expulsión** (`maxmemory 16mb`, aciertos en Redis): con solo Zipf, `allkeys-lru` 84.0 % y `allkeys-lfu` 84.9 %; con Zipf + barridos, `allkeys-lru` 71.8 % y `allkeys-lfu` 80.0 %. Con `noeviction`, 22115 escrituras rechazadas (solo Zipf).

### Conclusión

- **Primero el plan, después la caché:** un índice cubriente lleva la API de 71.0 a 2323.5 pet/s sin caché; Redis encima de ese índice casi no agrega capacidad.
- **Cache-aside mejora la mediana, no la cola:** el p50 baja de 46.3 a 2.7 ms, pero el p99 sigue alto (58.8 ms en C4) porque lo ponen los fallos. Un `ETag` sobre el cuerpo ahorra bytes, no trabajo; uno basado en una versión barata ahorra las dos cosas.
- **La caché trae problemas propios:** sin defensa, una clave caliente que vence manda 200 consultas a la base; invalidar al escribir no basta si hay una lectura lenta en vuelo (carrera de cache-aside); con barridos, LFU protege mejor que LRU.
- **Valkey se comporta como Redis** con el mismo cliente (`ioredis`) y el mismo código, con cifras equivalentes.

### Máquina, versiones y advertencias

- Medido el 22 de octubre de 2026 en el portátil indicado arriba, con Node v24.19.0, PostgreSQL 17.11, Redis 8.10.2 y Valkey 9.1.2 en Docker Desktop (motor 29.9.2).
- **Una sola máquina:** la API, el cliente y los servidores comparten CPU; las latencias de Redis/Valkey incluyen el *loopback* de Docker Desktop en Windows. El cliente de carga es un solo proceso Node y en C2 puede ser él el límite.
- Los aciertos dependen de la carga supuesta (Zipf con s = 1 sobre 5000 productos); con otra distribución o TTL cambian mucho.
- C7 provoca la carrera a propósito, y C9 no pasa por la API ni por Postgres (simula cache-aside contra el servidor). Redis y Valkey corren sin persistencia.
- Licencias de Redis y Valkey: ver el [README de la demo](demo-cache/README.md#versiones-y-licencias-verificadas-el-22-de-octubre-de-2026).

### Archivos de resultados

[`C1-C5_LECTURAS.md`](demo-cache/results/C1-C5_LECTURAS.md) ·
[`C6_ESTAMPIDA.md`](demo-cache/results/C6_ESTAMPIDA.md) ·
[`C7_OBSOLETOS.md`](demo-cache/results/C7_OBSOLETOS.md) ·
[`C8_ESTRUCTURAS.md`](demo-cache/results/C8_ESTRUCTURAS.md) ·
[`C9_EXPULSION.md`](demo-cache/results/C9_EXPULSION.md)


---

## 4. Docker y Compose, antes y después (sesión 8)

Carpeta: [`demo-docker/`](demo-docker/) · tabla de problemas y cifras: [`DIFERENCIAS.md`](demo-docker/DIFERENCIAS.md)

### Qué pregunta responde

¿Cuánto mejoran la imagen y el arranque de una API NestJS (que lee Postgres) al pasar de un Dockerfile y un Compose «como salen con apuro o de una IA sin revisar» (`antes/`) a su versión corregida (`despues/`)? Cada corrección está comentada con `# CORRECCIÓN:` en el código.

### Cifras principales

De [`DIFERENCIAS.md`](demo-docker/DIFERENCIAS.md) (24 de octubre de 2026):

| Escenario | De `antes/` a `despues/` |
|---|---|
| K1. Multi-stage y orden de capas | 1,74 GB → 357 MB en disco; rebuild tras cambiar `src/main.ts`: 9,4 s → 2,4 s |
| K2. Base | 4641 CVE (21 críticas) con `node:24` → 245 (1 crítica) con slim; 16 con Alpine; 32 con distroless o Docker Hardened Image |
| K3. Usuario | uid 0 → 1000; 14 → 0 capacidades efectivas |
| K4. Secretos | token visible en `docker history`: sí → no; hallazgos en las capas: 3 → 0 |
| K5. Healthcheck | con volumen vacío, la API arrancó bien en 0 de 5 → 5 de 5 |
| K6. Migraciones como servicio | orden garantizado en 3 de 3; con una migración rota, la API no arranca |
| K7. Dockerfile generado por IA | el de un modelo local chico no construye; el de Gordon construye pero el proceso puede reescribir su propio código, y hadolint no lo marca |

### Para qué les sirve

- **Actividad 5 (`compose.yaml`):** `despues/compose.yaml` es el modelo de healthcheck, `depends_on` con condición y migraciones como servicio.
- **Laboratorio de la S08:** [`laboratorio-s08/`](laboratorio-s08/) (auditar/adelgazar la imagen o Podman; entregable `docs/laboratorios/imagen-o-podman.md`, fecha sugerida: domingo 1 de noviembre, 23:59; se reciben hasta el vie 13 nov, 23:59). La demo es material de apoyo para comparar, no para copiar.

### Advertencias

- Una sola máquina (la indicada arriba). El escenario con Podman (K8) todavía no tiene resultados publicados.
- El `Dockerfile` de Spring Boot de `despues/spring/` es una plantilla no medida.

### Archivos de resultados

[`K1_MULTISTAGE.md`](demo-docker/results/K1_MULTISTAGE.md) ·
[`K2_BASES.md`](demo-docker/results/K2_BASES.md) ·
[`K3_USUARIO.md`](demo-docker/results/K3_USUARIO.md) ·
[`K4_SECRETOS.md`](demo-docker/results/K4_SECRETOS.md) ·
[`K5_HEALTHCHECK.md`](demo-docker/results/K5_HEALTHCHECK.md) ·
[`K6_MIGRACIONES.md`](demo-docker/results/K6_MIGRACIONES.md) ·
[`K7_IA.md`](demo-docker/results/K7_IA.md)

---

## 5. Resiliencia en el código de una llamada (sesión 8)

Carpeta: [`demo-resiliencia/`](demo-resiliencia/) · tabla de problemas y cifras: [`DIFERENCIAS.md`](demo-resiliencia/DIFERENCIAS.md)

**Referencia para el experimento E3 (resiliencia); fecha sugerida de entrega: lunes 9 de noviembre; se reciben hasta el vie 13 nov, 23:59.**

### Qué pregunta responde

Un servicio A llama a un servicio B; con Toxiproxy se hace que B tarde, se cuelgue o cierre el puerto. ¿Qué le pasa a A sin protección (`src/antes/`) y con cada protección escrita en el código (`src/despues/`): timeout, reintentos con backoff y *jitter*, circuit breaker (opossum 10) y bulkhead?

### Cifras principales

Medianas de 3 corridas, de [`ESCENARIOS.md`](demo-resiliencia/results/ESCENARIOS.md) (50 peticiones/s durante 30 s; 20 % de las llamadas a B afectadas en R1-R3):

| Escenario | Variante | Resultado |
|---|---|---|
| R1, B colgado | sin protección | p95 10001 ms; 20,2 % de errores; 301 llamadas colgadas al terminar |
| R2, B colgado | timeout de 300 ms | p95 301 ms; 21,1 % de errores (rápidos); 0 colgadas |
| R3, B colgado | timeout + 2 reintentos con backoff y *jitter* | p95 349 ms; 0,7 % de errores; 1,24 llamadas a B por petición |
| R4, 50 peticiones tras un 503 | sin espera / sin *jitter* / *jitter* completo | máx. de reintentos que llegan a B en 50 ms: 83 / 50 / 19 |
| R5, B colgado 10 s | sin breaker / breaker (ventana de 2 s) | llamadas de A a B durante la falla: 500 / 74 |
| R6, ruta lenta + ruta sana | sin bulkhead / con bulkhead (límite 10) | errores de la ruta sana: 95,7 % / 0,0 % |

### Conclusión

- **Sin plazo, la lentitud de B se vuelve la de A** y una conexión colgada no termina nunca; el timeout lo acota a cambio de errores rápidos.
- **Los reintentos convierten esos errores en éxitos** (solo si la operación es idempotente), pero sin espera ni *jitter* los clientes golpean juntos a un B que se está recuperando.
- **El breaker y el bulkhead protegen a B y a las rutas sanas de A** de una dependencia mala.

### Advertencias

- Una sola máquina, red de Docker Desktop y fallas inyectadas; los parámetros (300 ms, 2 reintentos, límite 10) son ejemplos, no recomendaciones.
- El fragmento de Spring (`spring/ClienteB.java`) no está medido.

### Archivos de resultados

[`ESCENARIOS.md`](demo-resiliencia/results/ESCENARIOS.md) · datos crudos en [`results/raw/`](demo-resiliencia/results/raw/)

---

## 6. Mensajería con Postgres y RabbitMQ (sesión 8)

Carpeta: [`demo-mensajeria/`](demo-mensajeria/) · tabla de problemas y cifras: [`DIFERENCIAS.md`](demo-mensajeria/DIFERENCIAS.md)

**Referencia para el experimento E4 (mensajería, incluye un LLM local con Docker Model Runner); fecha sugerida de entrega: lunes 9 de noviembre; se reciben hasta el vie 13 nov, 23:59.**

### Qué pregunta responde

Una API de pedidos avisa a otro servicio por RabbitMQ 4.4. Matando procesos de verdad en el punto crítico y contando mensajes uno por uno: ¿qué se pierde y qué se duplica con la doble escritura y con un consumidor sin idempotencia (`src/antes/`), y qué cambia con outbox, idempotencia, reintentos limitados y DLQ (`src/despues/`)? Q7 es el caso del E4: llamar a un LLM local dentro de la petición frente a `202` + cola + worker.

### Cifras principales

De [`ESCENARIOS.md`](demo-mensajeria/results/ESCENARIOS.md) (24 de octubre de 2026; 3 corridas):

| Escenario | Resultado |
|---|---|
| Q1, doble escritura; la API muere 10 veces en 1000 pedidos | 10 eventos perdidos (`COMMIT` → `publish`) o 10 eventos fantasma (`publish` → `COMMIT`) |
| Q2, outbox + 2 relays con `SKIP LOCKED` | 0 perdidos, 0 fantasma; 142-172 duplicados («al menos una vez») |
| Q3 / Q4, consumidor sin / con tabla de procesados | 296-407 envíos duplicados por cada 1000 pedidos / 0 |
| Q5, mensaje venenoso | `reject(requeue=true)`: 4 intentos y a la DLQ; `nack(requeue=true)`: 1618-3057 intentos en 10 s y nunca llega a la DLQ |
| Q6, reintento con retardo | nativo de quorum queues, `x-opt-delivery-time` y DLX + TTL cumplen el plan con error de decenas de ms; el TTL por mensaje bloquea la cabeza de la cola |
| Q7 (E4), síncrono a 20 pet/s | 383-395 de ~476 peticiones con 504; p95 de 10 s |
| Q7 (E4), `202` + cola + worker a 20 pet/s | 600/600 con `202` (mediana 3 ms) y 600/600 hechos; al matar el worker, 0 perdidos |
| Q8, AsyncAPI 3.1 | `asyncapi diff` no marca como incompatible renombrar un campo obligatorio (0 *breaking*); validar mensajes reales contra el esquema sí lo detecta (0/200 válidos) |

### Conclusión

- **Postgres y RabbitMQ no comparten transacción:** la outbox evita perder eventos pero da «al menos una vez»; la idempotencia del consumidor evita los duplicados.
- **Cómo se dice «falló» importa:** en RabbitMQ 4.4 solo `reject(requeue=true)` cuenta para el límite de entregas.
- **Con un LLM lento, una cola absorbe la carga** que de otro modo termina en timeouts en cascada, a cambio de latencia hasta el resultado.

### Máquina, versiones y advertencias

- Una sola máquina. Docker Model Runner usó llama.cpp **en CPU** con `ai/smollm2` (256 MiB); con GPU cambian las cifras absolutas de Q7, no el mecanismo. Para Q7 hay que activar Model Runner y descargar el modelo (ver los [requisitos de la demo](demo-mensajeria/README.md#requisitos)).
- No se midió el rendimiento máximo de RabbitMQ, del relay ni del worker.

### Archivos de resultados

[`ESCENARIOS.md`](demo-mensajeria/results/ESCENARIOS.md) ·
[`Q1-Q2_OUTBOX.md`](demo-mensajeria/results/Q1-Q2_OUTBOX.md) ·
[`Q3-Q4_IDEMPOTENCIA.md`](demo-mensajeria/results/Q3-Q4_IDEMPOTENCIA.md) ·
[`Q5_VENENOSO.md`](demo-mensajeria/results/Q5_VENENOSO.md) ·
[`Q6_RETARDO.md`](demo-mensajeria/results/Q6_RETARDO.md) ·
[`Q7_E4_LLM.md`](demo-mensajeria/results/Q7_E4_LLM.md) ·
[`Q8_ASYNCAPI.md`](demo-mensajeria/results/Q8_ASYNCAPI.md)

---

## 7. Kubernetes desde el desarrollador (sesión 11)

Carpeta: [`demo-k8s/`](demo-k8s/) · laboratorio relacionado: [`laboratorio-s11/`](laboratorio-s11/)

**Modelo para la actividad 8 (manifiestos de Kubernetes, carpeta `k8s/`; se inicia en el laboratorio de la S11); fecha sugerida de entrega: miércoles 11 de noviembre, 23:59; se reciben hasta el vie 13 nov, 23:59.**

### Qué pregunta responde

Dos servicios sin estado (`api` y `precios`) pasan de Compose a un clúster local kind con Deployment, Service, ConfigMap, Secret, probes, `requests/limits` y una HTTPRoute. Escenarios: KA (manifiesto generado por IA frente a `--dry-run=server` y kube-linter), KB (una liveness que consulta una dependencia), KC (Secret como variable o como archivo) y KD (HTTPRoute).

### Cifras principales

De [`ESCENARIOS.md`](demo-k8s/results/ESCENARIOS.md) (26 de octubre de 2026; KA 3 corridas, KB 3 por variante, KC 3 rotaciones, KD una vez):

| Escenario | De `antes` a `despues` |
|---|---|
| KA. Manifiesto generado por IA | 7 errores del servidor en 3 rondas y 11 hallazgos de kube-linter; con los dos en verde (`ka-2`): 4 reinicios en 90 s, `precios` 0/1 listo, 0 de 200 peticiones correctas → 0 errores, 0 hallazgos, 200 de 200 |
| KB. Liveness con dependencia (`precios` caído 90 s, 10 peticiones/s durante 240 s) | 8 reinicios (8–9); los 2 pods de vuelta en el Service tras 2 s (2–56 s) → 0 reinicios; los 2 pods de vuelta tras 0 s (0–2 s) |
| KC. Secret | variable: valor visible en `env` y `/proc/1/environ`; tras rotar, no lo ve nunca (0 de 3 a los 180 s) sin reiniciar → archivo: no está en el entorno; tras rotar lo ve sin reiniciar en 62,2 s de mediana (26–83,6 s) |
| KD. HTTPRoute | `Accepted` y `ResolvedRefs` en `True`; 200 de 200 respuestas `200`; 40 de 40 `404` en rutas no declaradas |

KC, además: `base64 -d` devuelve el valor original sin ninguna clave (base64 no es cifrado), por eso el Secret se crea con `kubectl create secret … --from-literal` y no desde un archivo del repositorio; con `kubectl exec` el valor se lee igual de las dos formas ([`KC_SECRETOS.md`](demo-k8s/results/KC_SECRETOS.md)).

### Conclusión

- **Cada herramienta ve una capa.** El servidor y kube-linter no saben qué rutas expone la app ni en qué puerto escucha: hay que aplicar el manifiesto y mirar (`kubectl get pods`, `describe`, una petición real).
- **La liveness no debe consultar dependencias:** una caída ajena se vuelve reinicios propios (8 en 90 s); la readiness solo saca al pod del Service.
- **El Secret como archivo se actualiza solo** (≈ 1 min, lo fija el kubelet); como variable, solo al reiniciar el pod.

### Advertencias

- Una sola máquina (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop con WSL2), un clúster kind de un solo nodo (Kubernetes 1.37.0). El controlador del Gateway (Envoy Gateway v1.9.2) lo instala el docente y no se explica en clase.
- No se midieron latencia ni consumo de CPU/memoria (los `requests/limits` están declarados sin afinar), ni más de un nodo, ni otro controlador de Gateway. Ver «Qué no se midió» en `ESCENARIOS.md`.

### Archivos de resultados

[`ESCENARIOS.md`](demo-k8s/results/ESCENARIOS.md) ·
[`KA_VALIDACION.md`](demo-k8s/results/KA_VALIDACION.md) ·
[`KB_PROBES.md`](demo-k8s/results/KB_PROBES.md) ·
[`KC_SECRETOS.md`](demo-k8s/results/KC_SECRETOS.md) ·
[`KD_HTTPROUTE.md`](demo-k8s/results/KD_HTTPROUTE.md)

---

## 8. OpenTelemetry aplicado (sesión 11)

Carpeta: [`demo-otel/`](demo-otel/)

### Qué pregunta responde

Una API de pedidos en NestJS 12 llama a `precios` (600 ms en 1 de cada 10 peticiones), guarda el pedido y su evento por outbox y lo publica en RabbitMQ para un worker. Escenarios: OA (con k6 solo se ve el p95; con trazas, dónde se va el tiempo), OB (la traza se corta en la outbox si no se lleva el contexto), OC (el `trace_id` en los logs y en Loki) y OD (del p95 de k6 a la traza más lenta, paso a paso).

### Cifras principales

De [`ESCENARIOS.md`](demo-otel/results/ESCENARIOS.md) (26 de octubre de 2026; 3 corridas por escenario, alternando `antes` y `despues`; mediana donde se indica):

| Escenario | De `antes` a `despues` |
|---|---|
| OA. p95 alto (k6 a 20 pedidos/s durante 30 s, ~600 peticiones) | sin instrumentar: p50 9,9 ms, p95 606,0 ms (mediana de 3), y nada más → instrumentado: p50 11,7 ms, p95 606,9 ms; la traza más lenta muestra `precios` = 77-89 % del tiempo; de las 186 peticiones de más de 300 ms, 180 por `precios` (10 de ellas también con un `COMMIT` lento) y 6 solo por el `COMMIT` de Postgres |
| OB. Traza por la outbox y la cola (100 pedidos con trace-id conocido) | con la auto-instrumentación sobre el código de la S08: 0 de 100 trazas completas; el worker queda en 100 trazas nuevas que empiezan en el relay → 100 de 100 completas (API → `precios` → Postgres → relay → RabbitMQ → worker, 14 spans) |
| OC. Logs con trace id | API: 100/100 con el trace id correcto (lo arma a mano); worker: 0/100 (escribe el del relay); 0 líneas en Loki (`console.log`) → API y worker: 100/100 con el `trace_id` de la petición, sin código; 100/100 encontrados en Loki por `trace_id` |
| OD. De la cifra a la traza (TraceQL con `duration >= p95`) | no hay trazas → 29-33 trazas por corrida (todas de esa prueba); la más lenta de Tempo es la más lenta de k6 en 3 de 3; la búsqueda tardó ~30-40 s en ver las trazas nuevas |

Además, la API de `despues` sin el gancho ESM (`--experimental-loader`) pierde los spans de Express, el nombre de la ruta en el span (`POST` en vez de `POST /pedidos`) y el `trace_id` de los logs de pino (0 de 20); siguen los de HTTP, `fetch` y Postgres.

### Conclusión

- **El p95 dice que algo tarda, no qué:** la traza más lenta señala a `precios` (600 ms) y, en un 3 % de los casos lentos, al `COMMIT` de Postgres, que el p95 solo no muestra.
- **La auto-instrumentación no lleva el contexto por una tabla:** con la outbox la traza se corta en el relay; se corrige con `propagation.inject` en la API y `propagation.extract` + `context.with` en el relay.
- **Con pino instrumentado, cada log lleva el `trace_id` real** sin escribir una línea; `console.log` no llega a Loki.

### Advertencias

- Una sola máquina (Intel Core i9-12900H, 64 GB, Windows 11, Docker Desktop con WSL2). `grafana/otel-lgtm` es solo para desarrollo local.
- El costo de instrumentar (p50 de ~10 a ~12 ms, exportación cada 5 s) no es un estudio de *overhead*. No se probó NestJS 11 con la instrumentación propia de Nest, ni el agente Java, ni muestreo, ni varias réplicas del relay o del worker. Ver «Qué no se midió» en `ESCENARIOS.md`.

### Archivos de resultados

[`ESCENARIOS.md`](demo-otel/results/ESCENARIOS.md) ·
[`OA-OD_P95_A_TRAZA.md`](demo-otel/results/OA-OD_P95_A_TRAZA.md) ·
[`OA_DESGLOSE.md`](demo-otel/results/OA_DESGLOSE.md) ·
[`OB-OC_COLA_Y_LOGS.md`](demo-otel/results/OB-OC_COLA_Y_LOGS.md)

---

## 9. Seguridad de APIs (sesión 12)

Carpeta: [`demo-seguridad/`](demo-seguridad/) · tabla de problemas y cifras: [`DIFERENCIAS.md`](demo-seguridad/DIFERENCIAS.md)

**Modelo para la actividad 9 (seguridad de la API de su proyecto); fecha sugerida de entrega: miércoles 11 de noviembre, 23:59; se reciben hasta el vie 13 nov, 23:59.**

### Qué pregunta responde

Una API de pedidos en NestJS protegida con Keycloak 26.8.1 local, en versión ingenua (`antes/`) y corregida (`despues/`): ¿qué deja pasar y qué lo cierra? Es material defensivo: todos los «ataques» son contra la propia demo.

### Cifras principales

De [`ESCENARIOS.md`](demo-seguridad/results/ESCENARIOS.md) (26 de octubre de 2026):

| Escenario | De `antes` a `despues` |
|---|---|
| SA. BOLA | Alice lee 5/5 y modifica 5/5 pedidos de Bob → 0/5 y 0/5 (404; dueño comparado por `sub`) |
| SB. Tokens manipulados | 6/6 aceptados → 0/6; el token válido da 200 en ambos. Anexo: reuso de un refresh token 200 con «Revoke Refresh Token» apagado → 400 encendido (y el R2 legítimo, también 400) |
| SC. Límite por identidad | Bob recibe 10/10 `429` por culpa de Alice (límite por IP) → 0/10 (límite por `sub`) |
| SD. SSRF | el secreto interno se filtra por 4 de 8 destinos internos (loopback, `localhost`, `0.0.0.0`, `[::ffff:127.0.0.1]`) → 0 filtrados y 8/8 bloqueados |
| SE. Entre servicios | `precios` acepta las 3 llamadas → solo el token de servicio (sin token y token de usuario: 401) |

### Advertencias

- Una sola máquina (Intel Core i9-12900H, Windows, Docker Desktop con WSL2). Keycloak corre en `start-dev` con un realm de juguete. El fragmento de Spring Security no se ejecuta ni se mide. SD depende del sistema: en Linux o macOS `antes` puede filtrar por otras vías (`[::]`).

### Archivos de resultados

[`ESCENARIOS.md`](demo-seguridad/results/ESCENARIOS.md) ·
[`SA_BOLA.md`](demo-seguridad/results/SA_BOLA.md) ·
[`SB_TOKENS.md`](demo-seguridad/results/SB_TOKENS.md) ·
[`SB_REFRESH.md`](demo-seguridad/results/SB_REFRESH.md) ·
[`SC_RATELIMIT.md`](demo-seguridad/results/SC_RATELIMIT.md) ·
[`SD_SSRF.md`](demo-seguridad/results/SD_SSRF.md) ·
[`SE_SERVICIOS.md`](demo-seguridad/results/SE_SERVICIOS.md)
