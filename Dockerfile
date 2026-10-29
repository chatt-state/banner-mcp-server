# syntax=docker/dockerfile:1
#
# Banner MCP Server, HTTP transport, non-root.
#
# The ellucian-banner SDK is currently a sibling checkout (file:../ellucian-banner),
# so the build context is the PARENT directory holding both repositories:
#
#   cd ..   # the directory containing banner-mcp-server/ and ellucian-banner/
#   docker build -f banner-mcp-server/Dockerfile -t banner-mcp-server:0.2.0 .
#
# When package.json switches to "github:chatt-state/ellucian-banner#<tag>", drop the
# ellucian-banner COPY/RUN lines below (npm ci then fetches the SDK with git).

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
RUN apk add --no-cache git
WORKDIR /src

# SDK (sibling checkout): install + build via its `prepare` script.
COPY ellucian-banner/ ./ellucian-banner/
RUN cd ellucian-banner && npm ci --no-audit --no-fund

COPY banner-mcp-server/package.json banner-mcp-server/package-lock.json ./banner-mcp-server/
WORKDIR /src/banner-mcp-server
RUN npm ci --no-audit --no-fund
COPY banner-mcp-server/tsconfig.json ./
COPY banner-mcp-server/src ./src
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    BANNER_MCP_TRANSPORT=http \
    BANNER_MCP_HTTP_HOST=0.0.0.0 \
    BANNER_MCP_HTTP_PORT=3001
WORKDIR /app/banner-mcp-server

# node_modules/ellucian-banner is a relative symlink to ../../ellucian-banner,
# so keep the same side-by-side layout; only the SDK's runtime files are copied.
COPY --from=build --chown=root:root /src/ellucian-banner/package.json /app/ellucian-banner/package.json
COPY --from=build --chown=root:root /src/ellucian-banner/dist /app/ellucian-banner/dist
COPY --from=build --chown=root:root /src/banner-mcp-server/package.json ./package.json
COPY --from=build --chown=root:root /src/banner-mcp-server/node_modules ./node_modules
COPY --from=build --chown=root:root /src/banner-mcp-server/dist ./dist

# Files are root-owned and read-only to the runtime user.
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${BANNER_MCP_HTTP_PORT}/healthz" >/dev/null || exit 1

# Secrets (ETHOS_API_KEY, BANNER_MCP_HTTP_TOKEN, BANNER_PASSWORD) are provided at
# run time (env file / orchestrator secrets), never baked into the image.
CMD ["node", "dist/index.js"]
