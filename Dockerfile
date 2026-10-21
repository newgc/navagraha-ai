# syntax=docker/dockerfile:1.7
# One image for both containers of the Lightsail service; each runs its own start script:
#   API: sh deploy/container/start-api.sh   (migrations + seed, then the API on 127.0.0.1)
#   Web: sh deploy/container/start-web.sh   (Next.js on 0.0.0.0, the public endpoint)
#
# An extra CA for networks behind a TLS-inspecting proxy can be passed with
# `--secret id=extra_ca,src=ca.pem`; it is only mounted while downloading, never stored.

FROM node:22.22.0-bookworm-slim AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/

# Production dependencies only, in a clean tree (pruning a full install leaves dev packages behind).
FROM base AS prod-deps
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) \
    pnpm install --prod --frozen-lockfile

FROM base AS build
RUN --mount=type=secret,id=extra_ca,required=false \
    NODE_EXTRA_CA_CERTS=$([ -f /run/secrets/extra_ca ] && echo /run/secrets/extra_ca) \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22.22.0-bookworm-slim
# NO_COLOR: plain log lines in the Lightsail console.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 NO_COLOR=1
# Amazon's RDS CA bundle (also signs Lightsail databases). Used when DATABASE_SSL_CA points here.
# Create the folders first: ADD --chmod would otherwise give them the file's 644 mode too.
RUN install -d -m 755 /etc/ssl/rds
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds/global-bundle.pem
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/domain/dist packages/domain/dist
COPY --from=build --chown=node:node /app/packages/db/dist packages/db/dist
COPY --from=build --chown=node:node /app/packages/db/drizzle packages/db/drizzle
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /app/apps/web/.next apps/web/.next
COPY --from=build --chown=node:node /app/apps/web/next.config.ts apps/web/
COPY --chown=node:node deploy/container deploy/container
RUN rm -rf apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["sh", "deploy/container/start-web.sh"]
