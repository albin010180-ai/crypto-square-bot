FROM node:22-slim

# Install Playwright dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates libnss3 libatk-bridge2.0-0 libdrm2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 fonts-liberation git \
    && rm -rf /var/lib/apt/lists/*

# Configure git for bot commits
RUN git config --global user.name "crypto-square-bot" && \
    git config --global user.email "bot@users.noreply.github.com"

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Install Playwright chromium
RUN npx playwright install chromium

# Copy source
COPY . .

# Create persistent directories
RUN mkdir -p data logs tmp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:${PORT:-3000}/health').then(r=>{if(!r.ok)throw 1}).catch(()=>process.exit(1))"

CMD ["node", "service.mjs"]
