# Pulse API image. Build from the repository root:
#   docker build -f server/Dockerfile -t pulse-api .
#   docker run -p 4000:4000 -v pulse-data:/data -e DATA_DIR=/data -e SECRET_KEY=... pulse-api
#
# The server serves the built client from client/dist when present, so this image
# can run the whole app alone, or act as the API behind a Vercel-hosted client.
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
# node-pty is an optional dependency: its native build fails in the slim image (no compiler) and npm skips it,
# so the terminal falls back to pipes. Do not pass --omit=optional: rollup and sharp ship their binaries as optional packages.
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run typecheck -w shared && npm run typecheck -w server && npm run build -w client

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/data
WORKDIR /app
# runtime deps only (sharp ships prebuilt binaries; node:sqlite is built in)
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/shared/src ./shared/src
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/assets ./server/assets
# Platform developer docs power the agent's platform_docs / diagnose tools and the Documentation search.
COPY --from=build /app/docs/platforms ./docs/platforms
COPY --from=build /app/server/tsconfig.json ./server/tsconfig.json
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# tsx runs the TypeScript sources directly; the shared workspace package resolves via node_modules symlink.
CMD ["npx", "tsx", "server/src/index.ts"]
