FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN npm install -g pnpm@12.23.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html registry.json tsconfig.json vite.config.ts ./
COPY app ./app
COPY packages ./packages
COPY worlds ./worlds
COPY scripts ./scripts

RUN pnpm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN npm install -g pnpm@12.23.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json registry.json ./
COPY packages/server ./packages/server
COPY packages/core/src/types.ts ./packages/core/src/types.ts
COPY packages/core/src/portal/handoff.ts ./packages/core/src/portal/handoff.ts
COPY packages/core/src/portal/roomLayout.ts ./packages/core/src/portal/roomLayout.ts
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 8080
CMD ["./node_modules/.bin/tsx", "packages/server/src/index.ts"]
