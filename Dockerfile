##############################################
# Stage 1: Build API server
##############################################
FROM node:20-alpine AS api-builder
WORKDIR /build

RUN apk add --no-cache python3 make g++

# Install pnpm
RUN npm install -g pnpm@10

# Copy workspace config files first (for caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy all lib packages (needed for builds)
COPY lib/ lib/
COPY artifacts/api-server/ artifacts/api-server/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build the API server
RUN pnpm --filter @workspace/api-server run build

##############################################
# Stage 2: Build frontend
##############################################
FROM node:20-alpine AS frontend-builder
WORKDIR /build

RUN npm install -g pnpm@10

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ lib/
COPY artifacts/homelab-dashboard/ artifacts/homelab-dashboard/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/homelab-dashboard run build

##############################################
# Stage 3: Production image
##############################################
FROM node:20-alpine AS production
WORKDIR /app

RUN apk add --no-cache python3 make g++

RUN npm install -g pnpm@10

# Copy package files for production deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY lib/ lib/
COPY artifacts/api-server/package.json artifacts/api-server/

RUN pnpm install --filter @workspace/api-server --prod

# Copy built API server
COPY --from=api-builder /build/artifacts/api-server/dist ./artifacts/api-server/dist
# Copy built frontend
COPY --from=frontend-builder /build/artifacts/homelab-dashboard/dist ./frontend-dist

# Create data directory
RUN mkdir -p /data/uploads

# Environment defaults
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV DATABASE_URL=file:/data/db.sqlite
ENV JWT_SECRET=change-this-secret-in-production

# Expose the port
EXPOSE 3000

# Start the API server (it also serves the frontend via static files)
CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
