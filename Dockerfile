FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

CMD ["sh", "-c", "exec ${WF_START_COMMAND:-node tools/shadow-reprocess/railway-worker.cjs}"]
