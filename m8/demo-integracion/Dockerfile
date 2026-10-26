# Imagen para correr las mediciones de I2 DENTRO de la red de Compose (perfil "tools").
# Motivo: en Docker Desktop para Windows cada ida y vuelta del anfitrión a Postgres pasa por el reenvío de
# puertos (~1 ms, y llegó a 8 ms con la máquina cargada), y el importador ingenuo hace una por fila; dentro
# de la red de Compose la latencia es la de una red local. Node 24 ejecuta TypeScript directamente.
FROM node:24.19.0-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
# Los CSV se generan dentro de la imagen (misma semilla, mismo contenido): leerlos desde una carpeta
# montada del anfitrión Windows sería mucho más lento y mediría el disco compartido, no el importador.
RUN node --no-warnings scripts/gen-csv.ts 50000 42 && node --no-warnings scripts/gen-csv.ts 500000 42 && chown -R node:node /app
USER node
CMD ["node", "--no-warnings", "scripts/i2-import.ts"]
