# ============================================
# VIPE POS - Production Dockerfile
# Multi-stage build: deps -> build -> runtime
# ============================================

# Stage 1: Dependencies
FROM node:20-alpine AS deps

RUN apk add --no-cache libc6-compat curl

WORKDIR /app

# Install pnpm globally via corepack
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder

RUN apk add --no-cache libc6-compat curl

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN pnpm build

# Stage 3: Runtime
FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat curl

# Add non-root user for security
RUN adduser -D appuser

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Copy built artifacts and production node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER appuser

EXPOSE 3000

CMD ["node", "server.js"]
