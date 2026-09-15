# Backend AGO QC — Node.js + Express + Puppeteer (Chromium)
FROM node:22-bookworm-slim

# Cài Chromium + thư viện hệ thống + font.
# Font tiếng Việt: DejaVu/Liberation phủ đủ dấu tiếng Việt cho PDF.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      qpdf \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Puppeteer dùng Chromium của hệ thống (không tự tải bản riêng -> image nhẹ, build nhanh).
# max-old-space-size: máy 512MB, ép Node dọn rác sớm thay vì để heap phình (mặc định V8 tưởng có 2GB).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=200

WORKDIR /app

# Cài dependencies trước để tận dụng cache layer (chỉ cài lại khi package*.json đổi).
COPY package*.json ./
RUN npm ci --omit=dev

# Copy phần mã nguồn còn lại.
COPY . .

# Render/host sẽ cấp biến PORT; server đọc từ env, mặc định 8080.
# 50051 = gRPC cho backend checklist, chỉ đi qua mạng riêng Render (không public).
EXPOSE 8080 50051

CMD ["node", "src/server.js"]
