# Imagen única para la API y el worker de E4 (Q7). Node 24 ejecuta TypeScript directamente
# (quita los tipos al cargar), así que no hay paso de compilación.
# Para Dockerfiles de producción (multi-stage, no root, digest) ver demo-docker (K1-K4).
FROM node:24.19.0-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
USER node
CMD ["node", "src/despues/llm-api.ts"]
