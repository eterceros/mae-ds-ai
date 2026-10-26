# Imagen única para api, worker y precios (antes y despues). NestJS necesita decoradores, que Node no
# ejecuta al quitar tipos, así que aquí sí hay un paso de compilación (tsc -> dist/).
# Para Dockerfiles de producción (no root, digest, multi-stage completo) ver demo-docker (K1-K4).
FROM node:24.22.1-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc -p .

FROM node:24.22.1-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# Las dependencias de OpenTelemetry van en la imagen, pero solo se cargan si NODE_OPTIONS lo pide.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/despues/api.js"]
