# K8. El mismo stack con Podman (rootless)

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0.
Podman 5.8.3 (cliente Windows) contra el servidor 5.8.9 de la máquina `podman-machine-default` (fedora 44, kernel 6.18.54.1-microsoft-standard-WSL2, WSL2; la máquina declara 10 CPU y 2048 MiB, pero WSL2 la deja ver 20 CPU y 31 GB), **rootless: true**, máquina con `Rootful: false`, runtime crun, red netavark + pasta, almacenamiento overlay.
Referencia con Docker: Engine 29.9.2, Compose 5.6.0, buildx v0.38.1 (Docker Desktop corriendo a la vez, con otras demos).

Qué se probó: el [`despues/Dockerfile`](../despues/Dockerfile) y el [`despues/compose.yaml`](../despues/compose.yaml) **tal cual**, con Podman en modo *rootless* (los contenedores los lanza un usuario común de la máquina de Podman; no hay un demonio con privilegios). `podman compose` no es un Compose propio: es un envoltorio que llama a un **proveedor** externo. Se midieron los dos: **docker-compose** (Docker Compose version v5.6.0; ejecutable `C:\Users\edson\AppData\Local\Programs\DockerDesktop\resources\bin\docker-compose.exe`) y **podman-compose** (podman version 5.8.3 / podman-compose version 1.6.0; corrido con `uvx --from podman-compose==1.6.0`; ejecutable `C:\Users\edson\src\umss\mae-ds-ai\m8\demo-docker\.tmp\k8\podman-compose.cmd`).

Para que conviva con la demo de Docker en la misma máquina, el script usa una copia del compose en `.tmp/k8/` con estos cambios (ninguno lo pide Podman):

- `name: s08-docker` → `name: s08-podman`
- `"127.0.0.1:18132:5432"` → `"127.0.0.1:18151:5432"`
- `"127.0.0.1:18100:3000"` → `"127.0.0.1:18150:3000"`
- `image: s08-docker/api:local` → `image: s08-podman/api:local`
- `context: ../api` → `context: ../../api`

Comando: `npm run k8` (≈ 5 min).

## 1. Build: ¿la misma imagen?

| | Podman (`podman build`, Buildah) | Docker (BuildKit) |
|---|---|---|
| Construye sin cambios en el Dockerfile | sí | sí |
| Tamaño sin comprimir | 249.2 MB | 249.2 MB (capas de `docker save` descomprimidas) |
| Tamaño comprimido (gzip) | ≈ 87.3 MB (`podman save --format docker-dir --compress`) | 83,4 MB (K1, `docker image ls`) |
| Capas | 9 | 10 |
| Las 5 capas de la base, idénticas (mismo digest) | sí | |
| Usuario / comando | `node` / `["node","dist/main.js"]` | `node` / el mismo |
| Formato del manifiesto | `application/vnd.oci.image.manifest.v1+json` | OCI |
| Build en frío (`--no-cache`, bases ya descargadas), mediana de 3 | 18.7 (18.5–18.9) s; con `--jobs 3`: 11.7 (10.9–12.1) s | 7.0 (6.9–7.6) s |

Nota sobre el tamaño: con el almacén containerd, `docker image ls` informa 357 MB «en disco» (K1), que suma las capas descomprimidas **y** los blobs comprimidos. La fila «sin comprimir» compara lo mismo en los dos motores. Las capas de la base son idénticas; las de la aplicación tienen otro digest en cada motor (fechas de los archivos, y BuildKit guarda el `WORKDIR` como una capa propia de 1,5 KB). No se comparó el contenido archivo por archivo.

## 2. `podman compose up`: 3 corridas por proveedor, volumen vacío

Tiempo desde que se lanza `podman compose up -d` (o `docker compose up -d`) hasta el primer `200` de `GET /salud`, en segundos (mediana y rango). Imagen ya construida y bases ya descargadas.

| Comando → proveedor | `/salud` respondió | s hasta `/salud` | Orden postgres sano → migrate → api | Veces que arrancó `migrate` | Filas en `/items` | Código de `up` |
|---|---|---:|---|---|---|---|
| `podman compose` → docker-compose | 3 de 3 | 4.0 (4.0–4.8) | 3 de 3 | 1 | 3 | 0 |
| `podman compose` → podman-compose | 3 de 3 | 9.6 (9.5–9.9) | 3 de 3 | 2 | 3 | 0 |
| `docker compose` (referencia) | 3 de 3 | 3.4 (3.4–3.5) | — | — | — | — |

Línea de tiempo (s desde que se lanzó `up`, según `podman events`; mediana y rango):

| Proveedor | Postgres arranca | Postgres sano | `migrate` arranca | `migrate` termina | `api` arranca | `/salud` responde |
|---|---:|---:|---:|---:|---:|---:|
| docker-compose | 1.0 (0.9–1.0) | 2.8 (2.8–2.9) | 3.1 (3.0–3.1) | 3.2 (3.1–3.2) | 3.7 (3.7–3.8) | 4.0 (4.0–4.8) |
| podman-compose | 5.9 (5.8–6.0) | 7.5 (7.4–7.8) | 7.9 (7.9–8.2) | 8.0 (8.0–8.3) | 9.0 (8.9–9.3) | 9.6 (9.5–9.9) |

## 3. Migración rota (el caso de falla de K6)

Con [`compose.migracion-con-error.yaml`](../despues/compose.migracion-con-error.yaml) encima (una segunda migración que falla).

| Proveedor | Código de `up -d` | `migrate` | `api` | `/salud` responde |
|---|---|---|---|---|
| docker-compose | 1 | exited (código 1) | created, nunca arrancó | no |
| podman-compose | 0 | exited (código 1) | running, **arrancó** | **sí** |

Salida de `up` con docker-compose:

```
 Container s08-podman-migrate-1 Waiting 
 Container s08-podman-migrate-1 Error service "migrate" didn't complete successfully: exit 1
service "migrate" didn't complete successfully: exit 1
Error: executing C:\Users\edson\AppData\Local\Programs\DockerDesktop\resources\bin\docker-compose.exe -f C:\Users\edson\src\umss\mae-ds-ai\m8\demo-docker\.tmp\k8\compose.yaml -f C:\Users\edson\src\umss\mae-ds-ai\m8\demo-docker\.tmp\k8\compose.migracion-con-error.yaml -p s08-podman up -d: exit status 1
```

Salida de `up` con podman-compose:

```
s08-podman_migrate_1
```

## 4. Usuario: dentro del contenedor y en la máquina

```
$ podman exec <api> id
uid=1000(node) gid=1000(node) groups=1000(node)
$ podman exec <postgres> id
uid=0(root) gid=0(root) groups=0(root)
$ podman top <api> user huser args
USER        HUSER       COMMAND
node        525287      node dist/main.js
$ podman top <postgres> user huser args
USER        HUSER       COMMAND
postgres    525286      postgres
```

- Capacidades efectivas del proceso de la API: `0000000000000000`; ¿puede reescribir `/app/dist/main.js`? no; ¿y `/etc/passwd`? no (lo mismo que K3 con Docker).
- `HUSER` es el usuario **en la máquina de Podman**: el uid 1000 del contenedor es otro uid alto en la VM, y el root de dentro del contenedor de Postgres (el `id` de `exec`) es el usuario común que lanzó Podman, no el root de la VM.

En la máquina de Podman (`podman machine ssh`):

```
uid=1000(user) gid=1000(user) groups=1000(user),10(wheel)

user:524288:65536

# procesos (cuantos, usuario, programa):
      7 525286   postgres
     12 user     conmon
      1 user     podman
```

## Por qué

- **Misma imagen**: Podman construye con Buildah y lee el mismo Dockerfile; como `despues/Dockerfile` nombra las bases con el registro completo (`docker.io/library/...`), no hay que configurar registros de búsqueda para nombres cortos. El resultado es una imagen OCI que cualquiera de los dos motores puede correr.
- **Rootless de verdad**: no hay un demonio con privilegios. Cada contenedor lo arranca `conmon` con el usuario común de la VM, y los uid del contenedor se traducen con `/etc/subuid` (*user namespace*): el root de dentro no es root fuera. Con Docker Desktop, el demonio corre como root en su VM; el `USER node` de K3 protege dentro del contenedor, rootless protege también fuera.
- **`podman compose` es un envoltorio**: con Docker Desktop instalado, `podman compose` encuentra el `docker-compose` de Docker Desktop y lo apunta al socket de Podman (la API compatible con Docker). Es el mismo programa que `docker compose`, por eso respeta `depends_on: condition` igual. **podman-compose** es otro programa (Python) que traduce el YAML a comandos `podman`, y ahí aparecen dos diferencias:
  - **`service_completed_successfully` no mira el código de salida.** podman-compose 1.6.0 lo traduce a `podman wait --condition=stopped` (en su código: `"service_completed_successfully": ServiceDependencyCondition.STOPPED`): espera a que `migrate` **termine**, sin importar si terminó bien. Con la migración rota, la API arrancó y respondió `/salud` sobre un esquema que no es el que espera (la `002` falló y se deshizo), y `up -d` salió con 0. Se pierde justo la protección que K6 mostró con Docker. `service_healthy` sí se respeta (`podman wait --condition=healthy`).
  - **`migrate` corre dos veces.** podman-compose crea la API con `--requires=postgres,migrate`, y al arrancar la API Podman vuelve a arrancar sus dependencias que no están corriendo: `migrate` ya había terminado, así que corre otra vez. Aquí no rompe nada porque el aplicador es idempotente (K6); un *job* que no lo sea se ejecutaría dos veces.
- **Build más lento con Podman**: Buildah corre las etapas del multi-stage **una tras otra** salvo que se le pase `--jobs`; BuildKit corre a la vez las que no dependen entre sí (`deps` y `prod-deps` instalan dependencias en paralelo, K1). Con `--jobs 3` la diferencia baja a la mitad; el resto no se perfiló `[por verificar]` (por ejemplo, el contexto viaja a la VM por la conexión de `podman machine`).
- **Arranque más lento con podman-compose**: Postgres recién arranca a los ~6 s porque podman-compose crea la red, el volumen y cada contenedor con un `podman` aparte, uno tras otro, y cada llamada cruza la conexión con la máquina (más ~0,9 s de `uvx` en esta prueba). Con docker-compose, Postgres arranca a ~1 s, como con Docker.
- **Healthchecks en el compose, no en la imagen**: Podman construye en formato OCI, que no guarda `HEALTHCHECK`; como están en `compose.yaml`, funcionan igual con los dos proveedores (dentro de la máquina, Podman los programa con temporizadores de systemd `[por verificar]`).

## Qué no se midió

- **Podman nativo en Linux** ni **Podman Desktop**: solo Podman 5.8.3 en Windows con su máquina WSL2. En Linux no hay VM y los tiempos cambian. Tampoco Podman 6.x (`Podman.CLI` 6.1.4), que en esta máquina no se instaló.
- **Modo rootful** de la máquina (`podman machine set --rootful`): no se comparó.
- **podman-compose instalado de otra forma** (pip, paquete del sistema): se corrió con `uvx`, que agrega ~0,9 s a cada comando; el problema de `service_completed_successfully` está en el código de podman-compose 1.6.0, no en cómo se instala. Otras versiones `[por verificar]`.
- **Descarga de las bases** con Podman: las imágenes base ya estaban en la máquina; no se midió el primer `pull`.
- **`podman kube play`** y Quadlet (las formas «nativas» de Podman de levantar varios contenedores): fuera del alcance.
- **Si los healthchecks usan temporizadores de systemd** dentro de la máquina: no se inspeccionó `[por verificar]`.
- **Escape del contenedor**: no se probó. Que el uid de fuera sea un usuario común se vio con `podman top` y `ps`; el usuario de la VM (`user`) está en el grupo `wheel` y usa `sudo` sin clave en la VM (comprobado con `sudo -n true`), así que rootless protege del root del contenedor, no de quien ya entró a la VM.
- **Ciclo de desarrollo** (`develop.watch` de `compose.dev.yaml`) con Podman: no se probó.
