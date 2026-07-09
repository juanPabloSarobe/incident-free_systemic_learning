# Contexto de build: la raíz del repo (ver docker-compose.yml)
FROM node:22-slim

WORKDIR /app

COPY dashboard/package.json ./
RUN npm install --omit=dev

COPY dashboard/ ./
COPY db/schema.sql db/seed.sql ./sql/

EXPOSE 3000
CMD ["node", "server.js"]
