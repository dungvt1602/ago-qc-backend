# Backend AGO QC — Node.js + Express + Puppeteer (Chromium)
FROM node:22-bookworm-slim

# Cài Chromium + thư viện hệ thống + font.
# Font tiếng Việt: DejaVu/Liberation phủ đủ dấu tiếng Việt cho PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer dùng Chromium của hệ thống (không tự tải bản riêng -> image nhẹ, build nhanh).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

WORKDIR /app

# Cài dependencies trước để tận dụng cache layer (chỉ cài lại khi package*.json đổi).
COPY package*.json ./
RUN npm ci --omit=dev

# Copy phần mã nguồn còn lại.
COPY . .

# Render/host sẽ cấp biến PORT; server đọc từ env, mặc định 8080.
EXPOSE 8080

CMD ["node", "src/server.js"]
