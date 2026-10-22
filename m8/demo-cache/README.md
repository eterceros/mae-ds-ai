# Caché con Postgres, Redis y Valkey (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 6

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni tokens de ningún servicio.

## Qué es

Una API pequeña en Node (`src/server.mjs`) con un solo recurso: el **resumen de ventas de un producto por mes**. Esa consulta recorre la tabla `orders` (3 millones de filas) y, sin índice, tarda unos 40-60 ms. Sobre ese recurso se prueban las formas de no repetir trabajo: un índice, `ETag`/`304`, caché en Redis y en Valkey, y los problemas que trae una caché (estampida, datos obsoletos, memoria llena). Además se miden dos usos de Redis/Valkey que no son caché: limitar peticiones (*rate limiting*) y rankings.

| Pieza | Dónde | Notas |
|---|---|---|
| Postgres 17.11 | `127.0.0.1:18432` | `products` (5000) y `orders` (3 M filas, 354 MB); `pg_stat_statements` activo |
| Redis 8.10.2 | `127.0.0.1:18379` | sin persistencia (es una caché) |
| Valkey 9.1.2 | `127.0.0.1:18380` | sin persistencia |
| API (Fastify 5.12) | `127.0.0.1:18500` y `18501` | la levantan los scripts; en C6 corren dos instancias |

Todos los puertos son altos y escuchan solo en `127.0.0.1`, para no chocar con otras cosas que tengan corriendo.

Rutas de la API:

| Ruta | Para qué |
|---|---|
| `GET /db/products/:id/summary` | siempre a Postgres (C1, C2) |
| `GET /etag-body/products/:id/summary` | `ETag` = hash del cuerpo (C3a) |
| `GET /etag-version/products/:id/summary` | `ETag` = versión del producto, leída por clave primaria (C3b) |
| `GET /cache/:store/products/:id/summary?ttl=&jitter=&defense=` | cache-aside en `redis` o `valkey`; `defense` = `none`, `singleflight`, `lock`, `xfetch`, `swr` (C4-C7) |
| `POST /products/:id/orders?invalidate=redis&redelete=ms` | escribe un pedido y, si se pide, borra la clave (C7) |
| `GET /limited/fixed?client=` y `/limited/sliding?client=` | *rate limiting* de 10 peticiones por segundo (C8) |
| `GET /stats`, `POST /stats/reset` | consultas enviadas a Postgres, aciertos y fallos de caché de esa instancia |

## Escenarios

| | Qué se mide | Qué enseña |
|---|---|---|
| **C1** | Sin caché: cada petición ejecuta la consulta costosa | La línea base: la base de datos es el cuello de botella |
| **C2** | Solo un índice adecuado (`(product_id) INCLUDE (created_at, amount)`) | Antes de poner una caché, revisar el plan. Un índice puede valer más que una caché |
| **C3** | `ETag`/`304`, calculado de dos formas | Un `ETag` sobre el cuerpo ahorra bytes, no trabajo. Uno basado en una versión barata ahorra las dos cosas |
| **C4** | Redis, cache-aside con TTL | Mejora la mediana; el p95/p99 lo siguen poniendo los fallos. El *hit ratio* tarda en subir |
| **C5** | Valkey, el mismo código y el mismo cliente | Compatibilidad: mismo protocolo, mismos comandos, mismas cifras |
| **C6** | Estampida al vencer una clave caliente, con 5 defensas; y muchas claves que vencen juntas, con y sin *jitter* | Cuántas consultas llegan a Postgres en cada caso, y qué defensa sirve para qué |
| **C7** | Ventana de datos obsoletos: solo TTL frente a invalidar al escribir, y la carrera de cache-aside | Invalidar no basta si hay una lectura lenta en vuelo |
| **C8** | *Rate limiting* (ventana fija y deslizante) y ranking con ZSET | Redis/Valkey como estructuras de datos, no solo como caché |
| **C9** | `maxmemory` pequeño y cuatro políticas de expulsión | El efecto de la política en el *hit ratio*, y por qué LFU resiste los barridos |

## Requisitos

- Docker (probado con Docker Desktop, motor 29.9.2).
- Node.js 22 o superior (probado con 24.19).
- k6 **no** hace falta: el cliente de carga es Node, con la misma metodología que la demo de la sesión 5 (`scripts/lib/load.mjs` es la misma pieza).

## Cómo correrlo

```
npm install
npm run up            # Postgres, Redis y Valkey en Docker (espera a que estén listos)
npm run seed          # crea y llena la base (~10 s); repetirlo deja la base como al principio
npm run read          # C1-C5  -> results/C1-C5_LECTURAS.md   (~10 min)
npm run stampede      # C6     -> results/C6_ESTAMPIDA.md      (~3 min)
npm run stale         # C7     -> results/C7_OBSOLETOS.md      (~2 min)
npm run structures    # C8     -> results/C8_ESTRUCTURAS.md    (~1 min)
npm run eviction      # C9     -> results/C9_EXPULSION.md      (~7 min)
npm run down          # borra contenedores y datos
```

Cada script levanta sus propias instancias de la API y las detiene al terminar. Si quieren probar la API a mano: `npm start` y, en otra terminal, `curl http://127.0.0.1:18500/cache/redis/products/42/summary`.

## Resultados de referencia

Medidos el 22 de octubre de 2026 en un portátil (Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11), con la API y el cliente en Node 24.19 en la misma máquina y los servidores en Docker Desktop. Las tablas completas, con rangos, están en `results/`.

**C1-C5. Lecturas** ([`results/C1-C5_LECTURAS.md`](results/C1-C5_LECTURAS.md)). Productos elegidos con Zipf (unos pocos muy pedidos, una cola larga de 5000). Latencia a 26 pet/s fijas.

| Variante | Máx. pet/s | p50 (ms) | p99 (ms) | Consultas a PG por 1000 pet. | Aciertos (frío / caliente) | Bytes/pet. |
|---|---:|---:|---:|---:|---:|---:|
| C1 sin caché | 71 | 46.3 | 61.4 | 1000 | - | 1258 |
| C3a `ETag` sobre el cuerpo | 66 | 47.5 | 75.7 | 1000 | 39 % / 54 % | 769 |
| C3b `ETag` por versión | 117 | 2.7 | 55.5 | 1554 (1000 de ellas baratas) | 45 % / 62 % | 697 |
| C4 Redis, TTL 30 s | 130 | 2.7 | 58.8 | 549 | 45 % / 63 % | 1257 |
| C5 Valkey, TTL 30 s | 129 | 2.6 | 61.5 | 551 | 45 % / 63 % | 1257 |
| C2 solo índice | 2324 | 2.0 | 6.1 | 1000 | - | 1257 |
| C2 índice + Redis | 2397 | 1.4 | 5.5 | 190 | 81 % / 92 % | 1257 |

(Las dos filas de C2 se midieron a 841 pet/s, su propio ritmo común.)

**C6. Estampida** ([`results/C6_ESTAMPIDA.md`](results/C6_ESTAMPIDA.md)). Dos instancias de la API. Consultas a Postgres:

| Defensa | Ráfaga de 200 peticiones al vencer | Carga sostenida, 100 trabajadores, 10 s, TTL 1 s | p99 sostenido (ms) |
|---|---:|---:|---:|
| Sin defensa | 200 (máx. 2,4 s de espera) | 400 (40 por vencimiento) | 410 |
| *Single-flight* por proceso | 2 (una por instancia) | 18 | 51 |
| Candado distribuido `SET NX PX` | 1 | 9 | 59 |
| Refresco anticipado probabilístico (XFetch) | 50 (34-75) | 47 | 46 |
| TTL lógico + refresco en segundo plano | 1 (las 200 reciben el valor viejo) | 10 | 48 |

Con 100 claves distintas cargadas a la vez y TTL fijo de 5 s, las consultas llegan en olas (75 y 26 en los segundos 6 y 7, 57 y 44 en los 11 y 12, cero entre medio); con *jitter* de ±50 % se reparten en 12-30 por segundo y el p99 baja de 112 a 48 ms.

**C7. Datos obsoletos** ([`results/C7_OBSOLETOS.md`](results/C7_OBSOLETOS.md)). TTL 5 s, 10 intentos por modo:

| Modo | Ventana mediana (ms) | Máx. (ms) | Intentos con más de 1 s obsoleto |
|---|---:|---:|---:|
| Solo TTL | 2063 | 4609 | 9 de 10 |
| Invalidar al escribir | 38 (ninguna lectura vieja) | 44 | 0 de 10 |
| Invalidar, con una lectura lenta en vuelo | 5064 | 5082 | 9 de 10 |
| Lo mismo + doble borrado a los 300 ms | 345 | 352 | 0 de 10 |

**C8. Estructuras** ([`results/C8_ESTRUCTURAS.md`](results/C8_ESTRUCTURAS.md)). Límite: 10 peticiones por segundo.

- Ráfaga de 10 + 10 peticiones alrededor del cambio de segundo: la **ventana fija** acepta 20 en unos 100 ms; la **deslizante**, 10. Las dos cuestan lo mismo por petición (p50 1,0 ms la petición HTTP completa); la deslizante ocupa más memoria (680 bytes por cliente con 10 marcas frente a 39 del contador).
- Top 10 de 5000 productos: SQL sobre 3 M de filas, p50 139 ms; `ZREVRANGE` en Redis o Valkey, p50 0,6-0,7 ms. Registrar una venta con `ZINCRBY`: 0,6 ms.

**C9. Expulsión** ([`results/C9_EXPULSION.md`](results/C9_EXPULSION.md)). `maxmemory 16mb` (unas 14 000 claves de 1 KB), 50 000 claves posibles con Zipf. *Hit ratio*:

| Política | Solo Zipf (Redis / Valkey) | Zipf + barridos (Redis / Valkey) |
|---|---:|---:|
| `allkeys-lru` | 84,0 % / 84,4 % | 71,8 % / 72,5 % |
| `allkeys-lfu` | 84,9 % / 85,2 % | **80,0 % / 79,8 %** |
| `allkeys-random` | 81,7 % / 82,0 % | 70,0 % / 70,4 % |
| `noeviction` | 84,2 % / 84,5 % (22 115 escrituras rechazadas) | 75,3 % / 75,3 % (136 754 rechazadas) |
| sin límite (techo) | 89,3 % (31 MB) | 89,5 % (133 MB) |

**Úsenlos como orden de magnitud, no como verdad.** Todo corre en una máquina: la red entre la API y Redis es el *loopback* de Docker Desktop (unos 0,6 ms de ida y vuelta, medido en C8). El cliente de carga es un solo proceso Node y en C2 puede ser él el límite.

## Qué enseña cada escenario

**C1 y C2. Primero el plan, después la caché.** Sin índice, cada resumen es un *Parallel Seq Scan* que descarta casi 3 millones de filas para quedarse con ~600 (61 ms). Con un índice cubriente, el plan pasa a *Index Only Scan* (0,3 ms) y la API sube de 71 a 2324 pet/s: **33 veces más, sin caché**. Agregar Redis encima de ese índice casi no cambia la capacidad (2397 pet/s) aunque quite el 81 % de las consultas: el costo ya no estaba en la base. Una caché sobre una consulta mal indexada esconde el problema y lo devuelve en cada fallo.

**C3. `ETag` no es una caché del servidor.** Si el servidor calcula la respuesta para sacarle el hash (C3a), el `304` ahorra bytes (769 frente a 1258 por petición) pero no consultas: la capacidad no mejora. Si el `ETag` sale de algo barato que cambia cuando cambian los datos (una columna `version`, un `updated_at`), el servidor responde `304` con una lectura por clave primaria y no ejecuta la consulta costosa (C3b: p50 de 46 a 2,7 ms). Lo que ahorra el `ETag` depende de que el cliente vuelva a pedir lo mismo: aquí el cliente de carga guarda los `ETag` como lo haría un navegador o una CDN.

**C4 y C5. Cache-aside mejora la mediana, no la cola.** Con un 45-63 % de aciertos, el p50 baja de 46 a 2,7 ms, pero el p95 y el p99 siguen en 50-60 ms: son los fallos, que van a la base. El *hit ratio* depende de la distribución de las claves y del tiempo: en la tabla «Cómo se calienta la caché» sube de 37 % a 67 % en 20 s y después oscila alrededor de 60 % porque las claves vencen. Redis y Valkey dan las mismas cifras con el mismo cliente (`ioredis`) y el mismo código.

**C6. Estampida.** Cuando vence una clave caliente, todas las peticiones que llegan mientras alguien la recalcula también fallan y van a la base: 200 peticiones simultáneas, 200 consultas, y la última espera 2,4 s porque el pool solo tiene 20 conexiones entre las dos instancias. Las defensas:

- *Single-flight* (una promesa compartida por clave) es trivial y elimina casi todo, pero solo dentro de un proceso: con dos instancias, 2 consultas por vencimiento; con 50 réplicas, 50.
- El candado distribuido (`SET lock NX PX`) deja pasar a uno solo en todo el sistema; los demás esperan sondeando la clave. Hay que liberarlo solo si sigue siendo propio (Lua) y ponerle vencimiento por si quien lo tiene se muere.
- XFetch (recalcular antes de tiempo, con probabilidad creciente cerca del vencimiento) funciona bien con tráfico sostenido (p99 46 ms), pero **no** protege de una ráfaga: si muchas peticiones llegan juntas cerca del vencimiento, muchas deciden recalcular (50 de 200).
- TTL lógico + refresco en segundo plano (*stale-while-revalidate*): la clave vive más que su vencimiento lógico; al pasarlo, uno solo refresca y los demás reciben el valor viejo sin esperar. Es la defensa más estable en las dos pruebas; el precio es servir datos viejos por un momento, y eso tiene que ser aceptable para el negocio.
- El *jitter* resuelve otro problema: muchas claves **distintas** que vencen a la vez (tras un despliegue o un reinicio de la caché). No sirve para una sola clave caliente; se combina con lo anterior.

**C7. Datos obsoletos.** Con solo TTL, una escritura tarda en verse entre 0 y el TTL (mediana 2 s con TTL de 5 s). Borrar la clave después del commit lo baja a lo que tarda la siguiente lectura en recalcular. Pero cache-aside tiene una carrera: si una lectura empezó a recalcular **antes** del commit y guarda su resultado **después** del borrado, el valor viejo queda en caché hasta que vence (5 s). Aquí se provoca a propósito y ocurrió en 9 de 10 intentos. El doble borrado (otro `DEL` un poco después) acota la ventana a ese retraso; otras salidas son claves con versión (`summary:42:v17`) o actualizar la caché desde el log de cambios de la base (CDC). Con réplicas de lectura, el problema empeora: la lectura que recalcula puede leer una réplica atrasada.

**C8. Estructuras.** La ventana fija (`INCR` + `PEXPIRE`) es la más barata, pero deja pasar el doble del límite en el borde entre dos ventanas. La ventana deslizante con un ZSET de marcas de tiempo lo respeta exactamente a cambio de una entrada por petición aceptada (para límites de miles por minuto conviene una aproximación: ventana deslizante por contadores, o *token bucket*). Las dos van en un script Lua para que leer y escribir sean atómicos. Un ranking que en SQL exige agregar toda la tabla en cada consulta se mantiene en un ZSET con `ZINCRBY` al registrar cada venta y se lee en menos de 1 ms; la fuente de verdad sigue siendo Postgres (el ZSET se reconstruye desde ahí).

**C9. Memoria y expulsión.** Con una carga Zipf pura, las políticas apenas se diferencian (82-85 %), y hasta `noeviction` queda parecida porque las claves calientes entran primero; pero `noeviction` hace fallar las escrituras con `OOM command not allowed`, y la aplicación tiene que tolerarlo. Cuando hay barridos (un proceso por lotes, un informe, un rastreador que pide 10 000 claves una sola vez), LRU expulsa las claves calientes para guardar las que no se volverán a pedir y cae a 72 %; LFU las protege y queda en 80 %. Para una caché pura, `allkeys-lru` o `allkeys-lfu`; si el mismo servidor guarda datos que no se pueden perder (sesiones, colas), `volatile-*` o, mejor, otro servidor.

## Advertencias

- **Es una sola máquina.** La API, el cliente y los servidores comparten CPU. Las latencias de Redis/Valkey incluyen el *loopback* de Docker Desktop en Windows.
- **Los aciertos dependen de la carga.** Zipf con s = 1 sobre 5000 productos es una suposición razonable para una tienda, no un dato. Con otra distribución, otro TTL u otra duración, el *hit ratio* cambia mucho.
- **C7 provoca la carrera a propósito** (borra la clave, lanza una lectura lenta y escribe 10 ms después). En producción ocurre con menos frecuencia, pero ocurre, y sobre todo con consultas lentas y réplicas.
- **Redis y Valkey no persisten** en esta demo (`--save "" --appendonly no`). Para datos que no se pueden perder (rate limits con efectos de cobro, colas, sesiones), la persistencia y la replicación cambian el análisis.
- **C9 no pasa por la API ni por Postgres**: simula cache-aside directamente contra el servidor para poder hacer cientos de miles de operaciones. La LRU y la LFU de Redis y Valkey son aproximadas (muestrean claves), por eso las cifras de ambos difieren un poco.
- Los pedidos que escribe C7 llevan `note = 'demo-c7'`; `npm run seed` deja la base como al principio.

## Versiones y licencias (verificadas el 22 de octubre de 2026)

| Software | Versión usada | Licencia | Fuente |
|---|---|---|---|
| Redis 7.2 y anteriores | - | BSD-3-Clause | [redis.io/legal/licenses](https://redis.io/legal/licenses/) |
| Redis 7.4 (y 7.x posteriores) | - | RSALv2 o SSPLv1 (a elección); no son licencias de código abierto según la OSI | [Anuncio de Redis, 20 de marzo de 2024](https://redis.io/blog/redis-adopts-dual-source-available-licensing/) |
| Redis 8.x | **8.10.2** (imagen oficial `redis:8.10.2`) | RSALv2, SSPLv1 o **AGPLv3** (a elección) | [Anuncio de Redis, 1 de mayo de 2025](https://redis.io/blog/agplv3/) y [`LICENSE.txt`](https://github.com/redis/redis/blob/unstable/LICENSE.txt) |
| Valkey | **9.1.2** (imagen oficial `valkey/valkey:9.1.2`) | BSD-3-Clause, proyecto de la Linux Foundation | [Anuncio de la Linux Foundation, 28 de marzo de 2024](https://www.linuxfoundation.org/press/linux-foundation-launches-open-source-valkey-community) y [`COPYING`](https://github.com/valkey-io/valkey/blob/unstable/COPYING) |
| PostgreSQL | **17.11** (imagen oficial `postgres:17.11`) | PostgreSQL License | - |

Valkey nació como bifurcación de Redis 7.2.4 cuando Redis dejó la licencia BSD. Fechas de las versiones de Valkey según su [blog](https://valkey.io/blog/): 8.0 (16 de septiembre de 2024), 8.1 (2 de abril de 2025), 9.0 (21 de octubre de 2025), 9.1 (19 de mayo de 2026). Las versiones de los servidores se tomaron de los propios binarios (`redis-server --version`, `valkey-server --version`, `postgres --version`) al descargar las imágenes (digests: `redis@sha256:97ec8815…`, `valkey/valkey@sha256:418652cf…`, `postgres@sha256:b8faeff7…`).

AGPLv3 importa si modifican Redis y lo ofrecen como servicio por red: deben publicar sus cambios. Usarlo sin modificarlo como caché de su aplicación no les obliga a publicar su aplicación. RSALv2 prohíbe ofrecer Redis como servicio gestionado a terceros. Ante cualquier duda real, consulten a quien lleve los temas legales de su organización.

**Migrar de Redis a Valkey**, lo que esta demo comprueba: el mismo cliente (`ioredis` 6.0) y el mismo código funcionan contra los dos para todo lo que se usa aquí (`GET`/`SET` con `PX` y `NX`, `EVAL` con Lua, `INCR`, `PEXPIRE`, ZSET, `MEMORY USAGE`, `CONFIG SET maxmemory`, `INFO`), con cifras equivalentes. Lo que no comprueba: las funciones que Redis 8 incorporó al núcleo (JSON, motor de consultas, series temporales, *vector sets*) y la compatibilidad de archivos RDB/AOF entre versiones; revísenlas antes de migrar si las usan.

## Decisiones de la demo

- **Fastify y no NestJS** (que se usó en la sesión 5): aquí el objeto de estudio es la base y la caché, no la API. Fastify agrega muy poco por petición y deja el código entero en un archivo de unas 240 líneas, legible de una sentada. Las técnicas son las mismas en NestJS (un *interceptor* o un servicio de caché).
- **JavaScript sin compilar** (`.mjs`), para que `npm install` sea todo lo que haga falta.
- **Un solo cliente (`ioredis`) para Redis y Valkey**, justamente para mostrar que el cambio es de servidor, no de código.
- **Clientes de carga con `node:http` y *keep-alive*** (no `fetch`, que en Windows suma latencia) y la metodología de la sesión 5: máximo en bucle cerrado y latencia a ritmo fijo contada desde que la petición *debió* salir.
- **Conteo de consultas a Postgres** en la propia API; `pg_stat_statements` lo confirma (C1-C5: 95 074 contadas por la API, 95 074 registradas por Postgres).
