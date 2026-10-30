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
# The hook manifest carries the same release stamp as the image labels (ADR 0059/0075) so a
# client can compare the served bundle's age. Declared here, after the cached install layer,
# the build args reach `pnpm build` (the manifest producer) only for the build step; with no
# revision/created passed, `pnpm build` falls back to git HEAD or omits the stamp.
ARG AGENTCOMMONS_REVISION=
ARG AGENTCOMMONS_CREATED=
RUN AGENTCOMMONS_REVISION="$AGENTCOMMONS_REVISION" AGENTCOMMONS_CREATED="$AGENTCOMMONS_CREATED" pnpm build
# The release workflow mounts the hook signing key as a BuildKit secret for this step alone,
# which runs Node and nothing else, so the key reaches no layer and no build tool (ADR 0102).
# Any other build (`single-node-release.sh --build`, `docker compose build`) has no key and
# serves an unsigned manifest, which installed shims do not update from.
RUN --mount=type=secret,id=hook_signing_key \
  if [ -e /run/secrets/hook_signing_key ]; then \
    node packages/hook/sign.ts /run/secrets/hook_signing_key apps/api/public/hook/manifest.json; \
  else \
    echo "No hook signing key: installed shims will not update from this image's hook manifest."; \
  fi

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
