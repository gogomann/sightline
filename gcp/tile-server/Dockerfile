FROM node:20-slim

WORKDIR /app

# Dependencies zuerst (besseres Layer-Caching)
COPY package*.json ./
RUN npm ci --only=production

# Build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install typescript ts-node --save-dev && npm run build

# Dev-Dependencies entfernen
RUN npm prune --production

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
