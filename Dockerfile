FROM node:22-slim

WORKDIR /app

RUN npm install -g pnpm@9.15.3

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/orchestrator ./apps/orchestrator

RUN pnpm install --frozen-lockfile=false

EXPOSE 3001

CMD ["pnpm", "--filter", "@super-engine/orchestrator", "start"]
