# /backend/api-service/Dockerfile
FROM node:24-bookworm-slim

# Puppeteer runtime libraries and native build dependencies for better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    build-essential \
    python3 \
    pkg-config \
    libsqlite3-dev \
    git \
    unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHON=/usr/bin/python3
ENV CRSQLITE_EXT_PATH=/app/native/crsqlite.so

# Build context is the repository root (see docker-compose.yml), so paths are
# repo-relative. The shared content-merge package lives at /shared and is linked
# in via the `file:../../shared` dependency declared in package.json.
COPY backend/api-service/package*.json backend/api-service/.npmrc ./
COPY shared/package*.json /shared/
COPY shared/contentMerge.js /shared/

# Install the shared package's runtime dependency first so the app's `file:`
# link resolves node-diff3 from /shared/node_modules.
RUN cd /shared && npm ci --omit=dev

# .npmrc disables lifecycle scripts so better-sqlite3 is rebuilt and
# Puppeteer's Chrome is fetched explicitly in a deterministic order.
# CR-SQLite ships as a vendored prebuilt loadable extension.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm run native:setup

COPY shared/ /shared/
COPY backend/api-service/ ./

EXPOSE 8000
CMD ["npm", "start"]
