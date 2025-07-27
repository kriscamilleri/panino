# /backend/api-service/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install all system dependencies that npm might need to install native modules.
# - build-essential & python3: For compiling from source if needed.
# - unzip & ca-certificates: For downloading and extracting pre-built binaries.
RUN apk add --no-cache build-base python3 sqlite-dev \
    && npm rebuild @vlcn.io/crsqlite --build-from-source

ENV CRSQLITE_EXT_PATH=/app/node_modules/@vlcn.io/crsqlite/build/Release/crsqlite.node


COPY package*.json ./

# Run npm install. It now has all the tools it needs.
RUN npm install --omit=dev

COPY . .

EXPOSE 8000
CMD [ "npm", "start" ]