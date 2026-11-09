FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY legacy/package.json legacy/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY legacy/tsconfig.json ./legacy/
COPY legacy/src ./legacy/src
COPY src/ranking.ts ./src/ranking.ts
RUN npx --no-install tsc -p legacy/tsconfig.json

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app
COPY legacy/package.json legacy/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/legacy/dist ./dist

EXPOSE 10000
CMD ["node", "dist/legacy/src/index.js"]
