# Escenario K2 (no es antes/despues): la misma API sobre cinco imagenes base distintas.
# docker build --target slim -f bases/Dockerfile api
# Las etapas de build son las de la referencia (sobre slim); solo cambia la
# etapa final. Se elige con --target: node | slim | alpine | distroless | dhi.
# Las dependencias son JavaScript puro (pg, Nest), asi que node_modules
# compilado sobre Debian tambien sirve en Alpine (musl). Con modulos nativos
# habria que instalar dentro de cada base.

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Debian 12 completo (con compiladores, git, python...)
FROM node:24.22.1-bookworm@sha256:6449e19d8184d84062525b6a7524def03146c2cb04a7f08b076680d0e8e4240a AS node
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/main.js"]

# Debian 12 recortado
FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/main.js"]

# Alpine 3.24 (musl en lugar de glibc)
FROM node:24.22.1-alpine3.24@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
CMD ["node", "dist/main.js"]

# Distroless de Google (Debian 13): sin shell ni gestor de paquetes.
# El ENTRYPOINT ya es node, por eso CMD lleva solo el script.
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:cb606325b7ec4af55462cb0b424a53b452a5b4a894ffe841fcf1048d216fb9f8 AS distroless
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
CMD ["dist/main.js"]

# Docker Hardened Image (Debian, sin shell; uid 1000 por defecto).
# Se baja de dhi.io con "docker login dhi.io" (cuenta gratuita de Docker).
FROM dhi.io/node:24.22.1@sha256:c2dc799f9e47eb25fc032db1801b028219da31e6081369ab5d9bdddc0faa61fc AS dhi
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
CMD ["node", "dist/main.js"]
