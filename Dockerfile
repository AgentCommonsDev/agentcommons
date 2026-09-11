FROM node:24-bookworm-slim AS base
ENV COREPACK_HOME=/opt/corepack
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN corepack enable && corepack install

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json README.md ./
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM base AS runtime
# The release workflow passes the 12-character commit; local builds report "development".
ARG AGENTCOMMONS_VERSION=development
# The release stamp the host updater compares before replacing a running image (spec §13):
# the full commit and the RFC 3339 build time. The release workflow and the on-host build
# (`stack_up build`) both pass them; an image built without them is never replaced or
# installed automatically, because its age is unknown.
ARG AGENTCOMMONS_REVISION=
ARG AGENTCOMMONS_CREATED=
LABEL org.opencontainers.image.revision=$AGENTCOMMONS_REVISION \
  org.opencontainers.image.created=$AGENTCOMMONS_CREATED
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 AGENTCOMMONS_VERSION=$AGENTCOMMONS_VERSION
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@agentcommons/api", "start"]
