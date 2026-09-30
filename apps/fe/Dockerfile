# The Next.js console and landing page.
#
# Build context is the repo root, not apps/fe: this is a pnpm workspace and the app depends on
# @deltamon/shared, which has to be built from source in the same install.
#
#   docker build -f apps/fe/Dockerfile -t deltamon-fe .
#
# NEXT_PUBLIC_* values are read at build time and baked into the client bundle, so they are build
# arguments here rather than runtime variables. Changing one means rebuilding.
#
# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# pnpm refuses to purge a modules directory without a TTY unless it knows it is automated.
ENV CI=true
RUN corepack enable
WORKDIR /repo

# ── dependencies ───────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/be/package.json apps/be/
COPY apps/fe/package.json apps/fe/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── build ──────────────────────────────────────────────────────────────────────
FROM deps AS build
ARG NEXT_PUBLIC_DEFAULT_CHAIN_ID=143
ARG NEXT_PUBLIC_VAULT_ADDRESS
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_PASSKEY_ENABLED=false
ARG AURORA_CROSSCHAIN_ENABLED=false
ENV NEXT_PUBLIC_DEFAULT_CHAIN_ID=$NEXT_PUBLIC_DEFAULT_CHAIN_ID \
    NEXT_PUBLIC_VAULT_ADDRESS=$NEXT_PUBLIC_VAULT_ADDRESS \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_PASSKEY_ENABLED=$NEXT_PUBLIC_PASSKEY_ENABLED \
    AURORA_CROSSCHAIN_ENABLED=$AURORA_CROSSCHAIN_ENABLED \
    NEXT_TELEMETRY_DISABLED=1

COPY packages/typescript-config packages/typescript-config
COPY packages/shared packages/shared
COPY apps/fe apps/fe
# shared first: the app imports its compiled output, not its sources.
RUN pnpm --filter @deltamon/shared build \
 && pnpm --filter @deltamon/fe build

# ── runtime ────────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone traces its own dependencies, so nothing else from node_modules is needed.
COPY --from=build /repo/apps/fe/.next/standalone ./
COPY --from=build /repo/apps/fe/.next/static ./apps/fe/.next/static
COPY --from=build /repo/apps/fe/public ./apps/fe/public

USER node
EXPOSE 3000

# The standalone server lives at the app's path inside the traced tree.
CMD ["node", "apps/fe/server.js"]
