FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8080
# Default: gateway + built-in mock N-ATLAS. Set UPSTREAM_URL and MOCK_UPSTREAM=false for the real model.
CMD ["npx", "tsx", "src/demo-server.ts"]
