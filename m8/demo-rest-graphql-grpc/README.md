# REST, GraphQL y gRPC sobre el mismo servicio (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 5

> **Es una demostración del docente.** No hay nada que entregar ni que ejecutar. Se publica para que puedan repasarla después de la clase y reproducirla si quieren. No necesita claves ni tokens de ningún servicio.

## Qué es

Un servicio de **estudiantes** en NestJS que expone los mismos datos de tres maneras, más un **gateway** pequeño (`src/gateway.ts`) que le habla a ese servicio por REST o por gRPC para medir la comunicación entre servidores:

| Estilo | Dónde | Contrato |
|---|---|---|
| REST | `http://127.0.0.1:3000/students` | rutas HTTP + JSON |
| GraphQL | `http://127.0.0.1:3000/graphql` | [`src/schema.graphql`](src/schema.graphql) |
| gRPC | `127.0.0.1:50051` | [`proto/students.proto`](proto/students.proto) |

La base de datos es **simulada** (memoria, con 1 ms por consulta y un máximo de 10 consultas a la vez) para que el patrón N+1 se note como se notaría con una base real. No es una medición de ninguna base de datos.

## Escenarios

| | Qué se pide | Qué enseña |
|---|---|---|
| **A** | Un estudiante (el cliente solo necesita el nombre) | Cuando el dato es pequeño, el estilo casi no importa |
| **B** | Lista de 2000 estudiantes | Tamaño de la respuesta y costo de serializar |
| **C** | 50 estudiantes con sus cursos | Número de viajes al servidor y el problema N+1 |
| **D1** | Un segundo servidor (gateway) pide 20 estudiantes al servicio, de uno en uno y en paralelo, por REST o por gRPC | Comunicación servicio a servicio con muchas llamadas pequeñas |
| **D2** | El gateway pide la lista de 2000 al servicio en una sola llamada, por REST o por gRPC | Comunicación servicio a servicio con una llamada grande |

## Requisitos

- Node.js 22 o superior (probado con 24.19).
- Docker, solo para `npm run network` y `npm run stream` (imágenes `node:22-alpine` y `nicolaka/netshoot`).
- Java 25 o superior y Maven 3.9, solo para `npm run java` (probado con Java 26 y Maven 3.9.16).
- `openssl`, solo para `npm run tls` (en Windows viene con Git).
- k6 **no** hace falta: las mediciones usan un cliente Node igual para los tres estilos. El cliente gRPC de k6 hace más trabajo que su cliente HTTP y falsea la comparación (ver `GUION.md`, sección 10).

## Cómo correrlo

```
npm install
npm run build
npm start                 # deja el servicio escuchando; usar otra terminal para lo demás
npm run payloads          # bytes, peticiones y consultas a la base por escenario
npm run codec             # costo de serializar/decodificar JSON y protobuf (solo CPU)
npm run bench             # capacidad y latencia por escenario (levanta su propio servicio y gateway en otros puertos)
npm run network           # lo mismo con red limitada (Docker + tc netem)
npm run stream            # streaming: cuándo llega el primer elemento (Docker)
npm run tls               # costo de TLS y de abrir una conexión nueva por llamada
(cd java-server && mvn -q package -DskipTests) && npm run java   # el mismo servicio en Java (Spring Boot + grpc-java)
```

El paso a paso con lo que se muestra en clase, la salida esperada y las conclusiones está en [`GUION.md`](GUION.md).

## Resultados de referencia

Medidos el 21 de octubre de 2026 en un portátil (Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11), con cliente y servidor en la misma máquina:

- [`results/PAYLOADS.md`](results/PAYLOADS.md): bytes por respuesta, número de peticiones y consultas a la base.
- [`results/LATENCY.md`](results/LATENCY.md): máximo de llamadas por segundo y latencia p50/p95/p99, incluidos los escenarios servicio a servicio.
- [`results/CODEC.md`](results/CODEC.md): costo de codificar y decodificar en Node, solo CPU.
- [`results/NETWORK.md`](results/NETWORK.md): los mismos escenarios con 20 ms de retardo y 20 Mbit/s.
- [`results/JAVA.md`](results/JAVA.md): REST contra gRPC en un servidor compilado (Spring Boot 4.1 y grpc-java 1.83).
- [`results/STREAM.md`](results/STREAM.md): cuándo llega el primer elemento con *streaming* y cuándo llegan todos.
- [`results/TLS.md`](results/TLS.md): costo de TLS y de abrir una conexión nueva en cada llamada.

**Úsenlos como orden de magnitud, no como verdad.** Cada cifra es la mediana de 3 rondas; en algunos escenarios los rangos entre rondas se solapan (se indica en `GUION.md`). Casi todo con servidor Node y cliente Node en una sola máquina (en las pruebas de red y de *streaming*, el servidor va en un contenedor; en `JAVA.md`, el servidor es Java). No se pueden comparar cifras de Java con cifras de Node: son servidores distintos. Con una red real entre máquinas, los números cambian, y es posible que el orden también.

**Una advertencia sobre la propia medición:** la primera versión de esta demo daba resultados que contradecían la teoría (gRPC más lento que REST, GraphQL hasta 15 veces más lento). Eran errores del experimento, no de la teoría; `GUION.md` (sección 10) cuenta cuáles fueron.
