# AGO QC Backend

Backend cho AGO QC App: **Node.js + Express + PostgreSQL (Supabase) + pdfmake**.

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
│   ├── container.repo.js
│   └── samples.repo.js
├── services/              Logic nghiệp vụ (gọi repo, ghép dữ liệu)
│   ├── qcFiles.service.js
│   ├── daily.service.js
│   ├── container.service.js
│   ├── photos.service.js
│   ├── samples.service.js
│   ├── completion.service.js
│   └── pdf.service.js     Gom dữ liệu hồ sơ -> renderPdf -> upload Storage -> lưu link
├── pdf/
│   ├── generate.js        pdfmake: tải ảnh từ Storage, chọn khuôn, trả Buffer PDF
│   ├── doc/common.js      Khối dùng chung: header/footer, bảng, lưới ảnh, quy đổi px -> pt
│   ├── doc/export.js      Khuôn nội bộ hàng XUẤT (song ngữ)
│   ├── doc/import.js      Khuôn nội bộ hàng NHẬP (Báo cáo giám định)
│   ├── doc/en.js          Khuôn KHÁCH HÀNG tiếng Anh (dùng chung 2 loại hồ sơ)
│   ├── fonts/             Liberation Sans (TTF, giấy phép SIL OFL) — font nhúng vào PDF
│   └── logo.png           Logo in ở header
├── grpc/server.js         gRPC cho backend checklist (xem docs/grpc-handover.md)
└── routes/api.js          Router: POST { action, payload } -> service
db/schema.sql              Schema PostgreSQL (chạy trong Supabase)
```

**Triết lý phân tầng:** `routes` (nhận request) → `services` (logic) → `repositories` (SQL).
Lỗi SQL thì xem trong `repositories`, lỗi logic thì xem trong `services`.

## Tối ưu thời gian chờ

- Mọi tác vụ I/O dùng `async/await`.
- `getQCFile`: bắn 6 truy vấn độc lập cùng lúc bằng `Promise.all`.
- Xuất PDF: ảnh tải qua **URL public (CDN), 10 tấm song song**, PDF dựng thuần JavaScript trong ~0,3 giây (xem mục Xuất PDF).
- DB dùng connection **pool**.
- Thêm phiên QC: chèn 6 hạng mục trong **một** câu lệnh INSERT.

## Xuất PDF

PDF được dựng bằng **pdfmake** (thuần JavaScript, không cần Chrome). Trước đây dùng Puppeteer in từ template
HTML: mỗi lần xuất phải mở Chrome (~200MB RAM, vài giây khởi động), giải nén toàn bộ ảnh thành bitmap rồi in
từng trang và ghép lại — trên máy Render 512MB vừa chậm (10-30s) vừa hay tràn RAM. Với pdfmake:

- Ảnh JPEG được nhúng **nguyên bytes** vào PDF (không giải nén) → RAM chỉ tăng cỡ dung lượng ảnh.
- Không phải mở Chrome, không cần `qpdf`, không cần endpoint `/pdf-img` nội bộ hay file tạm.
- Docker image không cần Chromium/font hệ thống (nhẹ đi ~400MB, build nhanh hơn).
- Vẫn in **tuần tự** (hàng đợi trong `pdf/generate.js`) để 2 hồ sơ nhiều ảnh không cùng nằm trong RAM.

### Khuôn PDF

| Hồ sơ | Bản nội bộ (`variant: internal`) | Bản khách hàng (`variant: en`) |
|---|---|---|
| Hàng xuất | `pdf/doc/export.js` — quốc hiệu, thông tin lô, thống kê, QC ngày 6 ảnh/trang, container 9 ảnh/trang | `pdf/doc/en.js` |
| Hàng nhập | `pdf/doc/import.js` — báo cáo giám định, container 6 ảnh/trang, mỗi mẫu 1 trang 4 ảnh | `pdf/doc/en.js` |

Các khuôn được chuyển 1:1 từ template HTML/CSS cũ, giữ nguyên kích thước: mọi số đo trong code vẫn ghi bằng
**px CSS** như template cũ rồi đổi sang pt (`px()` trong `doc/common.js`), chiều cao dòng tính theo đúng cách Chrome
làm tròn số đo font (`chromeLine()`), nên bản in mới trùng bản cũ trong phạm vi ±1pt. Khác biệt cố ý duy nhất:
khung ảnh của trang QC ngày / container trong bản khách hàng rút 5px / 3px vì bản cũ thật ra tràn xuống đè lên
đường kẻ footer (pdfmake không cho tràn mà sẽ đẩy cả hàng ảnh sang trang mới).

- **Font**: Liberation Sans (`pdf/fonts/`, giấy phép SIL OFL) — cùng số đo với Arial mà template cũ khai báo và
  chính là font Chrome trên Render đã dùng thay Arial; có đủ dấu tiếng Việt. Không phụ thuộc font hệ thống nên
  PDF in ở máy dev hay trên Render đều giống nhau.
- **Ảnh**: lấy theo `PHOTO_PATH` qua URL public của bucket (đi qua CDN, nhanh gấp ~3 lần Storage API khi
  chưa ấm; tự quay về Storage API nếu bucket không public), chỉ nhận JPEG/PNG; ảnh tải lỗi hoặc file lạ thì ô
  đó in chỗ trống, PDF vẫn ra (log `[PDF] Không tải được ảnh ...`). Mỗi lần xuất log 2 dòng `[PDF] ...` cho
  biết thời gian tải ảnh / dựng / upload để biết chậm ở đâu.
- **Dung lượng PDF** = tổng ảnh nhúng: frontend nén ảnh 1024px / JPEG 0.72 lúc chụp (~130KB/ảnh) — hồ sơ
  33 ảnh ≈ 4,5 MB. Ảnh chụp trước khi frontend đổi tham số (1280px) nặng hơn ~1,5 lần.
- **Sửa bố cục**: sửa trong `pdf/doc/*.js`; kích thước ghi bằng px, màu và các khối chung (header, footer,
  bảng thông tin, lưới ảnh) nằm ở `doc/common.js`. pdfmake 0.3 chỉ cho đệm trái/phải theo cột nên lưới ảnh dùng
  margin của nút trong ô cho phần đệm khác nhau giữa các hàng.
- **Kiểm tra sau khi sửa**: `node scripts/pdf-preview.mjs [thư-mục]` xuất thử cả 4 khuôn với dữ liệu giả
  (mặc định vào thư mục tạm của máy) — không cần DB, Storage hay `.env`.
- Nhãn/tiêu đề cố định có dấu `/` giữa hai từ được chèn ký tự nối vô hình (U+200D) để không bị xuống dòng sau
  dấu `/` như Chrome; dữ liệu người nhập không bị chèn (xem `nb()` trong `doc/common.js`).

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
| exportPDF | qcFileId, variant (`internal` mặc định \| `en` bản khách hàng) |
