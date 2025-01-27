# Simple Dockerfile for our couchdb-init service
FROM node:16-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm install --production

COPY index.js ./

CMD ["node", "index.js"]
