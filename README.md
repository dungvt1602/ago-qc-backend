# AGO QC Backend

Backend cho AGO QC App: **Node.js + Express + PostgreSQL (Supabase) + Puppeteer**.

## Cấu trúc thư mục

```
src/
├── server.js              Khởi động Express, CORS, nạp route
├── config/env.js          Đọc & kiểm tra biến môi trường
├── lib/                   Hạ tầng dùng chung
│   ├── db.js              Pool kết nối PostgreSQL + helper query/transaction
│   ├── storage.js         Upload/tải ảnh & PDF trên Supabase Storage
│   ├── rows.js            Đổi cột DB (snake_case) -> khóa API (UPPER_CASE)
│   └── util.js            Tiện ích ngày giờ, làm sạch chuỗi, chunk
├── data/catalog.js        6 hạng mục QC ngày + 21 ảnh container
├── repositories/          Câu lệnh SQL thuần (chỉ đụng DB)
│   ├── qcFiles.repo.js
│   ├── daily.repo.js
│   └── container.repo.js
├── services/              Logic nghiệp vụ (gọi repo, ghép dữ liệu)
│   ├── qcFiles.service.js
│   ├── daily.service.js
│   ├── container.service.js
│   ├── photos.service.js
│   └── pdf.service.js
├── pdf/
│   ├── generate.js        Puppeteer: HTML -> PDF (tái dùng trình duyệt)
│   └── template.ejs       Mẫu PDF song ngữ
└── routes/api.js          Router: POST { action, payload } -> service
db/schema.sql              Schema PostgreSQL (chạy trong Supabase)
```

**Triết lý phân tầng:** `routes` (nhận request) → `services` (logic) → `repositories` (SQL).
Lỗi SQL thì xem trong `repositories`, lỗi logic thì xem trong `services`.

## Tối ưu thời gian chờ

- Mọi tác vụ I/O dùng `async/await`.
- `getQCFile`: bắn 5 truy vấn độc lập cùng lúc bằng `Promise.all`.
- Xuất PDF: tải **tất cả ảnh song song** trước khi render (chỗ tiết kiệm nhiều nhất).
- DB dùng connection **pool**; Puppeteer **tái dùng** một trình duyệt cho mọi lần xuất.
- Thêm phiên QC: chèn 6 hạng mục trong **một** câu lệnh INSERT.

## Chạy ở máy (local)

```bash
cd backend
npm install
cp .env.example .env     # rồi điền DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY
npm run dev              # chạy với tự động reload
```

Mở http://localhost:8080 thấy `{ ok: true }` là server sống.

### Chuẩn bị Supabase trước khi chạy
1. Tạo project Supabase.
2. SQL Editor → dán nội dung `db/schema.sql` → Run.
3. Storage → tạo 2 bucket **Public**: `qc-photos`, `qc-pdfs`.
4. Project Settings → API + Database → copy giá trị vào `.env`.

## Gọi thử API

```bash
# Tạo hồ sơ
curl -X POST http://localhost:8080/api -H "Content-Type: application/json" \
  -d '{"action":"createQCFile","payload":{"poNo":"PO123","productName":"Thanh long","qcStaff":"Nam"}}'

# Liệt kê hồ sơ
curl -X POST http://localhost:8080/api -H "Content-Type: application/json" \
  -d '{"action":"listQCFiles","payload":{}}'
```

## Kết nối frontend

Trong `frontend/app.js` đổi dòng đầu:

```js
const API_ENDPOINT = 'http://localhost:8080/api';          // khi test local
// const API_ENDPOINT = 'https://ago-qc-api.onrender.com/api'; // khi đã deploy
```

## API (giữ nguyên hợp đồng cũ)

POST `/api` với body `{ action, payload }`, trả về `{ ok, result }`.

| action | payload chính |
|---|---|
| listQCFiles | — |
| createQCFile | poNo, productName, qcStaff, ... |
| getQCFile | qcFileId |
| updateQCFile | qcFileId, + các trường thông tin |
| updateSummary | qcFileId, + các trường thống kê |
| addDailyQC | qcFileId, qcDate, warehouse, qcStaff |
| saveDailyQCItem | dailyQcId, itemCode, passRate, failRate, remarks |
| saveContainerItem | qcFileId, photoNo, passRate, failRate, remarks |
| uploadPhoto | qcFileId, dataUrl, targetType, (dailyQcId+itemCode \| photoNo) |
| exportPDF | qcFileId |
