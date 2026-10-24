# ANTES (escenarios K1 y K3): el Dockerfile que se escribe en cinco minutos.
# Se construye con el contexto en api/:  docker build -f antes/Dockerfile api
# La version corregida es despues/Dockerfile; cada problema de aqui tiene su
# "# CORRECCIÓN:" alla. Resumen en DIFERENCIAS.md.
# Problemas a proposito:
# - Imagen base completa y etiqueta flotante (node:24 cambia con cada parche).
# - COPY . . antes de instalar: cualquier cambio en el codigo invalida la capa
#   de npm install y se reinstala todo.
# - Sin .dockerignore (antes/Dockerfile.dockerignore esta vacio): todo el
#   contexto viaja a la imagen.
# - Una sola etapa: quedan TypeScript, @nestjs/cli, src/ y la cache de npm.
# - Sin USER: corre como root (K3), y arranca con "npm run" (npm queda como PID 1).
FROM node:24
WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
EXPOSE 3000
CMD ["npm", "run", "start"]
