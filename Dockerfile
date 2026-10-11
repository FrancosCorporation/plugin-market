FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3900 DATABASE_PATH=/data/plugin-market.db
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --chown=node:node . .
USER node
EXPOSE 3900
CMD ["node", "server.js"]
