# Laboratorio de la sesión 8: auditar tu imagen o levantar tu stack con Podman

Módulo 8 · Desarrollo Backend y APIs Escalables · Sesión 8 (miércoles 28 de octubre de 2026)

- **En clase:** 25 minutos, justo después del bloque de Docker y Compose.
- **Quién:** cada integrante o el grupo completo elige **una** opción: **A** (auditar y adelgazar la imagen de su servicio) o **B** (levantar su stack con Podman). Pueden repartirse: unos hacen A y otros B.
- **Entrega:** el archivo `docs/laboratorios/imagen-o-podman.md` en el repositorio del grupo, **fecha sugerida: domingo 1 de noviembre, 23:59** (junto con la actividad 5); se reciben hasta el vie 13 nov, 23:59. La plantilla está al final de esta página.
- **Sin IA.** Este laboratorio se hace a mano: sin asistentes de IA (ni para escribir el Dockerfile ni para leer los resultados). La idea es que cada uno vea con sus propios ojos qué hay dentro de su imagen y qué cambia al correr sin Docker.
- **Material de apoyo:** la demo del docente [`../demo-docker/`](../demo-docker/) tiene un Dockerfile de antes y uno de después para la misma API, con las cifras medidas ([`DIFERENCIAS.md`](../demo-docker/DIFERENCIAS.md)). Úsenla para comparar, no para copiar a ciegas: su proyecto no es esa API.

## Antes de empezar

- Su proyecto tiene que construir una imagen con `docker build` o `docker compose build`. Si todavía no tiene Dockerfile, la opción A empieza por escribir uno (a mano).
- Docker Desktop (Windows o macOS) o Docker Engine (Linux) funcionando: `docker version` debe mostrar **Client** y **Server**.
- Todas las herramientas de la opción A corren **como contenedores**, así que no hay que instalar nada más. Cada comando fija la versión exacta y el digest de la imagen.
- Anoten los comandos y las salidas a medida que avanzan: el entregable las pide.

> **Aviso sobre Trivy (incidente de marzo de 2026).** Entre el 19 y el 22 de marzo de 2026 alguien publicó versiones manipuladas de Trivy: el binario v0.69.4, las imágenes de contenedor 0.69.5 y 0.69.6, y las *actions* `trivy-action` y `setup-trivy` de GitHub (aviso [GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23), CVE-2026-33634). Quien usó `aquasec/trivy:latest` esos días ejecutó código malicioso. Por eso aquí se usa **siempre una versión fija con su digest** (`aquasec/trivy:0.76.1@sha256:...`), nunca `latest`. Lo mismo vale para cualquier herramienta que usen en un pipeline: versión exacta y, en GitHub Actions, la *action* fijada por SHA del commit.

> **Aviso sobre Podman 6 (opción B).** Podman 6.0 dejó de funcionar en **Windows 10** y en **Mac con procesador Intel**. Si tienen alguno de los dos, instalen **Podman 5.8** (los comandos están en la opción B). En Windows 11, Mac con Apple Silicon y Linux pueden usar Podman 6.

Sobre los comandos: los bloques valen igual en **PowerShell** (Windows), **Terminal** (macOS) y cualquier shell de Linux, salvo donde se indica. En **Git Bash** de Windows, antepongan `MSYS_NO_PATHCONV=1` a los comandos que montan `/var/run/docker.sock`, o Git Bash convierte la ruta y falla.

---

## Opción A: auditar y adelgazar la imagen

Objetivo: medir la imagen de **un servicio** de su stack (la API, normalmente), corregir lo que encuentren y volver a medir. El resultado es una tabla antes/después.

### A1. Construir la imagen tal como está hoy

Desde la carpeta de su proyecto (cambien `api` por el nombre del servicio en su `compose.yaml`):

```
docker compose build api
docker image ls
```

Anoten el nombre de la imagen (columna `IMAGE`, por ejemplo `miproyecto-api:latest`). En los pasos siguientes la llamamos `MI_IMAGEN`. Para no perderla cuando la reconstruyan, guárdenle una etiqueta:

```
docker tag MI_IMAGEN mi-imagen:antes
```

### A2. Tamaño y capas

```
docker image ls mi-imagen:antes
docker image history mi-imagen:antes
```

- `docker image ls` muestra dos tamaños con Docker Desktop reciente: **DISK USAGE** (lo que ocupa descomprimida en disco) y **CONTENT SIZE** (las capas comprimidas, lo que se descarga). Anoten los dos.
- `docker image history` lista las capas de arriba (la última instrucción) hacia abajo, con el tamaño de cada una y la instrucción que la creó. Busquen las capas grandes: ¿qué instrucción las creó?, ¿hace falta eso para **ejecutar** el servicio?

Para ver **qué archivos** hay en cada capa, usen Dive (v0.13.1):

```
docker run --rm -it -v /var/run/docker.sock:/var/run/docker.sock wagoodman/dive:v0.13.1@sha256:f1886e6c32c094fc41a623c1989f5cb3e48aa766da5f0be233f911fc1d85ce10 mi-imagen:antes
```

Con las flechas se elige una capa a la izquierda y a la derecha se ve su sistema de archivos (Tab cambia de panel; Ctrl+C sale). Busquen: código fuente, dependencias de desarrollo (TypeScript, compiladores, Maven), cachés (`/root/.npm`, `~/.m2`), archivos `.env`, la carpeta `.git`, pruebas.

Para obtener el resumen sin la interfaz (útil para copiar al entregable):

```
docker run --rm -e CI=true -v /var/run/docker.sock:/var/run/docker.sock wagoodman/dive:v0.13.1@sha256:f1886e6c32c094fc41a623c1989f5cb3e48aa766da5f0be233f911fc1d85ce10 mi-imagen:antes
```

Anoten **Image efficiency score** y **Potential wasted space**.

### A3. ¿Con qué usuario corre?

```
docker image inspect mi-imagen:antes --format "{{.Config.User}}"
docker run --rm --entrypoint id mi-imagen:antes
```

Si la primera línea sale vacía y la segunda dice `uid=0(root)`, el servicio corre como **root**. (Si la imagen no tiene `id` porque no trae shell, como las distroless, basta con la primera línea: vacío o `0` es root.)

### A4. Vulnerabilidades conocidas (CVE)

Con **Trivy** 0.76.1 (versión fijada; ver el aviso de arriba). La primera vez descarga su base de datos de vulnerabilidades (unos minutos); el volumen `trivy-cache` la guarda para las siguientes:

```
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c image --scanners vuln mi-imagen:antes
```

Al final de cada sección dice `Total: N (UNKNOWN: …, LOW: …, MEDIUM: …, HIGH: …, CRITICAL: …)`. Anoten los totales y, aparte, cuántas **HIGH** y **CRITICAL** hay. Para ver solo esas:

```
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v trivy-cache:/root/.cache aquasec/trivy:0.76.1@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c image --scanners vuln --severity HIGH,CRITICAL mi-imagen:antes
```

Alternativa: **Docker Scout** (viene con Docker Desktop; pide iniciar sesión con una cuenta gratuita de Docker Hub: `docker login`):

```
docker scout quickview mi-imagen:antes
```

Usen **la misma herramienta** para el antes y el después: Trivy y Scout no cuentan igual (la demo lo muestra en [K2](../demo-docker/results/K2_BASES.md)).

Fíjense de dónde vienen las CVE: de los paquetes del **sistema operativo** de la imagen base o de sus **dependencias** (npm, Maven). Cambiar la base solo arregla las primeras; las segundas se arreglan actualizando la dependencia.

### A5. Revisar el Dockerfile con hadolint

hadolint 2.15.1 lee el Dockerfile por la entrada estándar. En **macOS, Linux o Git Bash**:

```
docker run --rm -i hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d < Dockerfile
```

En **PowerShell** (no admite `<`):

```
Get-Content Dockerfile | docker run --rm -i hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d
```

Cada aviso trae un código (`DL3008`, `DL3059`…) que se busca en la documentación de hadolint. Ojo: hadolint revisa la **forma** del Dockerfile, no todo. En la demo no avisó que la imagen corría como root ni que usaba una etiqueta flotante ([K7](../demo-docker/results/K7_IA.md)); por eso los pasos A2 a A4 también cuentan.

### A6. Adelgazar y corregir

Elijan lo que aplique a su servicio (no tienen que hacer todo) y anoten cada cambio:

1. **`.dockerignore`** junto al contexto de build, con al menos `node_modules`, `dist` o `target`, `.git`, `.env` y `.env.*`.
2. **Multi-stage**: una etapa compila (con todas las dependencias) y la etapa final solo copia lo que se ejecuta.
   - Node/NestJS: etapa final con `npm ci --omit=dev` (o copiar `node_modules` de una etapa que lo hizo) y `dist/`. Modelo: [`demo-docker/despues/Dockerfile`](../demo-docker/despues/Dockerfile).
   - Java/Spring Boot: compilar con la imagen JDK y Maven; la etapa final sobre una imagen **JRE**, con el jar separado en capas. Modelo (no medido): [`demo-docker/despues/spring/Dockerfile`](../demo-docker/despues/spring/Dockerfile).
3. **Orden de las capas**: primero los archivos de dependencias (`package.json` y `package-lock.json`, o `pom.xml`), instalar, y después copiar el código. Así un cambio de código no reinstala todo.
4. **Imagen base más chica**, con **etiqueta exacta y digest** (`FROM node:24.22.1-bookworm-slim@sha256:...`; el digest sale de `docker image inspect --format "{{index .RepoDigests 0}}" <imagen>`). Opciones: `-slim`, `-alpine` (usa musl: cuidado con dependencias nativas), distroless o Docker Hardened Images (`dhi.io`, gratuitas con cuenta de Docker; sin shell).
5. **Usuario no root**: `USER node` en las imágenes oficiales de Node, o crear uno (`useradd`) en otras. No usen `--chown` sobre el código salvo que el proceso realmente necesite escribir ahí.
6. **Secretos fuera de la imagen**: nada de `ARG` ni `COPY .env` con claves; para un token que se necesita al construir, `RUN --mount=type=secret,...` (la demo lo muestra en [K4](../demo-docker/results/K4_SECRETOS.md)).

Reconstruyan y etiqueten la nueva versión:

```
docker compose build api
docker tag MI_IMAGEN mi-imagen:despues
```

### A7. Medir otra vez y comprobar que sigue funcionando

Repitan A2, A3 y A4 con `mi-imagen:despues`. Después levanten el stack y prueben un endpoint real:

```
docker compose up -d --wait
docker compose ps
```

y una petición a su API (navegador, `curl` o el cliente que usen). Una imagen más chica que no arranca no sirve: anoten si funcionó a la primera o qué tuvieron que arreglar (lo típico: un archivo que faltó copiar a la etapa final, un healthcheck que usaba `curl` en una imagen que ya no lo trae, permisos de una carpeta en la que la app escribe).

Para terminar, completen la tabla de la plantilla.

---

## Opción B: el mismo stack con Podman

Objetivo: levantar su `compose.yaml` **sin Docker**, con Podman en modo *rootless* (sin privilegios de administrador), anotar qué tuvieron que cambiar y comparar con Docker.

Dos palabras primero:

- **Podman** es un motor de contenedores compatible con Docker (mismas imágenes, casi los mismos comandos: `podman run`, `podman ps`, `podman build`). No usa un demonio central que corre como root.
- **Rootless** significa que los contenedores corren con **su usuario** de la máquina, no como root: el «root» de dentro del contenedor se traduce a su usuario de fuera. Si alguien escapa del contenedor, no es administrador de la máquina.

### B1. Instalar Podman

**Windows 11** (Podman 6, línea de comandos):

```
winget install --id Podman.CLI --source winget
```

**Windows 10** (Podman 5.8; la 6 ya no funciona ahí):

```
winget install --id RedHat.Podman --source winget
```

En los dos casos cierren y vuelvan a abrir la terminal (winget agrega Podman al PATH, y las terminales ya abiertas no lo ven). Podman en Windows usa WSL2, igual que Docker Desktop.

**macOS con Apple Silicon** (M1 a M4):

```
brew install podman
```

**macOS con Intel**: Podman 6 no corre. Descarguen el instalador `.pkg` de **Podman 5.8** desde https://github.com/containers/podman/releases (busquen la última versión 5.8.x). `[por verificar: si Homebrew todavía instala una 5.8 en Intel]`

**Linux** (Fedora, Debian, Ubuntu…):

```
sudo dnf install podman      # Fedora
sudo apt install podman      # Debian / Ubuntu
```

Las distribuciones con soporte largo traen versiones más viejas de Podman. Comprueben la versión en el paso siguiente; `podman compose` necesita una versión reciente `[por verificar: versión mínima]`.

Comprobar:

```
podman --version
```

### B2. Crear y arrancar la máquina (solo Windows y macOS)

En Windows y macOS los contenedores corren dentro de una pequeña máquina virtual Linux que maneja Podman:

```
podman machine init
podman machine start
podman info
```

En Linux no hace falta: Podman corre directamente.

### B3. Comprobar que está en modo rootless

```
podman info --format "{{.Host.Security.Rootless}}"
```

Debe decir `true`. (En Windows y macOS, `podman machine init` crea la máquina en modo rootless por defecto; si alguien la creó con `--rootful`, dirá `false`.)

### B4. ¿Qué ejecuta `podman compose`?

`podman compose` no es un Compose propio: es un **envoltorio** que busca un programa de Compose instalado y lo ejecuta contra Podman. Si encuentra `docker-compose` (por ejemplo, porque tienen Docker Desktop), usa ese; si no, usa `podman-compose` (un proyecto aparte, en Python). Para ver cuál usa:

```
podman compose version
```

La primera línea dice qué proveedor ejecutó. Si quieren forzar uno, definan la variable `PODMAN_COMPOSE_PROVIDER` con la ruta o el nombre del programa. Para instalar `podman-compose`:

```
pip install podman-compose
```

Anoten en el entregable **cuál** usaron: no se comportan igual (por ejemplo, el soporte de `depends_on` con `condition:` y de `develop.watch` cambia entre uno y otro `[por verificar con su versión]`).

### B5. Ajustar el `compose.yaml` si hace falta

Hagan una copia para no romper el que usan con Docker (por ejemplo `compose.podman.yaml`) solo si necesitan cambiar algo. Lo que suele fallar:

- **Nombres cortos de imagen.** Podman no supone Docker Hub: `postgres:17` puede preguntar de qué registro bajarla o fallar. Usen el nombre completo: `docker.io/library/postgres:17.11`, `docker.io/library/node:24-slim`, `docker.io/rabbitmq:4.4-management`… También en los `FROM` de sus Dockerfiles.
- **Puertos menores a 1024.** En rootless no se pueden publicar (`80:80` falla). Usen puertos altos (`8080:80`).
- **Volúmenes montados desde una carpeta** (*bind mounts*): en Linux con SELinux (Fedora) agreguen `:Z` al final (`./datos:/datos:Z`). Y como el root del contenedor es su usuario, un proceso que corre con otro uid dentro del contenedor puede no tener permiso de escribir en la carpeta.
- **`host.docker.internal`** (llegar a la máquina desde un contenedor) en Podman es `host.containers.internal`.
- **Healthchecks**: Podman los ejecuta, pero solo si están en el `compose.yaml` (o si la imagen se construyó en formato Docker). Si dependen de `HEALTHCHECK` del Dockerfile, muévanlos al `compose.yaml`.

La demo del docente ya está preparada para Podman: [`demo-docker/despues/compose.yaml`](../demo-docker/despues/compose.yaml) usa nombres completos, puertos altos y healthchecks en el propio archivo.

### B6. Levantar el stack

Desde la carpeta del proyecto:

```
podman compose up -d
podman compose ps
podman compose logs
```

(Con una copia: `podman compose -f compose.podman.yaml up -d`.) Prueben el mismo endpoint que con Docker.

Para ver el efecto de rootless, elijan un contenedor (`podman ps` da el nombre) y comparen el usuario de dentro con el de fuera:

```
podman top NOMBRE_CONTENEDOR user huser pid args
```

`USER` es el usuario dentro del contenedor y `HUSER` el usuario real en la máquina (o en la máquina virtual de Podman). Con rootless, un `root` de dentro aparece como su usuario (o un uid alto) fuera.

### B7. Comparar con Docker

Con el mismo `compose.yaml`, anoten para Docker y para Podman:

- ¿Levantó a la primera? ¿Qué tuvieron que cambiar?
- Tiempo de `up -d` desde cero (sin imágenes construidas ni volúmenes), medido con el reloj o con `Measure-Command { podman compose up -d }` en PowerShell o `time podman compose up -d` en macOS/Linux. Es solo una referencia: una corrida, la misma máquina.
- Usuario dentro y fuera de un contenedor (B6; con Docker: `docker top NOMBRE`, columna `UID`).

### B8. Bajar todo

```
podman compose down -v
podman machine stop          # solo Windows y macOS
```

---

## Plantilla del entregable: `docs/laboratorios/imagen-o-podman.md`

Copien esto en su repositorio y complétenlo. Si en el grupo hubo quienes hicieron A y quienes hicieron B, usen una sección por persona o por opción.

```markdown
# Laboratorio S08: imagen o Podman

- Integrante(s):
- Opción: A (auditar y adelgazar la imagen) / B (stack con Podman)
- Servicio o stack:
- Fecha:
- Máquina: sistema operativo, Docker Desktop/Engine (versión), Podman (versión, si B)

## Opción A: antes y después

Imagen: `...` (Dockerfile: `ruta/al/Dockerfile`)

| Medida | Antes | Después | Comando con el que se midió |
|---|---:|---:|---|
| Tamaño en disco (DISK USAGE) | | | `docker image ls` |
| Tamaño comprimido (CONTENT SIZE) | | | `docker image ls` |
| Número de capas | | | `docker image history` |
| Eficiencia y espacio desperdiciado (Dive) | | | `dive` con `CI=true` |
| Usuario con el que corre | | | `docker run --rm --entrypoint id ...` |
| CVE totales (herramienta: Trivy / Scout) | | | |
| CVE HIGH + CRITICAL | | | |
| Avisos de hadolint | | | `hadolint` |
| ¿Arranca y responde? | | | endpoint probado: |

### Qué encontré en la imagen de antes
(Capas grandes y por qué, archivos que no debían estar, usuario, de dónde vienen las CVE.)

### Qué cambié
(Cada cambio en una línea y el porqué. Pueden pegar el diff del Dockerfile.)

### Qué no pude resolver o no me convenció
(Por ejemplo, CVE que siguen porque vienen de una dependencia; una base más chica que no funcionó.)

## Opción B: Podman

- Podman: versión `...`, modo rootless: `true/false` (`podman info --format "{{.Host.Security.Rootless}}"`)
- Proveedor de `podman compose`: `docker-compose` / `podman-compose` (salida de `podman compose version`)

| | Docker | Podman |
|---|---|---|
| ¿Levantó a la primera? | | |
| Cambios necesarios en `compose.yaml` o Dockerfiles | | |
| Tiempo de `up -d` desde cero (una corrida) | | |
| Usuario dentro / fuera de un contenedor | | |
| ¿El endpoint responde? | | |

### Problemas y cómo los resolví
(Error exacto, causa, cambio.)

### Comparación
(Qué ganan y qué pierden con Podman en su proyecto, en pocas líneas.)

## Comandos usados
(Los comandos tal como los ejecutaron, en orden.)
```
