FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

COPY --chown=node:node src ./src
RUN chown -R node:node /app

USER node

CMD ["node", "src/worker.js"]
