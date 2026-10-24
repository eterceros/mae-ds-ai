# Docker y Compose, antes y después (demo del docente)

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 8

> **Es una demostración del docente.** No hay nada que entregar con esta demo (el laboratorio de la sesión está en [`../laboratorio-s08/`](../laboratorio-s08/)). Se publica para repasarla después de la clase y reproducirla si quieren. No necesita claves ni tokens de pago.

## Qué es

Una API **NestJS mínima** (Node 24) con un endpoint que lee Postgres (`GET /items`) y otro de salud (`GET /salud`), empaquetada dos veces:

- [`antes/`](antes/): como sale cuando se escribe rápido o se acepta lo que genera una IA: una sola etapa, base completa, root, secretos en `ARG` y `.env`, Compose sin healthcheck ni migraciones.
- [`despues/`](despues/): lo mismo corregido. Cada corrección lleva un comentario `# CORRECCIÓN: …` que explica el porqué y, cuando la hay, la cifra medida.

[`DIFERENCIAS.md`](DIFERENCIAS.md) tiene la tabla completa: problema, dónde está en `antes/`, qué cambia en `despues/` y cuánto se midió.

Lo que ya se vio en la S02 (12-factor, SIGTERM y apagado, antipatrones del Dockerfile) no se repite aquí; los archivos lo enlazan.

## Escenarios

| | Qué compara | Qué enseña | Resultados |
|---|---|---|---|
| **K1** | Dockerfile ingenuo frente a multi-stage: tamaño, capas, build en frío y con caché | Por qué el orden de las capas y las etapas cambian el tamaño y el tiempo de rebuild | [`K1_MULTISTAGE.md`](results/K1_MULTISTAGE.md) |
| **K2** | Cinco bases: `node:24`, `node:24-slim`, `node:24-alpine`, distroless y Docker Hardened Image | De dónde vienen el tamaño y las CVE; qué se pierde sin shell | [`K2_BASES.md`](results/K2_BASES.md) |
| **K3** | Root frente a usuario sin privilegios (`docker exec id`, capacidades, escrituras) | Qué puede hacer quien toma el proceso de la API | [`K3_USUARIO.md`](results/K3_USUARIO.md) |
| **K4** | Secreto en `ARG` y `COPY .env` frente a `RUN --mount=type=secret` | Qué queda en `docker history` y en las capas | [`K4_SECRETOS.md`](results/K4_SECRETOS.md) |
| **K5** | Compose sin healthcheck, con healthcheck por socket y con healthcheck por TCP | Por qué `depends_on` sin condición no basta | [`K5_HEALTHCHECK.md`](results/K5_HEALTHCHECK.md) |
| **K6** | Migraciones como servicio que corre una vez antes de la API (y una migración rota) | `service_completed_successfully`: la API no arranca sobre un esquema a medias | [`K6_MIGRACIONES.md`](results/K6_MIGRACIONES.md) |
| **K7** | Dockerfiles generados por IA (un modelo local chico y Gordon) revisados con hadolint, Trivy y Scout | Qué detectan las herramientas y qué solo detecta una persona | [`K7_IA.md`](results/K7_IA.md) |
| **K8** | El mismo stack con Podman (rootless), con `podman compose` sobre sus dos proveedores (docker-compose y podman-compose) | Que el Dockerfile y el compose portables corren igual, y que «Compose» depende de qué programa lo interpreta | [`K8_PODMAN.md`](results/K8_PODMAN.md) |

## Estructura

```
api/                      la API (src/, migrations/, package.json); es el contexto de build de todo
antes/                    versiones con problemas (K1, K3, K4, K5, K7)
  Dockerfile                una etapa, node:24, root, COPY . . antes de npm install
  Dockerfile.secreto        ARG NPM_TOKEN + COPY .env / rm .env
  compose.yaml              depends_on sin condición ni healthcheck
  compose.healthcheck-socket.yaml   healthcheck por socket Unix (la trampa)
  Dockerfile.ia-*           generados por IA, sin revisar
despues/                  versiones corregidas, con "# CORRECCIÓN:"
  Dockerfile                multi-stage, slim fijada por digest, USER node (la usa compose.yaml)
  Dockerfile.secreto        RUN --mount=type=secret
  compose.yaml              healthchecks, service_healthy, servicio migrate (K5, K6)
  compose.migracion-con-error.yaml + migraciones-con-error/   K6, caso de falla
  compose.dev.yaml          develop.watch para desarrollo (no medido)
  Dockerfile.ia-gordon-revisado
  spring/Dockerfile         multi-stage de referencia para Spring Boot (no medido)
bases/Dockerfile          K2: la misma API sobre cinco bases (--target)
ia/                       K7: el pedido y las respuestas crudas de los dos asistentes
scripts/                  un script por escenario (solo stdlib de Node; k8 usa Podman)
results/                  cifras medidas (Markdown) y datos crudos (json/)
```

## Requisitos

- **Docker** con BuildKit y Compose v2 o posterior. Probado con Docker Desktop (Engine 29.9.2, Compose 5.6.0, buildx 0.38.1) sobre WSL2 en Windows 11, con el almacén de imágenes containerd (el predeterminado de Docker Desktop reciente; con él `docker image ls` muestra el tamaño en disco y el comprimido).
- **Node.js 24** para correr los scripts (probado con 24.19.0). No hace falta `npm install` en la raíz: los scripts no tienen dependencias. La API se compila dentro de Docker.
- **Red** para descargar las imágenes base y los paquetes de npm.
- Para K2: `docker login dhi.io` (cuenta gratuita de Docker) para la Docker Hardened Image, y `docker login` en Docker Hub para Docker Scout. Sin sesión, esas dos columnas salen con error y el resto funciona.
- Para K7: nada extra para correr el script (usa los Dockerfiles ya generados en `antes/`). Regenerarlos pide Docker Model Runner con `ai/smollm2` y Gordon (ver [`results/K7_IA.md`](results/K7_IA.md)).
- Para K8: **Podman** 5.8 o posterior con su máquina encendida (`podman machine start`; el script busca `podman` en el PATH o en `C:Program FilesRedHatPodman`). Para medir también podman-compose hace falta `uvx` ([uv](https://docs.astral.sh/uv/)), que lo corre sin instalarlo, o la variable `PODMAN_COMPOSE` con la ruta de un podman-compose ya instalado; sin ninguno de los dos, solo mide el proveedor docker-compose.
- Puertos del host, todos en `127.0.0.1`: **18100** (API), **18101–18103** (pruebas de K2, K3 y K7), **18132** (Postgres) y **18150–18151** (API y Postgres de K8).
- Trivy, hadolint y Dive corren como contenedores con versión y digest fijos (Trivy 0.76.1: ver el aviso sobre el incidente de marzo de 2026 en el [laboratorio](../laboratorio-s08/README.md)).

## Cómo correrlo

Solo el stack corregido:

```
cd despues
docker compose up -d --wait        # Postgres, migraciones y API
curl http://127.0.0.1:18100/items
docker compose --profile herramientas run --rm psql    # opcional: consola de la base
docker compose down -v
```

Cada escenario (desde la carpeta `demo-docker/`; cada uno escribe su archivo en `results/`):

```
npm run k1      # ≈ 2 min (3 rondas)
npm run k2      # ≈ 4 min (la primera vez Trivy baja su base de datos)
npm run k3
npm run k4
npm run k5      # ≈ 8 min (3 variantes × 2 estados del volumen × 5 corridas)
npm run k6      # ≈ 1 min
npm run k7      # ≈ 3 min
npm run k8      # ≈ 6 min (Podman: build, los dos proveedores de podman compose y la referencia con Docker)
npm run todo    # todos seguidos y "down" al final
npm run limpiar # borra contenedores, volúmenes e imágenes s08-docker/*, la caché de Trivy y .tmp/
```

Variables útiles: `RONDAS` (por defecto 3; K1 y K6), `RONDAS_K5` (por defecto 5) y `VERIFICAR=1`, que escribe en `.tmp/verificacion/` en lugar de `results/` (para comprobar que un escenario sigue andando sin pisar las cifras publicadas).

A mano, sin los scripts, cada par se construye con `api/` como contexto:

```
docker build -f antes/Dockerfile   -t demo:antes   api
docker build -f despues/Dockerfile -t demo:despues api
docker image ls demo
```

## Resultados principales

Medidos el 24 de octubre de 2026 en un portátil (Intel Core i9-12900H, 20 hilos, 64 GB de RAM, Windows 11) con Docker Desktop (VM de WSL2 con 20 CPU y 31 GB). Tiempos: mediana de 3 rondas. Detalle, rangos y salidas en `results/`.

| | Antes | Después |
|---|---|---|
| **K1** tamaño (disco / comprimido) | 1,74 GB / 429 MB | 357 MB / 83,4 MB |
| **K1** rebuild tras cambiar una línea de `src/` | 9,4 s (reinstala dependencias) | 2,4 s (solo recompila) |
| **K1** build en frío (`--no-cache`) | 8,7 s | 8,2 s |
| **K2** CVE según Trivy (`node:24` → `-slim`) | 4641 (21 críticas, 618 altas) | 245 (1 crítica, 62 altas); Alpine 16; distroless y DHI 32 |
| **K3** usuario y capacidades | root, 14 capacidades, puede reescribir su código y `/etc/passwd` | uid 1000, 0 capacidades, no puede |
| **K4** token en `docker history` / hallazgos en las capas | sí / 3 (incluido el `.env` completo) | no / 0 |
| **K5** API arranca bien con el volumen vacío | 0 de 5 (`ECONNREFUSED`) | 5 de 5 |
| **K6** migración rota | — (no hay paso de migraciones) | `up --wait` sale con 1 y la API no arranca; esquema intacto |
| **K7** Dockerfile de Gordon: ¿el proceso puede reescribir su código? | sí (`--chown=node:node`) | no (revisado) |

K8 no es un antes/después sino Docker frente a Podman, con el stack de `despues/` sin cambios:

| **K8** | Docker | Podman 5.8 rootless |
|---|---|---|
| Imagen (sin comprimir / capas) | 249,2 MB / 10 | 249,2 MB / 9 (mismas 5 capas de la base) |
| Build en frío (`--no-cache`) | 7,0 s | 18,7 s; 11,7 s con `--jobs 3` |
| Hasta `/salud` desde `up -d` | 3,4 s | 4,0 s con docker-compose; 9,6 s con podman-compose |
| Migración rota | la API no arranca | igual con docker-compose; **con podman-compose 1.6.0 la API arranca** y `up` sale con 0 |
| Usuario del proceso de la API | uid 1000 dentro (K3) | uid 1000 dentro, uid 525287 sin privilegios en la VM |

Sorpresas que vale la pena mirar en clase:

- **K1: el build en frío casi no cambia** (8,7 s frente a 8,2 s): la multi-stage instala dependencias dos veces, pero en etapas que BuildKit corre en paralelo. Lo que cambia es el rebuild del día a día.
- **K2: distroless y la Docker Hardened Image dan exactamente las mismas 32 CVE en Trivy** (las dos son Debian 13 con 14 paquetes), y Scout las cuenta distinto (1 alta frente a 2 altas y 8 bajas). La única CVE alta de las dependencias propias (`multer 2.4.0`) aparece en las cinco variantes: la base no la arregla.
- **K5: sin healthcheck, con la base ya inicializada, la API ganó la carrera 5 de 5.** Por eso el problema no aparece «en mi máquina» y sí la primera vez en otra. La trampa del `pg_isready` por socket **no se reprodujo** en 5 corridas: la ventana es corta.
- **K8: con podman-compose, `service_completed_successfully` no protege.** podman-compose 1.6.0 solo espera a que `migrate` termine, sin mirar el código de salida: con la migración rota, la API arrancó y respondió. Con el proveedor docker-compose (el que `podman compose` usa si encuentra Docker Desktop) se comporta igual que Docker.
- **K7: hadolint no avisó nada de lo importante.** No marcó el root del Dockerfile ingenuo (su regla solo salta con un `USER root` explícito) ni la etiqueta flotante; `trivy config` sí marcó el root. Ninguna herramienta vio el `--chown` sobre el código que dejó Gordon: lo encontró la prueba de K3.

## Podman

El stack de `despues/` está preparado para correr igual con **Podman** (un motor de contenedores compatible con Docker que no necesita un demonio con privilegios; en modo *rootless* los contenedores corren con el usuario de quien los lanza):

- Todas las imágenes de `despues/` llevan el **registro completo** (`docker.io/library/postgres:17.11@sha256:…` en `compose.yaml`, `docker.io/library/node:24.22.1-bookworm-slim@sha256:…` en los `FROM` de `despues/Dockerfile`): Podman no supone Docker Hub para nombres cortos. Los Dockerfiles de `antes/` y `bases/` usan nombres cortos, como se suele escribir.
- Solo **puertos altos** (18100, 18132): rootless no puede publicar puertos menores a 1024.
- Los **healthchecks están en `compose.yaml`**, no en un `HEALTHCHECK` del Dockerfile (Podman construye en formato OCI por defecto, que no guarda `HEALTHCHECK`).
- No hay *bind mounts* en el stack base (solo un volumen con nombre), salvo en `compose.migracion-con-error.yaml`, que monta una carpeta de solo lectura.

Para levantarlo (con Podman instalado y, en Windows o macOS, `podman machine start`):

```
cd despues
podman compose up -d
podman compose ps
curl http://127.0.0.1:18100/items
podman compose down -v
```

`podman compose` es un envoltorio: si encuentra `docker-compose` instalado (por ejemplo, con Docker Desktop) lo usa contra el socket de Podman; si no, usa `podman-compose`. Se puede elegir con la variable `PODMAN_COMPOSE_PROVIDER`. **El comportamiento de `depends_on` con `condition:` depende del proveedor** (K8): con docker-compose es igual que con Docker; con podman-compose 1.6.0, `service_healthy` se respeta pero `service_completed_successfully` solo espera a que `migrate` termine (aunque falle) y `migrate` corre dos veces. Con podman-compose, revisen a mano que `migrate` haya salido con 0 (`podman ps -a`) antes de confiar en la API. Si en la misma máquina corre Docker Desktop, los puertos 18100 y 18132 deben estar libres (bajen antes el stack de Docker).

**Podman 6.0 quitó el soporte de Windows 10 y de Macs con Intel**: ahí hay que usar Podman 5.8 (`winget install --id RedHat.Podman --source winget` instala la 5.8.3; `Podman.CLI` es la 6.1.4). Los pasos completos, por sistema, están en el [laboratorio](../laboratorio-s08/README.md#opción-b-el-mismo-stack-con-podman).

## Qué no se midió

- **K8 (Podman)**: solo en Windows con la máquina WSL2 de Podman 5.8.3; ni Linux nativo, ni modo rootful, ni Podman 6. Lista completa en [`K8_PODMAN.md`](results/K8_PODMAN.md#qué-no-se-midió).
- **El Dockerfile de Spring Boot** ([`despues/spring/Dockerfile`](despues/spring/Dockerfile)) no se construyó ni se midió; es una plantilla. La etiqueta exacta del parche de Java de `eclipse-temurin:25` queda `[por verificar]` (el digest sí se consultó).
- **`compose.dev.yaml` con `develop.watch`** se validó con `docker compose config`, pero no se midió ni se probó el ciclo de recarga.
- **Descarga de imágenes base**: el «build en frío» de K1 parte con las bases ya descargadas; el tiempo de bajar `node:24` (1,65 GB en disco) frente a `node:24-slim` (333 MB) no está incluido.
- **Contexto de build con `node_modules` local**: el contexto de las pruebas no lo tiene, así que no se midió cuánto infla el contexto (y la imagen ingenua) un `node_modules` del host.
- **Tiempo de arranque de cada base** (K2): solo se comprobó que cada variante arranca y lee Postgres.
- **Frecuencia real de la trampa del socket** (K5): no apareció en 5 corridas; no se probó con scripts de inicialización largos.
- **Gordon**: una sola respuesta, sin acceso a los archivos del proyecto (se le negaron las herramientas); otra corrida puede dar otro Dockerfile. El modelo que usa por detrás no se informa en la CLI `[por verificar]`.
- **Escaneo en un pipeline** (CI, firmas, SBOM): fuera del alcance del módulo; aquí Trivy y Scout son higiene local.

## Advertencias

- **Una sola máquina, compartida.** Mientras se medía corrían también otras demos del módulo en la misma Docker Desktop; los tiempos absolutos de K1, K5 y K6 cambian con la máquina y la red (npm se descarga en cada build en frío). Lo que se mantiene es el orden y la forma: qué se reinstala, qué arranca antes, qué queda en la imagen.
- **Las CVE cambian cada día**: la base de datos de Trivy se actualiza y las imágenes base también. Las cifras de K2 y K7 valen para el 24 oct 2026 con los digests fijados en los Dockerfiles.
- **Los «secretos» de K4 son falsos** (`npm_K4tokenFALSOdeDemo…`, un registro `npm.ejemplo.invalid`). No pongan secretos reales en una prueba como esta.
