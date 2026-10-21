# Guion de la demo: REST, GraphQL y gRPC

Demo del docente. Todo se corre desde esta carpeta, en Git Bash (en PowerShell usar `curl.exe` y comillas simples para el JSON). Las cifras de "Salida esperada" son de la corrida de referencia del 21 de octubre de 2026; en otra máquina cambian los tiempos, **no** cambian los bytes ni el número de peticiones y de consultas.

**Versión larga:** unos 60 minutos (secciones 1 a 9). **Versión corta para la sesión 5 (15 min):** sección 1 (2 min, solo los tres `curl`/cliente), sección 3 (tablas B y C, 4 min), sección 5 (tablas N1 y N2, 4 min), la tabla de la sección 6 (servidor Java, 2 min) y la pizarra de la sección 9 (3 min). Lo demás queda para repasar.

## 0. Antes de clase (el día anterior)

```
npm install
npm run build
docker version            # solo hace falta para las secciones 5 y 7
(cd java-server && mvn -q package -DskipTests)   # solo hace falta para la sección 6 (Java 25 o superior y Maven)
```

Ensayar una vez y comparar con `results/`. La sección 5 arranca un contenedor y tarda cerca de un minuto en estar lista; conviene correrla antes de clase y mostrar `results/NETWORK.md`. Dos terminales abiertas en esta carpeta: **T1** para el servicio y **T2** para los comandos.

## 1. Un servicio, tres puertas (4 min) — T1 y T2

**T1:**

```
npm start
```

Salida esperada:

```
REST     http://127.0.0.1:3000/students/1
GraphQL  http://127.0.0.1:3000/graphql
gRPC     127.0.0.1:50051  (proto/students.proto)
```

**T2** — la misma consulta, tres veces:

```
curl http://127.0.0.1:3000/students/7
curl -X POST http://127.0.0.1:3000/graphql -H "content-type: application/json" -d "{\"query\":\"{ student(id: 7) { name } }\"}"
node scripts/grpc-call.mjs GetStudent "{\"id\":7}"
```

Qué decir:

- REST devuelve **todos** los campos del recurso. GraphQL devuelve **solo lo que el cliente pidió** (`name`). gRPC devuelve el mensaje definido en `proto/students.proto`.
- Mostrar `src/schema.graphql` y `proto/students.proto` lado a lado: dos contratos tipados, cada uno con su herramienta. REST lo tiene con OpenAPI (bloque 1 de la sesión).
- gRPC no se prueba con `curl` ni con el navegador. Para la demo usamos un cliente pequeño (`scripts/grpc-call.mjs`). Esa fricción es parte de la comparación.

Error: pedir un estudiante que no existe.

```
curl -i http://127.0.0.1:3000/students/999999
node scripts/grpc-call.mjs GetStudent "{\"id\":999999}"
```

REST responde `404`; gRPC responde `NOT_FOUND`. Es el mismo error con dos vocabularios.

## 2. Bytes que viajan (5 min) — T2

```
npm run payloads
```

Salida esperada (los bytes son exactos y repetibles):

| Escenario | REST | GraphQL | gRPC |
|---|---:|---:|---:|
| A. Un estudiante, solo el nombre | 101 B | 47 B | 68 B |
| B. Lista de 2000 | 213.080 B | 213.103 B | 146.059 B |
| B. Lista de 2000, con gzip | 17.534 B | 17.566 B | 17.445 B |
| C. 50 estudiantes con cursos | 17.051 B | 17.074 B | 10.609 B |

Qué decir:

- **A:** GraphQL gana en bytes **porque el cliente pidió solo el nombre**. Es un efecto de pedir menos, no de GraphQL. REST podría hacer lo mismo con `?fields=name`.
- **B:** gRPC manda un **31 % menos de bytes** que REST sin comprimir, porque el binario no repite los nombres de los campos. **Con gzip la diferencia desaparece** (17,4 KB frente a 17,5 KB). Pregunta para el grupo: ¿cuánto vale entonces el ahorro de bytes? La sección 5 la responde con números.
- **C:** en `results/PAYLOADS.md`, REST ingenuo hace **51 peticiones y 51 consultas**; las otras cuatro variantes hacen 1 petición. GraphQL sin dataloader hace 1 petición pero **51 consultas** a la base.

## 3. Rendimiento y latencia (10 min) — T2

```
npm run bench
```

Dura entre 10 y 15 minutos (3 rondas); para la clase, mostrar `results/LATENCY.md` ya generado y explicar cómo se mide:

- **Máx. llamadas/s:** 10 trabajadores llamando sin parar. Es la capacidad.
- **Latencia (p50, p95, p99):** llamadas a un **ritmo fijo y común** (40 % de lo que aguanta la variante más lenta), para medir la espera real y no la cola de una máquina saturada.
- El cliente es el mismo tipo para los tres estilos (Node, conexiones persistentes, decodifica la respuesta completa). Ver la sección 10 para saber por qué no se usó k6 aquí.

Cifras de referencia (mediana de 3 rondas; entre rondas casi no variaron):

| Escenario | REST | GraphQL | gRPC |
|---|---:|---:|---:|
| A. Un estudiante, llamadas/s máx. | 3.027 | 1.616 | 2.104 |
| A. p50 a 582 llamadas/s (ms) | 1,8 | 2,4 | 2,5 |
| B. Lista de 2000, llamadas/s máx. | 331 | 64 | 147 |
| B. p50 a 27 llamadas/s (ms) | 6,1 | 10,0 | 9,0 |

| C. 50 estudiantes con cursos | Llamadas/s máx. | p50 a 24 llamadas/s (ms) |
|---|---:|---:|
| REST ingenuo (1 + 50 llamadas) | 60 | 90,8 |
| REST con `?expand=courses` | 1.268 | 3,8 |
| GraphQL con dataloader | 269 | 5,2 |
| GraphQL sin dataloader (N+1) | 141 | 8,6 |
| gRPC | 792 | 4,5 |

| Servicio a servicio (gateway → servicio) | Llamadas/s máx. | p50 (ms) |
|---|---:|---:|
| D1. 20 llamadas pequeñas en paralelo, por REST (a 51/s) | 159 | 6,8 |
| D1, por gRPC | 152 | 8,7 |
| D2. 1 llamada grande (2000), por REST (a 56/s) | 281 | 6,8 |
| D2, por gRPC | 148 | 9,2 |

Qué decir (en este orden):

1. **C, lo grande:** el costo lo marca el **número de viajes y de consultas**. REST ingenuo (51 viajes) soporta **21 veces menos llamadas/s** que REST bien diseñado con `expand`. GraphQL sin dataloader soporta **casi la mitad** que con dataloader. Con el mismo estilo, un buen diseño y uno malo se diferencian más que un estilo de otro.
2. **B, GraphQL es el más lento, como dice la teoría:** unas 5 veces menos llamadas/s que REST en la lista de 2000. Ejecuta el esquema campo por campo (2000 × 4 campos). Aviso: con la configuración que Apollo trae de fábrica era el doble de lento todavía (23 frente a 51 llamadas/s medidas); el plugin de control de caché ejecuta código en cada campo. Está desactivado en esta demo (`APOLLO_CACHE_CONTROL=on` lo reactiva).
3. **A y B, REST gana sin red:** con servidor Node y en la misma máquina, REST (JSON nativo de V8) soporta 1,4 veces más llamadas/s que gRPC en A y 2,3 veces más en B. Es razonable: codificar protobuf en Node es JavaScript y es ~3 veces más lento que `JSON.stringify` (sección 4).
4. **D1 y D2: gRPC no gana entre dos servicios Node en la misma máquina.** En D1 empatan en capacidad (159 frente a 152) y REST tiene mejor latencia; en D2 REST gana. *Una versión anterior de esta demo mostraba a gRPC un 12–22 % más rápido en D1; era un error del experimento (ver sección 10).*

## 4. Costo de codificar y decodificar (3 min) — T2

```
npm run codec
```

Mide solo CPU de Node, sin red (ms por operación):

| Respuesta | `JSON.stringify` | protobuf codificar | `JSON.parse` | protobuf decodificar |
|---|---:|---:|---:|---:|
| 50 estudiantes | 0,007 | 0,027 | 0,010 | 0,019 |
| 2000 estudiantes | 0,295 | 0,847 | 0,354 | 0,455 |

Qué decir: en Node, protobuf codifica unas 3 veces más lento que JSON (JSON es código nativo; protobuf lo hace JavaScript). En un servidor Go o Java compilado esto cambia, y es una de las razones por las que "gRPC es más rápido" se cumple en otros lenguajes. **No lo medimos aquí.**

## 5. Con una red limitada (10 min) — T2

```
npm run network
```

Arranca el servicio en un contenedor Docker y le aplica **20 ms de retardo y 20 Mbit/s** a lo que sale (`tc netem`). Tarda entre 8 y 12 minutos; para la clase, mostrar `results/NETWORK.md`. Es la condición donde, en teoría, importan los bytes y las conexiones.

Cifras de referencia (mediana de 3 rondas):

| N1. Lista de 2000, una llamada | Llamadas/s máx. | p50 (ms) |
|---|---:|---:|
| REST (JSON sin comprimir) | 10,8 | 118 |
| **REST con gzip** | **132,6** | **38** |
| gRPC (sin comprimir), configuración por defecto | 9,8 | 124 |
| gRPC (sin comprimir), ventana HTTP/2 ampliada | 16,4 | 92 |

| N2. 20 llamadas pequeñas en paralelo | Llamadas/s máx. | p50 (ms) |
|---|---:|---:|
| REST, hasta 6 conexiones (como un navegador) | 11,2 | 105 |
| REST, conexiones sin tope | 196 | 32 |
| gRPC, un solo canal | 161 | 34 |

Qué decir:

1. **N1, los bytes ahora sí pesan:** con ancho de banda limitado, el tiempo sigue a los bytes. gRPC (146 KB) con la ventana ajustada tarda **92 ms frente a 118 ms** de REST sin comprimir (213 KB): un 22 % menos, y soporta un 52 % más de llamadas/s.
2. **Pero gzip lo supera todo:** REST con gzip tarda **38 ms**, 2,4 veces menos que gRPC ajustado. El ahorro de bytes de gRPC es real y es menor que el de comprimir. (En gRPC la compresión de respuestas **no se puede medir con Node**: `grpc-js` no comprime en el servidor; su propio código dice "response compression is currently not supported" en `server-interceptors.js`. Con un servidor Java o Go sí se podría; no lo medimos.)
3. **La configuración por defecto de gRPC en Node (124 ms) fue más lenta que REST sin comprimir, aunque manda menos bytes.** Al ampliar la ventana de control de flujo de HTTP/2 (de 64 KB a 8 MB, `grpc-node.flow_control_window`) baja a 92 ms. Con 20 ms de retardo, la ventana por defecto obliga al servidor a esperar avisos del cliente. *Lo medimos cambiando solo esa opción; no examinamos el mecanismo por dentro.*
4. **N2, donde gRPC sí gana:** si el cliente HTTP/1.1 está limitado a 6 conexiones (un navegador), las 20 llamadas se hacen en cuatro tandas y tardan **105 ms; gRPC las multiplexa en un canal y tarda 34 ms**, 3 veces menos. Pero si el cliente REST puede abrir 20 conexiones (un servicio), REST empata (32 frente a 34 ms). **La ventaja de gRPC aquí es la multiplexación frente a un tope de conexiones, no la velocidad.**

## 6. Un servidor compilado: Java (8 min) — T2

```
cd java-server && mvn -q package -DskipTests && cd ..
npm run java
```

El mismo servicio (mismos datos, mismo JSON, mismo `.proto`) en **Spring Boot 4.1.1** (Spring MVC + Tomcat para REST, **grpc-java 1.83.1** con Netty para gRPC, Java 26). El cliente sigue siendo el de Node. Tarda unos 6 minutos; para la clase, mostrar `results/JAVA.md`. Detalles de la implementación en `java-server/README.md`.

Cifras de referencia (mediana de 3 rondas; entre paréntesis, el rango):

| Escenario | REST (Spring MVC) | gRPC (grpc-java) |
|---|---:|---:|
| A. Un estudiante, llamadas/s máx. | 2.185 (2.158–2.193) | 1.987 (1.866–2.077) |
| B. Lista de 2000, llamadas/s máx. | 266 (242–278) | **331 (273–346)** |
| B. p50 a 92 llamadas/s (ms) | 8,1 | **7,0** |
| P. 20 llamadas pequeñas en paralelo, llamadas/s máx. | 167 (162–177) | 178 (148–181) |

Qué decir:

1. **Con un servidor compilado la imagen cambia:** en la lista de 2000, gRPC soporta un 25 % más de llamadas/s que REST y su p50 es menor (7,0 frente a 8,1 ms). Con servidor Node, REST soportaba 2,3 veces más que gRPC en ese mismo escenario. Es lo que predice la teoría: el protobuf generado en Java es rápido y la ventaja de JSON nativo de V8 desaparece.
2. **Pero la ventaja es modesta y los rangos se solapan:** el peor resultado de gRPC en B (273) es casi igual al mejor de REST (278). En A y en P los dos quedan empatados. Con tres rondas no se puede afirmar una diferencia grande.
3. **No comparar Java con Node entre sí.** Son servidores con modelos de hilos distintos (Tomcat bloquea un hilo por petición; Node usa un solo hilo) y no se igualó todo (por ejemplo, Spring responde con `Transfer-Encoding: chunked` y Express con `Content-Length` y un `ETag`). Solo vale comparar REST contra gRPC **dentro de cada servidor**.

## 7. *Streaming*: el primer elemento llega antes (6 min) — T2

```
npm run stream
```

Corre el servicio en un contenedor Docker y mide, con llamadas de una en una, cuánto tarda el cliente en tener el **primer** estudiante y en tener **todos** (lista de 2000). Primero sin red limitada y luego con 20 ms de retardo y 20 Mbit/s. Tarda unos 5 minutos; para la clase, mostrar `results/STREAM.md`.

Cifras de referencia (ms, mediana de 3 rondas de 25 llamadas):

| Con 20 ms y 20 Mbit/s | Primer estudiante | Todos |
|---|---:|---:|
| REST, arreglo JSON (hay que esperar todo) | 116 | 116 |
| REST, NDJSON en flujo | 37 | 120 |
| gRPC unario (hay que esperar todo) | 87 | 87 |
| gRPC, *streaming* de servidor | **24** | 115 |

| Sin red limitada | Primer estudiante | Todos |
|---|---:|---:|
| REST, arreglo JSON | 6,7 | 6,7 |
| REST, NDJSON en flujo | 5,2 | 15,2 |
| gRPC unario | 8,0 | 8,0 |
| gRPC, *streaming* de servidor | 4,4 | **65,2** |

Qué decir:

1. **Con red limitada, el *streaming* adelanta el primer elemento 3 a 5 veces:** 24 ms (gRPC) y 37 ms (NDJSON) frente a 116 ms del arreglo JSON. Es útil si el cliente puede mostrar o procesar datos conforme llegan.
2. **El total no mejora:** en cuanto a "tener todo", el unario de gRPC (87 ms) es el mejor, porque envía un solo mensaje. El *streaming* no hace más rápida la transferencia; cambia **cuándo** empieza a servir.
3. **REST también puede hacer *streaming*** (NDJSON). El de gRPC adelanta el primer elemento algo más (24 frente a 37 ms), pero no es una capacidad exclusiva de gRPC.
4. **Sin red limitada, el *streaming* de gRPC en Node es caro:** 65 ms en total frente a 15 ms de NDJSON. Probablemente es el costo de enviar 2000 mensajes uno por uno en Node. *Es una sospecha; no la comprobamos.*

## 8. TLS y conexiones nuevas (6 min) — T2

```
npm run tls
```

Un microbenchmark aparte (servidores Node sin NestJS y sin base simulada) que mide el costo de **cifrar** (TLS) y de **abrir una conexión nueva en cada llamada**, para REST (HTTP/1.1) y gRPC (HTTP/2). Genera un certificado autofirmado solo para esta demo (necesita `openssl`; en Windows viene con Git). Tarda unos 8 minutos; para la clase, mostrar `results/TLS.md`.

Cifras de referencia (llamadas/s máx., mediana de 3 rondas; con conexión persistente el p50 es menor de 1 ms en las cuatro):

| | REST sin TLS | REST con TLS | gRPC sin TLS | gRPC con TLS |
|---|---:|---:|---:|---:|
| Conexión persistente | 3.463 | 2.374 | 2.887 | 3.312 |
| Conexión nueva en cada llamada | 475 | 142 | 74 | 50 |
| Conexión nueva, p50 (ms) | 3,1 | 8,9 | 15,6 | 23,8 |

Qué decir:

1. **Con conexión persistente, TLS casi no pesa:** REST con TLS soporta un 31 % menos de llamadas/s; en gRPC la diferencia queda dentro del ruido (los rangos se solapan).
2. **Con una conexión nueva en cada llamada, gRPC es mucho más caro que REST:** 6,4 veces menos llamadas/s sin TLS y 2,8 veces menos con TLS. Abrir un canal gRPC implica el apretón de manos de HTTP/2 además del de TCP y TLS. Por eso gRPC se usa con **canales de larga vida**; un cliente que abre un canal por llamada pierde.
3. **Lección de diseño:** la ventaja de gRPC aparece cuando se reutiliza la conexión; si el patrón de uso es "una llamada y cerrar" (por ejemplo, funciones sin estado que no mantienen conexiones), REST es más barato.

## 9. Cuándo gana y cuándo pierde cada uno (3 min) — pizarra

Todo lo de esta tabla sale de las mediciones de arriba, salvo lo marcado *(no medido)*.

| | Mejor cuando | Peor cuando |
|---|---|---|
| **REST** | Servidor Node y sin red limitada (A y B: el más rápido). Con gzip en red limitada (N1: 38 ms, el mejor). Caché HTTP y herramientas universales (`curl`, navegador) *(no medido)*. | El cliente necesita datos relacionados y la API obliga a varias llamadas (C ingenuo: 21 veces menos llamadas/s). Cliente limitado a pocas conexiones (N2: 105 ms). |
| **GraphQL** | El cliente necesita un subconjunto de campos o datos de varias entidades en un solo viaje (A: 47 B; C: 1 viaje en vez de 51). | Listas grandes (B: unas 5 veces menos llamadas/s que REST) y si el servidor no usa dataloader (C: casi la mitad de capacidad, 51 consultas). |
| **gRPC** | Menos bytes sin compresión (B: −31 %, C: −38 %), que con red limitada se traducen en tiempo (N1: 92 ms frente a 118 ms) si se ajusta la ventana de HTTP/2. Muchas llamadas pequeñas con un tope de conexiones HTTP/1.1 (N2: 34 ms frente a 105 ms). Con un servidor compilado (Java): 25 % más llamadas/s que REST en la lista de 2000 (los rangos se solapan). *Streaming*: el primer elemento llega 3 a 5 veces antes que con un arreglo JSON (24 ms frente a 116 ms). Contrato `.proto` con código generado. | Servidor Node en la misma máquina (A y B: 1,4 y 2,3 veces menos llamadas/s que REST). Cuando REST puede comprimir con gzip (N1: 38 ms); en Node, gRPC no puede comprimir respuestas. Con una conexión nueva en cada llamada (6,4 veces menos llamadas/s que REST sin TLS). *Streaming* en Node (65 ms frente a 15 ms de NDJSON en el total). Llamarlo desde un navegador o con `curl` *(no medido)*. |

Cierre: **no hay un ganador, y "gRPC es más rápido" no es una regla.** Lo que se vio es que (1) el diseño (cuántos viajes, cuántas consultas) pesa más que el estilo; (2) gRPC gana cuando importan los bytes sin comprimir o cuando hay pocas conexiones HTTP/1.1, y bien configurado; (3) en una máquina y con servidor Node, REST gana; con un servidor compilado (Java), gRPC supera a REST en la lista grande, aunque por poco; (4) gRPC pierde si se abre una conexión por llamada. Con Go u otros lenguajes **no medimos**. Conectar con E1 (REST frente a GraphQL): su hipótesis debe nombrar qué escenario mide, porque el resultado cambia entre A, B y C.

## 10. Cómo se corrigió el experimento (para comentar si hay tiempo)

La primera versión de esta demo daba resultados que contradecían la teoría (gRPC más lento que REST, GraphQL 12–15 veces más lento, gRPC ganando solo en D1). No era la teoría la que fallaba: eran errores de medición. Una revisión independiente del código encontró, y se comprobó midiendo, que:

1. **El plugin de caché de Apollo** (activado por defecto) duplicaba el tiempo de GraphQL con listas grandes.
2. **`fetch` de Node en Windows** añade unos 15 ms por petición. Penalizaba a REST y producía la "ventaja" de gRPC en D1.
3. **`setTimeout(1)` espera ~15 ms en Windows**, no 1 ms. La base simulada era más lenta de lo declarado y dependía de la carga.
4. **El cliente gRPC de k6 hace más trabajo que su cliente HTTP** (convierte cada respuesta a objetos de JavaScript). Por eso la medición pasó a un cliente Node igual para los tres estilos.
5. **10 usuarios en bucle cerrado miden la cola de una máquina saturada, no la latencia.** Ahora se miden por separado la capacidad y la latencia a ritmo fijo.
6. **Una variante "gRPC con gzip" no comprimía nada** y salía idéntica a la sin comprimir (91,5 frente a 91,1 ms). Se notó por lo idéntico del resultado; se confirmó mirando la cabecera `grpc-encoding` de la respuesta (vacía) y el código de `grpc-js`, que no comprime respuestas en el servidor. Se eliminó. **Cuando dos variantes dan lo mismo, comprobar que la diferencia que se quiere medir realmente existe.**
7. **Una ronda de REST con TLS tuvo 539 errores y respuestas de 8,8 s** y no se repitió al volver a correr toda la prueba. Se rehízo la medición en lugar de ignorar el incidente.

La lección para clase: **un benchmark mal hecho puede "demostrar" cualquier cosa**. Antes de culpar a la teoría, revisar la medición.

## 11. Limpiar — T1

`Ctrl+C` en T1 para parar el servicio. `npm run bench` levanta y para su propio servicio y su gateway en los puertos 18300, 18301 y 18310; `npm run network` y `npm run stream` crean un contenedor (`m8demo-net` y `m8demo-stream`) y lo borran al terminar; `npm run java` usa los puertos 18800 y 18801 y `npm run tls`, del 18900 al 18903.

## Notas para quien repita la demo

- Los resultados de `results/` son de una sola máquina y se pueden regenerar con los comandos de arriba. Comparar el orden entre estilos, no el valor exacto.
- Limitaciones de las mediciones: servidor y cliente Node en la misma máquina (i9-12900H con núcleos de rendimiento y de eficiencia, sin fijar procesos a núcleos); el cliente es un solo proceso y puede limitar el máximo de llamadas/s; en la prueba de red, el retardo y el límite se aplican solo a las respuestas, y Docker en Windows añade su propia capa de red.
- La base de datos simulada se ajusta con `DB_LATENCY_MS` (por defecto 1) y `DB_POOL` (por defecto 10). Con `DB_LATENCY_MS=0` el N+1 casi desaparece, y eso también es una lección.
- Para repetir solo un grupo: `ONLY=D npm run bench` (no sobrescribe `results/LATENCY.md`). `ROUNDS=1` acorta la corrida.
- Lo que no cubre esta demo: compresión de gRPC (no se puede medir con Node), un servidor Go, *streaming* de cliente y bidireccional, y mediciones en una red real entre máquinas.
