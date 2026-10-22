# Experimentos y demos del docente – Módulo 8

> **Son demostraciones del docente: no hay nada que entregar.** Se publican para repasarlas después de clase y, si quieren, reproducirlas. Ninguna necesita claves ni tokens de servicios externos.

Este archivo reúne en un solo lugar las demos medidas del módulo y sus resultados principales. Las cifras están copiadas de los archivos `results/` de cada demo; allí están las tablas completas, con rangos y detalle.

| Demo | Sesión | Pregunta | Tiempo de la corrida completa | Resultados |
|---|---|---|---|---|
| [`demo-rest-graphql-grpc/`](demo-rest-graphql-grpc/) | 5 | ¿Cuándo conviene REST, GraphQL o gRPC sobre el mismo servicio? | ≈ 37-46 min (más `payloads` y `codec`) | [7 archivos](#1-rest-graphql-y-grpc-sobre-el-mismo-servicio-sesión-5) |
| [`demo-migraciones/`](demo-migraciones/) | 6 | ¿Qué migraciones de esquema cortan el servicio y cómo hacerlas sin cortarlo? | ≈ 95 min (≈ 30 min con `RONDAS=1`) | [3 archivos](#2-migraciones-de-esquema-sin-cortar-el-servicio-sesión-6) |
| [`demo-cache/`](demo-cache/) | 6 | ¿Cuándo ayuda una caché (Redis/Valkey), cuándo basta un índice y qué problemas trae? | ≈ 23 min | [5 archivos](#3-caché-con-postgres-redis-y-valkey-sesión-6) |

**Advertencia común a las tres:** cada demo se midió en **una sola máquina** (un portátil con Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11), con cliente y servidores juntos. Úsenlas como orden de magnitud y para ver **qué** cambia y **por qué**, no como cifras absolutas: en otro hardware, o con una red real entre máquinas, los números cambian y a veces también el orden.

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
