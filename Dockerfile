FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force && mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
