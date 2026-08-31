FROM node:22-slim

# Install Playwright dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates libnss3 libatk-bridge2.0-0 libdrm2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Install Playwright chromium
RUN npx playwright install chromium

# Copy source
COPY . .

# Create data directory
RUN mkdir -p data logs tmp

EXPOSE 3000

CMD ["node", "service.mjs"]
