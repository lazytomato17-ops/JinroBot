FROM rust:1-bookworm AS native
WORKDIR /native
COPY april/tomatobot-core/Cargo.toml april/tomatobot-core/Cargo.lock april/tomatobot-core/build.rs ./
COPY april/tomatobot-core/src ./src
RUN cargo build --locked --release

FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY legacy/package.json legacy/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY april/tsconfig.json april/offline-smoke.cjs ./april/
COPY april/src ./april/src
COPY april/tomatobot-core/index.js april/tomatobot-core/index.d.ts ./april/tomatobot-core/
COPY src/ranking.ts ./src/ranking.ts
RUN npx --no-install tsc -p april/tsconfig.json
COPY --from=native /native/target/release/libtomatobot_core.so /app/april/dist/april/tomatobot-core/tomatobot-core.node
RUN cp april/tomatobot-core/index.js april/dist/april/tomatobot-core/ && node april/offline-smoke.cjs

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app
COPY legacy/package.json legacy/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/april/dist ./dist

EXPOSE 10000
CMD ["node", "dist/april/src/index.js"]
