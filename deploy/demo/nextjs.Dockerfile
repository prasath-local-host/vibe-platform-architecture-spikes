ARG NODE_IMAGE=node@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN --network=none npm test && npm run build

FROM ${NODE_IMAGE} AS runtime
USER root
# Runtime needs Node, not the npm toolchain. Apply OS security fixes before scanning.
RUN apk upgrade --no-cache && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
