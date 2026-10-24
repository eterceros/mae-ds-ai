# Una sola imagen para A y B (cambia el comando). Node 24 ejecuta TypeScript sin compilar
# (quita los tipos al cargar), por eso no hay etapa de build.
FROM node:24.22.1-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER node
CMD ["node", "src/a.ts"]
