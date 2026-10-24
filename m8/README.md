# Módulo 8 – Desarrollo Backend y APIs Escalables

Prácticas, consignas y ejemplos del Módulo 8 (12 de octubre al 13 de noviembre de 2026).

El contenido se irá agregando a medida que avance el módulo.

## Contenido

| Carpeta | Qué es |
|---------|--------|
| [`demo-rest-graphql-grpc/`](demo-rest-graphql-grpc/) | Demo del docente (sesión 5): el mismo servicio de estudiantes por REST, GraphQL y gRPC en NestJS, con bytes y latencia medidos. Para repasar; no hay nada que entregar |
| [`demo-migraciones/`](demo-migraciones/) | Demo del docente (sesión 6): migraciones de esquema en Postgres con carga concurrente; qué bloquea cada `ALTER` y cómo hacerlo sin cortar el servicio, más Squawk, Prisma y Flyway. Para repasar; no hay nada que entregar |
| [`demo-cache/`](demo-cache/) | Demo del docente (sesión 6): caché con Postgres, Redis y Valkey; índice, `ETag`, cache-aside, estampida, datos obsoletos, *rate limiting* y expulsión, con mediciones. Para repasar; no hay nada que entregar |
| [`demo-docker/`](demo-docker/) | Demo del docente (sesión 8): la misma API NestJS empaquetada con Docker y Compose en `antes/` (una etapa, root, secretos en `ARG`, Compose sin healthcheck) y `despues/` (corregido), con tamaño, CVE, capas y arranque medidos. Modelo para la **actividad 7** (`compose.yaml`) y para el laboratorio de la S08. Para repasar; no hay nada que entregar |
| [`demo-resiliencia/`](demo-resiliencia/) | Demo del docente (sesión 8): un servicio A que llama a B con la red rota a propósito (Toxiproxy); cliente sin protección en `antes/` y con timeout, reintentos con backoff y *jitter*, circuit breaker y bulkhead en `despues/`, con latencias y errores medidos. Referencia para el experimento **E3** (resiliencia). Para repasar; no hay nada que entregar |
| [`demo-mensajeria/`](demo-mensajeria/) | Demo del docente (sesión 8): pedidos con Postgres y RabbitMQ 4.4, matando procesos en el punto crítico; doble escritura y consumidor sin idempotencia en `antes/`, outbox, idempotencia y DLQ en `despues/`, con mensajes perdidos y duplicados contados; incluye un LLM local con Docker Model Runner. Referencia para el experimento **E4** (mensajería). Para repasar; no hay nada que entregar |
| [`laboratorio-s08/`](laboratorio-s08/) | Guía del laboratorio de la sesión 8 (25 minutos en clase): elegir la opción **A** (auditar y adelgazar la imagen de su servicio) o la **B** (levantar su stack con Podman). Entregable: `docs/laboratorios/imagen-o-podman.md` en el repositorio del grupo, hasta el domingo 1 de noviembre, 23:59 (junto con la actividad 7). Se hace sin IA; [`demo-docker/`](demo-docker/) sirve de material de apoyo |
| [`EXPERIMENTOS.md`](EXPERIMENTOS.md) | Índice de todas las demos del docente del módulo, con sus resultados principales y enlaces a cada archivo de resultados. Para repasar; no hay nada que entregar |

## Sesión 8: cómo usar las demos

Las tres demos nuevas tienen la misma forma: el código está en `antes/` (malas prácticas, como las escribe alguien con apuro o una IA sin revisar) y en `despues/` (corregido, con cada cambio comentado), y un archivo `DIFERENCIAS.md` lo pone lado a lado con las cifras medidas. Léanlas como modelo de qué revisar en su propio proyecto, no como código para copiar a ciegas.

| Qué van a hacer | Fecha de entrega | Qué les sirve de modelo |
|---|---|---|
| Actividad 7: `compose.yaml` de su proyecto | domingo 1 de noviembre, 23:59 | [`demo-docker/`](demo-docker/) (`despues/compose.yaml`: healthcheck, `depends_on` con condición, migraciones como servicio) |
| Laboratorio de la S08: auditar/adelgazar la imagen o Podman (`docs/laboratorios/imagen-o-podman.md`) | domingo 1 de noviembre, 23:59 | la guía [`laboratorio-s08/`](laboratorio-s08/), con [`demo-docker/`](demo-docker/) como apoyo |
| Experimento E3: resiliencia | lunes 9 de noviembre | [`demo-resiliencia/`](demo-resiliencia/) |
| Experimento E4: mensajería (incluye un LLM local con Docker Model Runner) | lunes 9 de noviembre | [`demo-mensajeria/`](demo-mensajeria/) |
