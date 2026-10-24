# K4. Secretos en la imagen

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1.

Dos Dockerfiles que necesitan un token para instalar dependencias desde un registro npm privado (ficticio: `npm.ejemplo.invalid`; npm lee `${NPM_TOKEN}` del entorno en [`api/npmrc.k4`](../api/npmrc.k4)), y un `.env` local con una clave. Los valores son falsos: token `npm_K4tokenFALSOdeDemo0123456789`, clave `PGPASSWORD=clave-falsa-K4-en-.env`.

- **Mal** ([`antes/Dockerfile.secreto`](../antes/Dockerfile.secreto)): `docker build --build-arg NPM_TOKEN=...`, y `COPY .env` seguido de `RUN rm .env`; sin `.dockerignore`.
- **Bien** ([`despues/Dockerfile.secreto`](../despues/Dockerfile.secreto)): `NPM_TOKEN=... docker build --secret id=npm_token,env=NPM_TOKEN` y `RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN npm ci ...`; el `.dockerignore` excluye `.env`.

Para buscar el secreto se exportó cada imagen con `docker save` (lo que recibe cualquiera que haga `docker pull`) y se recorrieron sus metadatos y todas sus capas.

| | ARG NPM_TOKEN + COPY .env (y luego rm) | RUN --mount=type=secret (sin .env en el contexto) |
|---|---|---|
| ¿El token aparece en `docker history --no-trunc`? | **sí** | no |
| ¿Aparece en `Config.Env` de la imagen? | no | no |
| ¿`/app/.env` existe en un contenedor nuevo? | no | no |
| Hallazgos al recorrer `docker save` | 3 | 0 |
| Avisos de BuildKit (`docker build --check`) | Check complete, 1 warning has been found!<br>WARNING: SecretsUsedInArgOrEnv - https://docs.docker.com/go/dockerfile/rule/secrets-used-in-arg-or-env/ | Check complete, no warnings found. |

Línea del historial de la imagen «mal» (es lo que ve cualquiera con `docker history --no-trunc`):

```
RUN |1 NPM_TOKEN=npm_K4tokenFALSOdeDemo0123456789 /bin/sh -c echo "configuracion leida" && rm .env # buildkit
```

Lo encontrado dentro de la imagen «mal» al recorrer sus capas:

- metadatos b7294ff8f852e6858cc, `(configuración/historial de la imagen)`: contiene el token
- capa 4589468ccecbdd597a3, `app/.env`: 

  ```
  # archivo de configuracion local (falso, demo K4)
  PGPASSWORD=clave-falsa-K4-en-.env
  ```
- capa 4eaf80a7bb4c0e00231, `app/.wh..env`: (marca de borrado: "rm .env" solo lo oculta en las capas de arriba)

Imagen «bien»: ningún rastro del token ni de la clave en metadatos ni capas.

En tiempo de ejecución pasa algo parecido con las variables de entorno: `docker run -e PGPASSWORD=...` deja la clave en la configuración del contenedor, y `docker inspect` la muestra a quien tenga acceso al demonio:

```
["PGPASSWORD=clave-falsa-K4-en-runtime","PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","NODE_VERSION=24.22.1","YARN_VERSION=1.22.22"]
```

## Por qué

- **`ARG` no es secreto.** BuildKit guarda en el historial de la imagen cada `RUN` con los valores de los `ARG` que usa (`|1 NPM_TOKEN=...`), para que el build sea reproducible. El historial viaja con la imagen.
- **Borrar en otra capa no borra.** Cada instrucción agrega una capa encima de las anteriores; `RUN rm .env` agrega una marca de borrado (un archivo `.wh..env`) que oculta el archivo en el sistema de archivos del contenedor, pero la capa del `COPY` sigue dentro de la imagen con el archivo completo.
- **`--mount=type=secret`** monta el secreto solo mientras corre ese `RUN` (como archivo en `/run/secrets/` o, con `env=`, como variable de entorno del comando). No forma parte de ninguna capa ni del historial, y la caché no depende de su valor.
- **El `.dockerignore`** es la primera barrera: lo que no entra al contexto de build no puede terminar en la imagen.
- **En ejecución**, las claves llegan al contenedor desde fuera (Compose, el orquestador o un gestor de secretos), nunca dentro de la imagen; montarlas como archivo (`secrets:` de Compose, `POSTGRES_PASSWORD_FILE`) evita que aparezcan en `docker inspect`.
