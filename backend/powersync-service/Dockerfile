# /backend/powersync-service/Dockerfile
FROM node:24.4.0-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 7000

CMD ["node", "index.js"]