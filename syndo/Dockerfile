# SEND API + web client, single image. Build from the syndo/ directory:  docker build -t send .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build -w @syndo/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev --workspaces --include-workspace-root || true
USER node
EXPOSE 3900
CMD ["node", "--import", "tsx", "server/src/index.ts"]
