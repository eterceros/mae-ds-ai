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
- Docker, solo para `npm run network` (imágenes `node:22-alpine` y `nicolaka/netshoot`).
- k6 **no** hace falta: las mediciones usan un cliente Node igual para los tres estilos. El cliente gRPC de k6 hace más trabajo que su cliente HTTP y falsea la comparación (ver `GUION.md`, sección 7).

## Cómo correrlo

```
npm install
npm run build
npm start                 # deja el servicio escuchando; usar otra terminal para lo demás
npm run payloads          # bytes, peticiones y consultas a la base por escenario
npm run codec             # costo de serializar/decodificar JSON y protobuf (solo CPU)
npm run bench             # capacidad y latencia por escenario (levanta su propio servicio y gateway en otros puertos)
npm run network           # lo mismo con red limitada (Docker + tc netem)
```

El paso a paso con lo que se muestra en clase, la salida esperada y las conclusiones está en [`GUION.md`](GUION.md).

## Resultados de referencia

Medidos el 21 de octubre de 2026 en un portátil (Intel Core i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows 11), con cliente y servidor en la misma máquina:

- [`results/PAYLOADS.md`](results/PAYLOADS.md): bytes por respuesta, número de peticiones y consultas a la base.
- [`results/LATENCY.md`](results/LATENCY.md): máximo de llamadas por segundo y latencia p50/p95/p99, incluidos los escenarios servicio a servicio.
- [`results/CODEC.md`](results/CODEC.md): costo de codificar y decodificar en Node, solo CPU.
- [`results/NETWORK.md`](results/NETWORK.md): los mismos escenarios con 20 ms de retardo y 20 Mbit/s.

**Úsenlos como orden de magnitud, no como verdad.** Cada cifra es la mediana de 3 rondas; entre rondas el orden entre estilos se mantuvo. Todo con servidor Node y cliente Node en una sola máquina (en la prueba de red, el servidor va en un contenedor). Con otro lenguaje en el servidor, con una red real o con TLS, los números cambian, y es posible que el orden también.

**Una advertencia sobre la propia medición:** la primera versión de esta demo daba resultados que contradecían la teoría (gRPC más lento que REST, GraphQL hasta 15 veces más lento). Eran errores del experimento, no de la teoría; `GUION.md` (sección 7) cuenta cuáles fueron.
