# Imagen mínima: Node 24 ejecuta server.mjs directamente; sin paquetes de npm.
FROM node:24.19.0-alpine
WORKDIR /app
COPY *.mjs ./
# Corre como el usuario sin privilegios "node" que ya trae la imagen base (uid 1000).
USER 1000
EXPOSE 3000
CMD ["node", "server.mjs"]
