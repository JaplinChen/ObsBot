# ============================================================
# ObsBot Docker Image — Multi-stage Build
# ============================================================
# Usage:
#   docker compose up -d
#   docker build -t obsbot . && docker run --env-file .env obsbot
# ============================================================

# ---- Stage 1: Build TypeScript ----
FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/postinstall.sh ./scripts/
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- Stage 2: Runtime ----
FROM node:22-bookworm-slim

# System dependencies for Camoufox (Firefox-based) + media tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Camoufox / Firefox runtime deps
    libgtk-3-0 \
    libasound2 \
    libdbus-glib-1-2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxtst6 \
    libpango-1.0-0 \
    libcairo2 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libxshmfence1 \
    libxkbcommon0 \
    fonts-wqy-zenhei \
    # Media processing
    ffmpeg \
    # Process management
    tini \
    # Healthcheck + utils
    curl \
    # yt-dlp via pip
    python3-pip \
    # Native module build deps (better-sqlite3 in camoufox-js)
    python3 \
    make \
    g++ \
    && pip3 install --break-system-packages yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install production dependencies (includes postinstall Telegraf patch)
COPY package.json package-lock.json ./
COPY scripts/postinstall.sh ./scripts/
RUN npm ci --omit=dev

# Copy compiled code + runtime scripts
COPY --from=builder /app/dist/ ./dist/
COPY scripts/loop.mjs ./scripts/
COPY src/admin/ui.html ./dist/admin/

# Pre-download Camoufox browser binary + set permissions
RUN npx camoufox fetch && chmod -R 755 /root/.cache/camoufox

# Create data directory (will be overridden by volume mount)
RUN mkdir -p data

# Admin UI port
EXPOSE 3001

# Container-internal vault path (mount your vault here)
ENV VAULT_PATH=/vault
ENV NODE_ENV=production

# Health check via admin API
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Use tini as PID 1 for proper signal handling
ENTRYPOINT ["tini", "--"]

# loop.mjs handles crash recovery + auto-restart
CMD ["node", "scripts/loop.mjs"]
