FROM node:26-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY thedoxaway-mcp-client-*.tgz ./
# Optional deps stay in the builder: TypeScript 7 ships its compiler as a
# per-platform optional package (@typescript/typescript-<os>-<arch>).
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:26-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY thedoxaway-mcp-client-*.tgz ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Discord bots are long-running; restart on failure handled by the platform.
USER node

CMD ["node", "dist/index.js"]
