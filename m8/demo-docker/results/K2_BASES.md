# K2. Variantes de imagen base

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1. Trivy 0.76.1 (base de datos de vulnerabilidades del 2026-10-24); Docker Scout CLI v1.26.0.

La misma API, compilada con las mismas etapas de build ([`bases/Dockerfile`](../bases/Dockerfile)); solo cambia la etapa final (`--target`). Todas las bases están fijadas por etiqueta exacta y digest (Node 24.22.1). Cada variante se arrancó en la red del stack y respondió `GET /items` leyendo Postgres.

| Base | Imagen final en disco | Contenido (comprimido) | Solo la base (disco) | Shell | Gestor de paquetes | Usuario (uid) | Arranca y lee Postgres |
|---|---:|---:|---:|---|---|---|---|
| node:24 (Debian 12 completo) | 1.66GB | 412MB | 1.65GB | sí | apt-get | node (1000) | sí |
| node:24-slim (Debian 12 recortado) | 357MB | 83.4MB | 333MB | sí | apt-get | node (1000) | sí |
| node:24-alpine (Alpine 3.24, musl) | 270MB | 64.8MB | 244MB | sí | apk | node (1000) | sí |
| distroless nodejs24-debian13 (Google) | 242MB | 57.8MB | 215MB | no | ninguno | 65532 (65532) | sí |
| Docker Hardened Image dhi.io/node:24 | 207MB | 44.2MB | 180MB | no | ninguno | 1000 (1000) | sí |

Vulnerabilidades conocidas (CVE) en la imagen final, el mismo día y con la misma imagen:

| Base | Sistema detectado | Paquetes del SO | Trivy: total | Crítica | Alta | Media | Baja | Sin clasificar | Con versión corregida | En paquetes del SO / Node de la base / dependencias de la app | Docker Scout (C/H/M/L) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| node:24 (Debian 12 completo) | debian 12.15 | 413 | 4641 | 21 | 618 | 2076 | 1760 | 166 | 26 | 4625 / 15 / 1 | 3C 57H 85M 245L |
| node:24-slim (Debian 12 recortado) | debian 12.15 | 88 | 245 | 1 | 62 | 96 | 84 | 2 | 16 | 229 / 15 / 1 | 0C 14H 13M 39L |
| node:24-alpine (Alpine 3.24, musl) | alpine 3.24.3 | 19 | 16 | 0 | 6 | 9 | 1 | 0 | 15 | 0 / 15 / 1 | 0C 6H 9M 1L |
| distroless nodejs24-debian13 (Google) | debian 13.7 | 14 | 32 | 0 | 1 | 23 | 8 | 0 | 1 | 31 / 0 / 1 | 0C 1H 0M 0L |
| Docker Hardened Image dhi.io/node:24 | debian 13.7 | 14 | 32 | 0 | 1 | 23 | 8 | 0 | 1 | 31 / 0 / 1 | 0C 2H 0M 8L |

CVE altas o críticas en las dependencias de la propia aplicación (`/app/node_modules`): multer 2.4.0. Es la misma en todas las variantes: cambiar la base no la arregla; hay que actualizar la dependencia.

«Node de la base» son los paquetes JavaScript que trae la imagen base, sobre todo el `npm` incluido en `/usr/local/lib/node_modules/npm` (la API no lo usa al correr). Distroless y la DHI no traen npm.

## Cómo leerlo

- **Casi todo el tamaño y casi todas las CVE vienen de la base**, no de la aplicación: el código propio pesa unos KB y las dependencias de producción unos 25 MB en todas las variantes.
- **Menos paquetes, menos CVE.** Una CVE se reporta por cada paquete instalado que tiene una vulnerabilidad publicada, se use o no. `node:24` trae compiladores, Python, git y cientos de bibliotecas que la API nunca llama. Slim y Alpine quitan la mayoría; distroless y la DHI quitan además la shell y el gestor de paquetes.
- **Sin shell no hay `docker exec ... sh`.** Es una ventaja (quien entre al contenedor no tiene herramientas) y un costo (para depurar hay que usar `docker debug` o un contenedor auxiliar). El healthcheck tampoco puede ser `curl`: tiene que ser el propio `node`.
- **Trivy y Scout no cuentan igual.** Usan bases de datos y criterios distintos (Trivy reporta también las CVE que el distribuidor marca como «no se va a corregir»; Scout aplica sus propios filtros y avisos del distribuidor). Lo útil es comparar variantes **con la misma herramienta** y mirar las que tienen versión corregida.
- **Alpine usa musl** en lugar de glibc: con dependencias nativas (bcrypt, sharp, Prisma) hay que compilarlas o descargarlas para musl.
