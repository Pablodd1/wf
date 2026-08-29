FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy application files
COPY . .

# Set default start command for one-shot execution
CMD ["node", "tools/mariadb-live/run-full-private-capture.cjs"]
