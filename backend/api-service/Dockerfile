# /backend/api-service/Dockerfile
FROM node:20-bookworm-slim

# Puppeteer + native build deps (crsqlite) + unzip for crsqlite helper
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
ENV CRSQLITE_EXT_PATH=/app/node_modules/@vlcn.io/crsqlite/build/Release/crsqlite.node

COPY package*.json ./
COPY patch-crsqlite.sh ./

# Prefer npm ci when lockfile exists
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
  && npm rebuild @vlcn.io/crsqlite --build-from-source

COPY . .

EXPOSE 8000
CMD ["npm", "start"]
