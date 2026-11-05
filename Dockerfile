# ============================================
# VIPE POS - Web image (Next.js standalone)
# ============================================
# Multi-stage build: deps -> build -> runtime. The browser always calls its
# own origin (`/api`, `/socket.io/`); in production the reverse proxy
# (deploy/Caddyfile) routes those paths to the API before they reach Next.
# ============================================

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.25.0

# Stage 1: Dependencies
FROM ${NODE_IMAGE} AS deps
ARG PNPM_VERSION
RUN apk add --no-cache libc6-compat \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
ENV CI=true
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc pnpm-workspace.yaml ./
# Only the root web package is installed; the workspace manifests are needed
# so the frozen lockfile matches.
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile --filter vipe-pos-system

# Stage 2: Build
FROM deps AS builder
COPY . .
# Next's rewrites() are fixed at build time. Only for a local image run without
# the proxy; production leaves the default (Caddy routes /api and /socket.io/).
ARG API_PROXY_TARGET
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# Stage 3: Runtime
FROM ${NODE_IMAGE} AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"
CMD ["node", "server.js"]
