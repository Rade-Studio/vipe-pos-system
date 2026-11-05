# ============================================
# VIPE POS - API image (NestJS, apps/api)
# ============================================
# Build context: repository root (the API depends on the @vipe/db workspace
# package). Targets:
#   api      (default) the HTTP + socket.io server on $PORT (4000)
#   migrate  one-shot: applies packages/db/migrations as vipe_migrator
#
#   docker build -f apps/api/Dockerfile -t vipe-api .
#   docker build -f apps/api/Dockerfile --target migrate -t vipe-api-migrate .
# ============================================

ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.25.0

# --- base: Node + pnpm through corepack ---
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
# python3/make/g++: fallback for native modules (argon2) without a musl prebuild.
RUN apk add --no-cache libc6-compat python3 make g++ \
  && corepack enable \
  && corepack prepare "pnpm@${PNPM_VERSION}" --activate
ENV CI=true
WORKDIR /app
# Only the manifests: the install layers stay cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/

# --- build: full workspace install for @vipe/api and its workspace deps ---
FROM base AS build
RUN pnpm install --frozen-lockfile --filter "@vipe/api..."
COPY packages/db packages/db
COPY apps/api apps/api
# Also builds @vipe/db, including dist/migrate.js (the `migrate` target's CLI).
RUN pnpm --filter @vipe/api build

# --- prod-deps: production dependencies only, same lockfile ---
# `pnpm deploy` writes @vipe/api with only its production dependencies and
# @vipe/db injected as a real directory with only its `files` (dist and
# migrations: no tests, seed or migration fixtures). A filtered `pnpm install --prod` would also install the root web
# package (the workspace root is always installed), about 450 MB more.
FROM build AS prod-deps
RUN pnpm --config.inject-workspace-packages=true --filter @vipe/api deploy --prod /out

# --- runtime: compiled output + production node_modules, non-root ---
FROM ${NODE_IMAGE} AS runtime
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /out/package.json ./package.json
COPY --from=prod-deps --chown=node:node /out/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /out/dist ./dist
USER node

# --- migrate: apply pending migrations and exit (DATABASE_URL = vipe_migrator) ---
# runMigrations reads node_modules/@vipe/db/migrations (next to its dist).
FROM runtime AS migrate
CMD ["node", "node_modules/@vipe/db/dist/migrate.js"]

# --- api (default target) ---
FROM runtime AS api
ENV PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
