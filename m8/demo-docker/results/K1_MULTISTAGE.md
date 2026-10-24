# K1. Imagen ingenua frente a multi-stage

Medido el 2026-10-24. Máquina: 12th Gen Intel(R) Core(TM) i9-12900H, 20 hilos lógicos, 64 GB de RAM, Windows_NT 10.0.26200, Node v24.19.0. Docker Engine 29.9.2 (Docker Desktop sobre WSL2, VM con 20 CPU y 31 GB, almacén de imágenes containerd), Compose 5.6.0, buildx v0.38.1.

La misma API NestJS (`api/`) con dos Dockerfiles: [`antes/Dockerfile`](../antes/Dockerfile) y [`despues/Dockerfile`](../despues/Dockerfile).
Contexto de build: una copia limpia de `api/` sin `node_modules` ni `dist`. 3 rondas; cada cifra es la mediana y, entre paréntesis, el rango.

- **Frío:** `docker build --no-cache` (no usa ninguna capa guardada; las imágenes base ya estaban descargadas, así que no cuenta la descarga de la base; sí cuenta bajar los paquetes de npm desde internet).
- **Sin cambios:** el mismo build otra vez (todas las capas salen de la caché).
- **Cambio en src/:** se agrega una línea de comentario a `src/main.ts` y se vuelve a construir.

| Variante | Tamaño en disco | Contenido (comprimido) | Capas | Frío (s) | Sin cambios (s) | Cambio en src/ (s) | ¿Reinstala dependencias al cambiar src/? |
|---|---:|---:|---:|---:|---:|---:|---|
| Ingenua (node:24, una etapa, COPY . . antes de npm install) | 1.74GB | 429MB | 12 | 8.7 (8.7–9.1) | 0.7 (0.6–0.9) | 9.4 (8.6–9.7) | sí, en las 3 rondas |
| Multi-stage de referencia (slim, package*.json primero) | 357MB | 83.4MB | 10 | 8.2 (7.3–8.4) | 0.7 (0.7–0.8) | 2.4 (2.1–2.6) | no |

Qué hay dentro de cada imagen final:

| Variante | Paquetes en node_modules | node_modules (MB) | typescript | @nestjs/cli | src/ (TypeScript) | caché de npm en /root/.npm (MB) | Usuario configurado |
|---|---:|---:|---|---|---|---:|---|
| ingenuo | 166 | 65 | sí | sí | sí | 14 | root (sin USER) |
| multistage | 102 | 24 | no | no | no | 0 | node |

Capas más recientes de la imagen ingenua (`docker image history`, tamaño y comando):

```
      0B  CMD ["npm" "run" "start"]
      0B  EXPOSE [3000/tcp]
  1.43MB  RUN /bin/sh -c npm run build # buildkit
  84.5MB  RUN /bin/sh -c npm install # buildkit
   201kB  COPY . . # buildkit
  8.19kB  WORKDIR /app
```

Capas de la imagen multi-stage (todas estas son propias; debajo están las de la base slim):

```
      0B  CMD ["node" "dist/main.js"]
      0B  EXPOSE [3000/tcp]
      0B  USER node
  16.4kB  COPY migrations ./migrations # buildkit
  12.3kB  COPY package.json ./ # buildkit
  36.9kB  COPY /app/dist ./dist # buildkit
  24.5MB  COPY /app/node_modules ./node_modules # buil…
```

## Por qué

- **Tamaño.** La ingenua parte de `node:24` (Debian completo con compiladores, Python, git: 1.65GB en disco) y conserva todo lo que usó para compilar: dependencias de desarrollo, TypeScript, el código fuente y la caché de npm. La multi-stage compila en una etapa y copia a la final solo `dist/` y las dependencias de producción, sobre `node:24-slim` (333MB).
- **Caché.** Docker reutiliza una capa si la instrucción y los archivos que copia no cambiaron, y a partir de la primera capa que cambia reconstruye todo lo que sigue. En la ingenua `COPY . .` va antes de `npm install`: tocar una línea de `src/` invalida esa copia y obliga a reinstalar todo. En la multi-stage se copian primero `package.json` y `package-lock.json`, se instala, y después se copia `src/`: un cambio de código solo repite la compilación.
- **Frío.** Sin caché las dos variantes descargan paquetes de npm; la multi-stage ejecuta `npm ci` dos veces (todas las dependencias para compilar y solo las de producción para la imagen final), en etapas que BuildKit corre en paralelo.
