# =============================================================================
# Graphene Backend — Multi-Stage Production Dockerfile
# =============================================================================
#
# STAGE STRATEGY
# ──────────────
# builder   Install ALL deps (including devDeps) and compile TypeScript → dist/
# runner    Copy only dist/ + production node_modules into a minimal image
#
# The runner image never sees devDependencies (tsx, typescript, vitest, etc.)
# which shaves ~200 MB off the final layer and shrinks the attack surface.
#
# NODE VERSION
# ────────────
# LTS 22 (Jod). Pin the minor via the digest in production if you need
# fully reproducible builds — the tag alone can drift on patch releases.
# =============================================================================

# ── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Install build tools needed by native addons (e.g. pg, node-gyp).
# git is required by some postinstall scripts.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first — Docker layer-caches these so `npm ci` only re-runs
# when package-lock.json actually changes, not on every code change.
COPY package.json package-lock.json ./

# Install ALL dependencies (dev + prod) so tsc and other build tools are available.
RUN npm ci

# Copy source tree and tsconfig
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript → dist/
# The outDir in tsconfig.json is ./dist
RUN npm run build

# Prune devDependencies from node_modules in-place.
# This gives us a lean, production-only node_modules to copy into the runner.
RUN npm prune --production


# ── Stage 2: Runner ──────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# dumb-init: correct PID 1 signal handling — forwards SIGTERM so
# `docker stop` exits cleanly instead of forcibly killing after 10 s.
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

# Dedicated non-root system user — never run Node as root in production.
RUN groupadd --system --gid 1001 graphene \
 && useradd  --system --uid 1001 --gid graphene --no-create-home graphene

WORKDIR /app

# Copy only the production artifacts from the builder stage.
# --chown sets file ownership to our non-root user in a single layer.
COPY --from=builder --chown=graphene:graphene /app/dist        ./dist
COPY --from=builder --chown=graphene:graphene /app/node_modules ./node_modules
# package.json is required at runtime so Node resolves "type": "module" (ESM).
COPY --from=builder --chown=graphene:graphene /app/package.json ./package.json

# Drop to non-root before the process starts.
USER graphene

# Document the port the Express server binds to (matches PORT env var default).
EXPOSE 3000

# dumb-init wraps Node so OS signals (SIGTERM, SIGINT) propagate correctly.
# CMD matches the "start" script: node dist/server.js
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
