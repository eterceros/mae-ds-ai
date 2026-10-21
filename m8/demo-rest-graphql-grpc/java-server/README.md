# Servidor Java (REST + gRPC) para comparar con la versión Node

El mismo servicio de estudiantes de `../src/` (NestJS), escrito en Java: REST con **Spring MVC + Jackson** y gRPC con **grpc-java**. Sirve para ver si la comparación REST frente a gRPC cambia cuando el servidor es compilado (en Node, el JSON nativo de V8 es muy rápido y la librería protobuf es JavaScript; en Java, los dos lados son código compilado por la JVM).

Solo REST y gRPC: aquí no hay GraphQL ni gateway.

## Versiones

| Pieza | Versión |
|---|---|
| Java | se compila para 25 (`<java.version>25</java.version>`) y se ejecuta con el JDK instalado (probado con Oracle JDK 26.0.2) |
| Spring Boot | 4.1.1 (Spring MVC, Tomcat 11.0.24, Jackson 3.1.5) |
| grpc-java | 1.83.1 (`grpc-netty-shaded`), la que fija Spring Boot 4.1.1 |
| protobuf-java y protoc | 4.35.1, la que fija Spring Boot 4.1.1 |
| Generación de código | `org.xolstice.maven.plugins:protobuf-maven-plugin` 0.6.1 + `kr.motd.maven:os-maven-plugin` 1.7.1 |
| Maven | 3.9.16 |

Se compila para Java 25 (la LTS) y no para 26, para no depender de que todas las herramientas lean ya clases de Java 26; corre sin problemas en el JDK 26.

**No hace falta instalar protoc:** Maven descarga `protoc` y `protoc-gen-grpc-java` como artefactos. Se usa el plugin de `org.xolstice` y no el de `io.github.ascopes` (el que trae Spring Boot) porque este último copia `protoc.exe` a una ruta larga dentro de `target/`, y si la carpeta del proyecto ya es larga, Windows no puede ejecutarlo (límite de 260 caracteres). Por la misma razón, los plugins de protoc van a `target/p`.

## Compilar y ejecutar

```
cd java-server
mvn -q package -DskipTests          # genera target/students-java-server.jar
HTTP_PORT=3100 GRPC_PORT=50061 java -jar target/students-java-server.jar
```

| Variable | Por defecto | Qué hace |
|---|---|---|
| `HTTP_PORT` | 3000 | REST |
| `GRPC_PORT` | 50051 | gRPC |
| `HOST` | 127.0.0.1 | dirección de escucha (REST y gRPC) |
| `DB_LATENCY_MS` | 1 | duración de cada consulta a la base simulada |
| `DB_POOL` | 10 | consultas simultáneas como máximo |
| `DB_WAIT` | `precise` | `sleep` usa `Thread.sleep` (impreciso en Windows, ver abajo), solo para comparar |

Los puertos por defecto son los mismos que en Node: no los levante a la vez sin cambiar uno.

Prueba rápida (desde la carpeta del proyecto):

```
curl http://127.0.0.1:3100/students/7
GRPC_PORT=50061 node scripts/grpc-call.mjs GetStudent "{\"id\":7}"
```

Rutas REST: `GET /students/{id}`, `GET /students?limit=N` (por defecto 100; `&expand=courses` incluye los cursos), `GET /students/{id}/courses`, `GET /stats` y `POST /stats/reset` (contador de consultas). gRPC: `GetStudent` y `ListStudents` (con `withCourses`), del mismo `../proto/students.proto`, que Maven lee directamente desde esa carpeta (no hay copia). `StreamStudents` (flujo del servidor) existe en el contrato pero no está implementado aquí: responde `UNIMPLEMENTED`.

## Medir

```
node scripts/java-bench.mjs          # desde la carpeta del proyecto; escribe results/JAVA.md
```

Levanta el JAR en los puertos 18800 (REST) y 18801 (gRPC) y mide A (un estudiante), B (lista de 2000) y P (20 llamadas pequeñas en paralelo, ids 1 a 20) para REST y gRPC, con el mismo cliente Node y el mismo método que `scripts/bench.mjs`. `SMOKE=1` hace una sola llamada por variante, sin medir. Ver la cabecera del script para las demás variables.

## Qué se hizo para que la comparación sea justa

- **Mismos datos y mismas respuestas.** 2000 estudiantes, 200 cursos, 5 cursos por estudiante, mismos nombres y misma fórmula que `src/data.service.ts`. Comprobado byte a byte contra el servidor Node: `GET /students?limit=2000` devuelve **213 080 bytes** en los dos, y las respuestas de `/students/7`, `?limit=50&expand=courses`, `/students/3/courses`, `?limit=abc` y las de gRPC (`GetStudent`, `ListStudents` con y sin cursos, `NOT_FOUND`) son idénticas.
- **Orden de los campos.** Jackson 3 ordena las propiedades alfabéticamente por defecto; se fija `@JsonPropertyOrder` (id, name, email, career, courses) para que el JSON sea el mismo que el de Node. JSON compacto.
- **Misma base simulada.** Cada consulta espera `DB_LATENCY_MS` y como máximo `DB_POOL` consultas a la vez; las demás esperan en orden de llegada (semáforo justo), como la cola de Node. Mismo número de consultas por petición (una para un estudiante o para la lista; una más para los cursos de toda la lista).
- **Espera precisa.** En esta máquina (JDK 26, Windows 11), una espera pedida de 1 ms dura: `Thread.sleep(1)` ≈ 2,0 ms (p50) y 3,3 ms (p99); `LockSupport.parkNanos(1 ms)` ≈ 1,5 ms; un temporizador de alta resolución de Windows ≈ 1,65 ms. Con eso la "consulta" de Java costaría el doble que la de Node. Se usa un **único hilo temporizador** (`PreciseSleeper`) que mira la hora mientras haya esperas pendientes (cediendo el núcleo con `Thread.yield`) y despierta a cada hilo a su hora; los hilos que esperan están dormidos y no gastan CPU, y sin esperas pendientes el temporizador también duerme. Medido: 1,01 ms (p50) y 1,10 ms (p99) con 10 hilos esperando a la vez. Es el mismo recurso que usa Node (`setImmediate` hasta que vence la espera); la diferencia es que en Java ese hilo corre aparte, mientras que en Node comparte el único hilo del servidor. Cuesta hasta un núcleo **solo mientras hay consultas en curso**.
- **Mismo trabajo por petición.** Los mensajes protobuf se construyen en cada llamada a partir de los mismos objetos que serializa Jackson; no hay respuestas precalculadas en ninguno de los dos estilos.
- **Hilos.** REST (Tomcat) y gRPC (ejecutor por defecto de grpc-java) bloquean un hilo de plataforma durante la consulta simulada; ninguno usa hilos virtuales.
- **Conexiones persistentes.** Tomcat cierra por defecto cada conexión tras 100 peticiones; se quita ese tope y se dejan 65 s de espera, como en `src/main.ts`. Sin gzip, como Node por defecto.
- **Calentamiento de la JVM.** El JIT compila el código caliente tras miles de llamadas: en frío, `GET /students/7` tardaba ~3,8 ms y bajó a ~2,4 ms tras unos cientos de llamadas. `java-bench.mjs` corre cada variante 5 s a carga máxima antes de calibrar y lo descarta (`JVM_WARMUP_S`).

Diferencias conocidas que no se igualaron:

- Spring envía el JSON con `Transfer-Encoding: chunked`; Express lo envía con `Content-Length` y además calcula un `ETag` por respuesta (costo de CPU que solo paga Node).
- El servidor Node también carga GraphQL; este no.
- El cliente es el mismo proceso Node en los dos casos. Si el servidor Java es más rápido que el cliente, las llamadas/s máximas pueden quedar limitadas por el cliente, no por el servidor.
