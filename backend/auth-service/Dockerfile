# /backend/auth-service/Dockerfile
# Use an official Node.js runtime as a parent image
FROM node:24.4.0-alpine
# /backend/auth-service/Dockerfile
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8000
CMD ["node", "index.js"]