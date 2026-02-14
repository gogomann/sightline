FROM node:20-slim

WORKDIR /app

# Dependencies zuerst (besseres Layer-Caching)
COPY package*.json ./
RUN npm install --omit=dev

# Build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm install --save-dev typescript ts-node && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]