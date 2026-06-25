# syntax=docker/dockerfile:1

# ============================================================
# Imagem única: frontend + backend num só processo/porta.
# O backend (Express) serve o build do React e expõe /api.
# ============================================================

# ---- Build: instala tudo e compila o frontend ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build   # vite build -> dist/

# ---- Runtime: só deps de produção + fonte do server + build ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# O server roda via tsx (dependência), então precisa do código-fonte dele.
COPY --from=build /app/dist ./dist
COPY src/server ./src/server
COPY migrations ./migrations
COPY tsconfig.json ./

EXPOSE 4000
CMD ["npm", "start"]   # tsx src/server/index.ts (serve dist/ + /api)
