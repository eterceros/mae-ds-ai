# Image of the example service. Build it from this folder:
#   docker build -t ejemplo-api:lab .
FROM docker.io/library/node:24.22.1-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server.mjs ./
# Unprivileged user from the official image (uid 1000).
USER node
EXPOSE 3000
# node directly in exec form: it is PID 1 and receives SIGTERM.
CMD ["node", "server.mjs"]
