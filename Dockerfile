FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

RUN npm prune --production


FROM node:22-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 graphene \
 && useradd  --system --uid 1001 --gid graphene --no-create-home graphene

WORKDIR /app

COPY --from=builder --chown=graphene:graphene /app/dist        ./dist
COPY --from=builder --chown=graphene:graphene /app/node_modules ./node_modules
COPY --from=builder --chown=graphene:graphene /app/package.json ./package.json

USER graphene

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
