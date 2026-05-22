FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY thedoxaway-mcp-client-*.tgz ./
RUN npm install --omit=optional --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY thedoxaway-mcp-client-*.tgz ./
RUN npm install --omit=dev --omit=optional --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Discord bots are long-running; restart on failure handled by the platform.
USER node

CMD ["node", "dist/index.js"]
