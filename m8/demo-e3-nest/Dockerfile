# Una sola imagen para las dos formas: la API (dist/main.js) y el servicio de precios
# (dist/main-precios.js). Compose elige cuál arranca con "command".
# Multi-stage, como demo-docker/despues/Dockerfile (bloque 1 de la S08).
# Se construye desde esta carpeta:  docker compose build   (o docker build -t e3-nest/app:local .)

# Base slim fijada por etiqueta exacta Y digest: el build no cambia si alguien vuelve a
# publicar la etiqueta. Con el registro completo para que Podman no tenga que adivinar.
# 1) Todas las dependencias (las de desarrollo hacen falta para compilar)
FROM docker.io/library/node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS deps
WORKDIR /app
# Primero package*.json y npm ci, después el código: un cambio en src/ no invalida la capa de
# dependencias. npm ci instala exactamente lo del package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# 2) Compilar TypeScript -> dist/ (npm run build también corre el chequeo de frontera)
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# 3) Solo dependencias de producción
FROM docker.io/library/node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# 4) Imagen final: solo dist/ y las dependencias de producción (TypeScript, src/ y la caché
# de npm se quedan en las etapas anteriores).
FROM docker.io/library/node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Sin --chown: los archivos quedan de root y el proceso, que corre como node, puede leerlos
# pero no reescribir su propio código.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Usuario sin privilegios (uid 1000 de la imagen oficial).
USER node
EXPOSE 3000 3001
# node directo en forma exec: es el PID 1 y recibe SIGTERM sin npm ni sh en el medio.
CMD ["node", "dist/main.js"]
