# Backend AGO QC — Node.js + Express + pdfmake (PDF thuần JavaScript, không cần Chromium)
FROM node:22-bookworm-slim

# PDF dựng bằng pdfmake, font Liberation Sans đóng gói sẵn trong src/pdf/fonts
# -> không cần cài Chromium / qpdf / font hệ thống; image nhẹ, build nhanh.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# max-old-space-size: máy 512MB, ép Node dọn rác sớm thay vì để heap phình (mặc định V8 tưởng có 2GB).
ENV NODE_ENV=production \
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
