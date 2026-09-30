# The API and the automation runner.
#
# Build context is the repo root, not apps/be: this is a pnpm workspace and the service depends on
# @deltamon/shared, which has to be built from source in the same install.
#
#   docker build -f apps/be/Dockerfile -t deltamon-be .
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# pnpm refuses to purge a modules directory without a TTY unless it knows it is automated.
ENV CI=true
RUN corepack enable
WORKDIR /repo

# ── dependencies ───────────────────────────────────────────────────────────────
# Only the manifests, so a dependency install is cached until one of them changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/be/package.json apps/be/
COPY apps/fe/package.json apps/fe/
COPY packages/shared/package.json packages/shared/
COPY packages/contracts/package.json packages/contracts/
COPY packages/typescript-config/package.json packages/typescript-config/
# No BuildKit cache mount here: Railway's builder requires a cache-key prefix on the mount id
# and rejects the Dockerfile outright without one. Layer caching covers this anyway, since the
# manifests are copied on their own above.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ── build ──────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY packages/typescript-config packages/typescript-config
COPY packages/shared packages/shared
COPY apps/be apps/be
# shared first: the API imports its compiled output, not its sources.
RUN pnpm --filter @deltamon/shared build \
 && pnpm --filter @deltamon/be build

# Prune to just this service. Copying the workspace's node_modules would drag in the pnpm store
# for every package, the frontend's dependencies included; deploy resolves one package's
# production tree into a self-contained directory.
RUN pnpm deploy --filter @deltamon/be --prod --legacy /out

# ── runtime ────────────────────────────────────────────────────────────────────
FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Railway injects PORT; the server already defaults HOST to 0.0.0.0.
ENV PORT=4000

COPY --from=build /out/node_modules node_modules
COPY --from=build /out/dist dist
COPY --from=build /out/package.json package.json

# Never run the API as root.
USER node
EXPOSE 4000

# No shell wrapper, so signals reach node and Railway can stop the container cleanly. The server
# already closes the keeper, the automation runner, the Perpl socket and Mongo on SIGTERM.
CMD ["node", "dist/index.js"]
