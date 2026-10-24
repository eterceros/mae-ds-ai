# DESPUES (escenarios K1 y K3): Dockerfile de referencia de la API, multi-stage.
# Es el que usa despues/compose.yaml. Version sin corregir: antes/Dockerfile.
# Se construye con el contexto en api/:  docker build -f despues/Dockerfile api
# (usa api/.dockerignore, que deja fuera node_modules, dist y .env).

# CORRECCIÓN: base "slim" (Debian recortado) en lugar de node:24 completo, fijada
# por etiqueta exacta Y digest: el build no cambia si alguien vuelve a publicar
# la etiqueta. Con el registro completo (docker.io/library/...) para que Podman
# no tenga que adivinar de dónde bajarla. Tamaño y CVE de cada base: K2.
# 1) Todas las dependencias (las de desarrollo hacen falta para compilar)
FROM docker.io/library/node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS deps
WORKDIR /app
# CORRECCIÓN: primero package*.json y npm ci, despues el codigo. Un cambio en
# src/ ya no invalida la capa de dependencias: sale de la cache (K1: 2,4 s en
# lugar de 9,4 s). npm ci instala exactamente lo del package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# 2) Compilar TypeScript -> dist/
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# 3) Solo dependencias de produccion
FROM docker.io/library/node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# 4) Imagen final
# CORRECCIÓN: multi-stage. La imagen final solo copia dist/ y las dependencias
# de produccion; TypeScript, @nestjs/cli, src/ y la cache de npm se quedan en
# las etapas de build (K1: 357 MB en lugar de 1,74 GB).
FROM docker.io/library/node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS runtime
ENV NODE_ENV=production
WORKDIR /app
# CORRECCIÓN: se copia sin --chown. Los archivos quedan de root y el proceso
# corre como node: puede leerlos pero no reescribir su propio codigo (K3).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY migrations ./migrations
# CORRECCIÓN: usuario sin privilegios (uid 1000 de la imagen oficial). Si alguien
# toma el proceso, no es root: 0 capacidades en lugar de 14 (K3).
USER node
EXPOSE 3000
# CORRECCIÓN: node directo en forma exec (JSON): es el PID 1 y recibe SIGTERM
# sin npm ni sh en el medio (S02).
CMD ["node", "dist/main.js"]
