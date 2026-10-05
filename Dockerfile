# Servidor de CertiSend en Cloud Run (2026-10-05). Los secretos NO van aqui ni en variables
# en claro: Cloud Run los monta desde Secret Manager (--set-secrets).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
