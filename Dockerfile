# Servidor de CertiSend en Cloud Run (2026-10-05). Los secretos NO van aqui ni en variables
# en claro: Cloud Run los monta desde Secret Manager (--set-secrets).
#
# GRAVE 2 (correccion vuelta 33, 2026-10-06): esta imagen solo corre el SERVIDOR (/api/**) — el
# frontend (SPA) lo sirve Firebase Hosting por su cuenta (firebase.json: "**" -> /index.html,
# "/api/**" -> este servicio de Cloud Run), nunca Cloud Run. Antes el build corria "npm run build"
# completo (vite build + esbuild): vite build en modo produccion EXIGE las 4 variables
# VITE_PROVEEDOR_* (ver vite.config.ts, GRAVE 3(b) de la vuelta 31) y ademas compilaba un
# frontend que esta imagen nunca sirve — sin esas variables en el entorno de build de Cloud Build,
# la imagen ya no se construia. "npm run build:server" compila SOLO server.ts (el mismo esbuild
# de siempre), sin tocar Vite ni exigir ninguna variable del proveedor.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:server

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.cjs"]
