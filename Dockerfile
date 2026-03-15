# ---------- BUILD STAGE ----------
FROM node:24-alpine AS build

WORKDIR /app

ENV npm_config_disturl=https://nodejs.org/download/release

# Toolchain for node-rdkafka (only in build image)
RUN apk add --no-cache python3 make g++ bash openssl-dev

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json ./tsconfig.json
COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

# ---------- RUNTIME STAGE ----------
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache bash openssl

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN addgroup -S nodejs && adduser -S nodejs -G nodejs
USER nodejs

EXPOSE 3000

CMD ["node", "dist/server.js"]
