# Bàn giao gRPC: App QC ↔ Backend checklist

Tài liệu cho đội backend checklist (Go). Bổ sung cho `docs/qc-app-grpc-contract.md` phía các bạn:
App QC **đã implement xong** `GetStatus` như hợp đồng, và **đề xuất thêm 1 RPC `CreateQC`** để hai bên
khớp đơn với nhau tự động (xem mục 3 — vì sao bắt buộc phải có). Sau đó thêm RPC thứ ba **`SyncOrderInfo`**
để checklist đẩy thông tin đơn (nơi sản xuất, số cont, seal, ngày đóng cont, khách, hàng) sang hồ sơ QC
đã có — xem mục 4c.

---

## 1. Kết nối

Hai backend nằm **cùng workspace Render, cùng region Singapore** → dùng **mạng riêng Render**,
đúng kịch bản "plaintext nội bộ" trong tài liệu của các bạn. Không TLS, cổng không public ra Internet.

| | Giá trị |
|---|---|
| Địa chỉ | `ago-qc-backend:50051` (tên service = hostname nội bộ) |
| Giao thức | gRPC plaintext (`insecure`) |
| Xác thực | metadata `x-api-key: <khóa>` trên **mọi** call — thiếu/sai → `UNAUTHENTICATED` |
| Deadline khuyến nghị | 3 giây cho `GetStatus` / `CreateQC` (`GetStatus` thực tế < 100 ms). `SyncOrderInfo` chạy nền (không nằm trong request của người dùng) nên đặt **~30 giây** (`QC_SYNC_TIMEOUT` bên Go): phòng khi App QC đang khởi động nguội hoặc vừa deploy, có thể mất 30–60 giây |

Biến môi trường cần đặt trên **`ago-order-api`**:

```
QC_APP_GRPC_ADDR = ago-qc-backend:50051
QC_APP_API_KEY   = <khóa — nhận qua kênh riêng, KHÔNG commit vào git>
```

Khóa do phía QC sinh (32 byte ngẫu nhiên) và đặt cùng giá trị ở `ago-qc-backend`.

---

## 2. Hợp đồng (proto)

Thay file `proto/qc/v1/qc.proto` phía các bạn bằng bản dưới. So với bản cũ: **chỉ thêm**, không đổi/dùng lại số trường.

```protobuf
syntax = "proto3";
package ago.qc.v1;
option go_package = "github.com/ago/ago-backend-checklist/internal/qcpb;qcpb";

service QCService {
  // Checklist hỏi: đơn này QC tới đâu rồi? Dùng để chặn "Sản xuất xong" khi chưa QC.
  rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);

  // Checklist tạo hồ sơ QC (hàng xuất) cho đơn, điền sẵn thông tin cơ bản.
  // IDEMPOTENT: gọi lại với cùng order_id -> trả hồ sơ đã có, created = false. Không bao giờ tạo trùng.
  rpc CreateQC(CreateQCRequest) returns (CreateQCResponse);

  // Checklist đẩy thông tin đơn sang hồ sơ QC ĐÃ CÓ (một chiều). Trường chuỗi RỖNG = "đơn chưa có thông tin" → App QC KHÔNG ghi đè.
  rpc SyncOrderInfo(SyncOrderInfoRequest) returns (SyncOrderInfoResponse);
}

message GetStatusRequest {
  int64 order_id = 1;
}

message GetStatusResponse {
  int32 photo_count = 1;  // tổng ảnh đã chụp (QC ngày + container + mẫu). Chưa có gì -> 0
  bool  done        = 2;  // QC đã bấm "Hoàn tất QC". Chưa xong / chưa có hồ sơ -> false

  // --- Đợt 2 (16/09/2026): để checklist hiện đủ tiến độ ---
  int32  photo_total = 3;  // tổng ô ảnh cần chụp của hồ sơ. Chưa có hồ sơ -> 0
  string file_url    = 4;  // URL mở THẲNG hồ sơ trên App QC (không cần đăng nhập). Chưa có hồ sơ -> ""
  int64  done_at     = 5;  // lúc bấm "Hoàn tất QC", unix ms. Chưa xong -> 0
  string done_by     = 6;  // tên người bấm Hoàn tất. Chưa xong -> ""
  repeated PhotoGroup groups = 7;  // tiến độ theo nhóm; sum(count)==photo_count, sum(total)==photo_total
}

message PhotoGroup {
  string name  = 1;  // nhãn hiển thị: "QC ngày" | "Container" | "Mẫu"
  int32  count = 2;  // đã chụp
  int32  total = 3;  // cần chụp
}

message CreateQCRequest {
  int64  order_id        = 1;  // bắt buộc, > 0
  string po_no           = 2;
  string product_name    = 3;
  string specification   = 4;
  string quantity        = 5;
  string unit            = 6;
  string customer        = 7;
  string contract_no     = 8;
  string created_by_name = 9;  // tên người bấm "Tạo đơn QC" bên checklist -> hiện là người mở hồ sơ
}

message CreateQCResponse {
  string qc_file_id = 1;  // UUID hồ sơ bên App QC
  string lot_code   = 2;  // mã lô, vd QC-AGO2609-20260915
  bool   created    = 3;  // true = vừa tạo mới; false = đã có từ trước (gọi lại)
}

message SyncOrderInfoRequest {
  int64  order_id               = 1;   // bắt buộc, > 0
  string customer               = 2;
  string product_name           = 3;
  string specification          = 4;
  string quantity               = 5;
  string unit                   = 6;
  string supplier               = 7;   // nơi sản xuất / nhà đóng gói
  string container_no           = 8;
  string seal_no                = 9;
  string container_loading_date = 10;  // yyyy-MM-dd (giờ VN) hoặc ""
  bool   only_fill_empty        = 11;  // true: lần đồng bộ đầu — 4 ô QC có thể đã gõ tay (supplier, container_no, seal_no, container_loading_date) chỉ điền khi còn trống; 5 ô còn lại luôn đồng bộ
}

message SyncOrderInfoResponse {
  bool file_found = 1;  // false: chưa có hồ sơ cho order_id này (không phải lỗi)
  bool locked     = 2;  // true: hồ sơ đang khoá, KHÔNG ghi
  bool updated    = 3;  // true: có ít nhất một ô đổi giá trị thật
}
```

Tên RPC trên đường dây: `/ago.qc.v1.QCService/GetStatus`, `/ago.qc.v1.QCService/CreateQC` và `/ago.qc.v1.QCService/SyncOrderInfo`.

---

## 3. Vì sao cần `CreateQC`

Hồ sơ QC bên App QC dùng **UUID**, còn checklist hỏi bằng **`order_id` số**. Hai bên chỉ khớp được
khi hồ sơ QC **biết mình thuộc đơn nào** — và cách duy nhất không sai sót là **checklist tạo hồ sơ
QC kèm `order_id`** ngay khi đơn vào bước Sản xuất.

Nếu không có `CreateQC`: QC viên tự tạo hồ sơ bằng số PO, không ai nhập `order_id` → `GetStatus`
không tìm thấy → trả `done = false` mãi → **người dùng bị chặn hoàn tất sản xuất dù QC đã xong**.

Luồng đầy đủ:

```
Checklist                          App QC
   │  đơn #2 vào bước Sản xuất        │
   ├── CreateQC(order_id=2, po, …) ──►│  tạo hồ sơ EXPORT, order_id = 2
   │◄── {qc_file_id, lot_code,        │  (gọi lại lần 2 -> created=false, cùng hồ sơ)
   │     created=true}                │
   │                                  │  QC viên mở app -> thấy hồ sơ "Đơn #2"
   │                                  │  -> chụp ảnh -> bấm "Hoàn tất QC"
   │  người dùng bấm "Sản xuất xong"  │
   ├── GetStatus(order_id=2) ────────►│
   │◄── {photo_count: 33, done: true} │
   │  cho phép đóng đơn               │
```

---

## 4. Ý nghĩa từng trường & hành vi

### `CreateQC`
| Trường | Ghi chú |
|---|---|
| `order_id` | ID số của đơn. **Unique** bên App QC: mỗi đơn đúng 1 hồ sơ. |
| `po_no` | Dùng để sinh mã lô `QC-{PO}-{yyyyMMdd}` (tự thêm `-02`, `-03` nếu trùng ngày). Trống → `NOPO`. |
| `product_name`, `specification`, `quantity`, `unit`, `customer`, `contract_no` | Điền sẵn vào mục "Thông tin lô hàng". Đều được phép trống. `contract_no` QC viên sửa tự do. **Năm ô `product_name`, `specification`, `quantity`, `unit`, `customer` không còn tự do sửa tay** khi App QC bật cờ `QC_ORDER_FIELDS_READONLY` (mục 4c): trên hồ sơ có `order_id` chúng do **đơn** đồng bộ sang, sửa ở đơn. |

- Hồ sơ tạo ra luôn là loại **hàng xuất** (EXPORT).
- **Idempotent**: gọi lại (retry sau timeout, gọi trùng…) → trả đúng hồ sơ cũ, `created = false`. Hai lệnh tạo tới cùng lúc cũng chỉ ra 1 hồ sơ.
- Gọi **một lần là đủ**; nhưng gọi nhiều lần vô hại.

### `GetStatus`
| Trường | Ghi chú |
|---|---|
| `photo_count` | Tổng ảnh đã chụp của hồ sơ (mọi loại). Chỉ để hiển thị tiến độ. |
| `done` | `true` khi QC viên đã bấm **"Hoàn tất QC"** trong app. Nút này chỉ bật khi đã chụp **đủ 100% ô ảnh**. |

- Đơn chưa có hồ sơ → `{photo_count: 0, done: false}`, **không** lỗi `NOT_FOUND` (đúng hợp đồng).
- `done` là "đã làm xong việc kiểm", **không** phải đạt/không đạt.
- `done` **có thể quay về `false`**: QC viên được phép "Mở lại" hồ sơ để sửa (có xác nhận), sau đó phải Hoàn tất lại. Đừng cache `done = true` lâu phía checklist.
- Sau khi Hoàn tất, App QC **khóa** hồ sơ (không chụp/xóa/sửa) để bằng chứng không đổi sau khi đơn đã đóng.

### Mã lỗi gRPC
| Tình huống | Status |
|---|---|
| Thiếu / sai `x-api-key` | `UNAUTHENTICATED` (16) |
| `order_id` ≤ 0 hoặc không phải số nguyên | `INVALID_ARGUMENT` (3) |
| `SyncOrderInfo`: `container_loading_date` không phải ngày thật dạng `yyyy-MM-dd`, hoặc có chuỗi chứa ký tự NUL | `INVALID_ARGUMENT` (3) — câu lỗi cố định, không in lại dữ liệu |
| Lỗi nội bộ App QC (DB…) | `INTERNAL` (13) — checklist nên chặn hoàn tất sản xuất như hợp đồng đã ghi |
| `GetStatus` đơn chưa có hồ sơ | **OK** với `{0, false}` |

---

## 4b. Đợt 2 (16/09/2026) — các trường bổ sung của `GetStatus`

Đã làm đúng yêu cầu mục 8 trong tài liệu của các bạn. Chỉ **thêm** trường 3–7 và trường 9; không đổi số cũ.

| Trường | App QC trả gì |
|---|---|
| `photo_total` | Tổng ô ảnh của hồ sơ. Hàng xuất = 6 × số đợt QC + 21; hàng nhập = 4 × số mẫu + 9. Chưa có hồ sơ → 0. Luôn `photo_count ≤ photo_total`. |
| `file_url` | `https://ago-qc.netlify.app/qc/<uuid>` — mở thẳng hồ sơ, **không cần đăng nhập** (App QC chưa có đăng nhập). Hồ sơ đã bị xóa → app tự về danh sách. Chưa có hồ sơ → `""`. |
| `done_at` | Unix **ms** lúc bấm "Hoàn tất QC". Chưa xong / đã "Mở lại" → `0`. |
| `done_by` | Tên người bấm Hoàn tất (app hỏi tên lúc bấm, điền sẵn Nhân viên QC). Chưa xong / đã "Mở lại" → `""`. |
| `groups` | Hàng xuất: `[QC ngày, Container]`; hàng nhập: `[Container, Mẫu]`. Tính trong **cùng một vòng đếm** với `photo_count`/`photo_total` nên `sum(count)` và `sum(total)` **luôn khớp**. Chưa có hồ sơ → `[]`. |
| `created_by_name` (CreateQC, trường 9) | Đã đọc và lưu; app hiện "Mở hồ sơ: <tên> (checklist)" ở đầu hồ sơ. |

Lưu ý ngưỡng **80%** bên checklist là của các bạn; nút "Hoàn tất QC" trong App QC chỉ bật khi **100%** — hai việc độc lập.

Kết quả `grpcurl` mong đợi (hàng xuất, 1 đợt, đã hoàn tất):

```json
{
  "photoCount": 27, "done": true, "photoTotal": 27,
  "fileUrl": "https://ago-qc.netlify.app/qc/3f2a…",
  "doneAt": "1789542123456", "doneBy": "Trần Thị B",
  "groups": [ { "name": "QC ngày", "count": 6, "total": 6 }, { "name": "Container", "count": 21, "total": 21 } ]
}
```

## 4c. `SyncOrderInfo` — đồng bộ thông tin đơn sang hồ sơ QC (PLAN-0043)

Checklist **đẩy** thông tin đơn sang hồ sơ QC **đã có**, một chiều đơn → QC (đơn là nguồn sự thật).
QC viên nhập thông tin ở đơn một lần, các ô trùng bên "Thông tin lô hàng" tự cập nhật.

9 ô **do đơn sở hữu**: `customer`, `product_name`, `specification`, `quantity` (→ SL), `unit`, `supplier`,
`container_no`, `seal_no`, `container_loading_date`. Các ô khác (`po_no`, `supplier_code`, `contract_no`,
`est_finish_date`, `qc_staff`...) **không** thuộc RPC này.

| Quy tắc | Hành vi |
|---|---|
| Giá trị rỗng / toàn khoảng trắng | **Bỏ qua**, không bao giờ xoá ô bên QC. Giá trị có chữ được `trim` trước khi so/ghi. |
| `only_fill_empty = true` | Lần đồng bộ đầu, **chỉ áp cho 4 ô** QC có thể đã gõ tay vì trước đây không có nguồn từ đơn: `supplier`, `container_no`, `seal_no`, `container_loading_date` — chỉ ghi khi ô QC đang trống (NULL, `''` hoặc toàn khoảng trắng), không đè chữ QC viên đã gõ. |
| 5 ô còn lại (`customer`, `product_name`, `specification`, `quantity`, `unit`) | **Luôn** ghi khi giá trị đơn có chữ và **khác** giá trị hiện tại, kể cả lần đầu (các ô này vốn do đơn gieo lúc `CreateQC`, nên hồ sơ tạo trước khi đơn được sửa không kẹt giá trị cũ). |
| `only_fill_empty = false` | Cả 9 ô: ghi ô nào **khác** giá trị hiện tại (đơn thắng). |
| Không ô nào đổi | **Không** chạy UPDATE, không đổi `updated_at` (`updated=false`) — gọi lại bao nhiêu lần cũng vô hại. |
| Hồ sơ chưa có cho `order_id` | `file_found=false` (không phải lỗi). |
| Hồ sơ đã **Hoàn tất QC** (đang khoá, cùng luật với các thao tác sửa trong app) | `locked=true`, **không ghi**. QC "Mở lại" hồ sơ thì lần gọi sau sẽ ghi. |
| `container_loading_date` | `yyyy-MM-dd` (giờ VN) hoặc `""`. Sai định dạng / không phải ngày thật → `INVALID_ARGUMENT`. |
| Chuỗi chứa ký tự NUL (U+0000) | `INVALID_ARGUMENT` (Postgres TEXT không lưu được); thử lại cũng vô ích. |

**Cờ `QC_ORDER_FIELDS_READONLY`** (biến môi trường của **App QC**, mặc định **TẮT**; bật bằng `true`/`1`/`yes`/`on`):
- **Tắt**: HTTP `updateQCFile` chạy y như trước đây cho mọi hồ sơ.
- **Bật**: với hồ sơ có `order_id`, 9 ô trên là **chỉ-đọc** — `updateQCFile` âm thầm bỏ các khoá đó khỏi payload, nên
  snapshot cũ của frontend không thể đè giá trị đơn vừa đẩy sang. Hồ sơ tạo tay (không `order_id`) giữ nguyên hành vi cũ.
- `SyncOrderInfo` **không** bị cờ này chi phối.
- Owner chỉ bật cờ **sau khi đợt đồng bộ đầu đã chạy xong** (checklist bật `QC_SYNC_ENABLED`, mọi hồ sơ có `qc_synced_at`).
  Bật sớm hơn thì chữ QC gõ vào 9 ô bị bỏ mà chưa có gì điền thay.

```bash
grpcurl -plaintext -proto proto/qc/v1/qc.proto \
  -H "x-api-key: $QC_APP_API_KEY" \
  -d '{"order_id": 2, "supplier": "Nhà đóng gói A", "container_no": "MSKU1234567", "container_loading_date": "2026-10-05", "only_fill_empty": true}' \
  ago-qc-backend:50051 ago.qc.v1.QCService/SyncOrderInfo
```

---

## 5. Gọi từ Go (mẫu)

```go
import (
    "context"
    "os"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/credentials/insecure"
    "google.golang.org/grpc/metadata"

    "github.com/ago/ago-backend-checklist/internal/qcpb"
)

conn, err := grpc.NewClient(os.Getenv("QC_APP_GRPC_ADDR"),
    grpc.WithTransportCredentials(insecure.NewCredentials())) // plaintext, mạng riêng Render
if err != nil { /* ... */ }
client := qcpb.NewQCServiceClient(conn)

func withAuth(ctx context.Context) (context.Context, context.CancelFunc) {
    ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
    return metadata.AppendToOutgoingContext(ctx, "x-api-key", os.Getenv("QC_APP_API_KEY")), cancel
}

// Khi đơn vào bước Sản xuất:
ctx, cancel := withAuth(context.Background())
defer cancel()
res, err := client.CreateQC(ctx, &qcpb.CreateQCRequest{
    OrderId: order.ID, PoNo: order.PO, ProductName: order.Product,
    Specification: order.Spec, Quantity: order.Qty, Unit: order.Unit,
    Customer: order.Customer, ContractNo: order.Contract,
})
// res.QcFileId, res.LotCode, res.Created

// Khi người dùng bấm "Sản xuất xong" (code hiện có của các bạn giữ nguyên):
st, err := client.GetStatus(ctx, &qcpb.GetStatusRequest{OrderId: order.ID})
// st.Done, st.PhotoCount
```

---

## 6. Tự kiểm tra

Cổng 50051 **chỉ tới được từ trong mạng riêng Render**, nên chạy `grpcurl` từ **shell của `ago-order-api`**
(Render → service → Shell), không chạy từ máy cá nhân:

```bash
# Tạo hồ sơ cho đơn 2 (gọi 2 lần: lần 2 phải trả created=false, cùng qcFileId)
grpcurl -plaintext -proto proto/qc/v1/qc.proto \
  -H "x-api-key: $QC_APP_API_KEY" \
  -d '{"order_id": 2, "po_no": "AGO2609", "product_name": "Thanh long", "customer": "Vcare Fresh"}' \
  ago-qc-backend:50051 ago.qc.v1.QCService/CreateQC

# Hỏi trạng thái
grpcurl -plaintext -proto proto/qc/v1/qc.proto \
  -H "x-api-key: $QC_APP_API_KEY" \
  -d '{"order_id": 2}' \
  ago-qc-backend:50051 ago.qc.v1.QCService/GetStatus
```

Kết quả mong đợi:

```json
{ "qcFileId": "…uuid…", "lotCode": "QC-AGO2609-20260915", "created": true }
{ "photoCount": 0, "done": false }
```

Sau đó mở App QC (`https://ago-qc.netlify.app`) sẽ thấy hồ sơ có nhãn **"Đơn #2"**.

Phía App QC xác nhận server đã bật qua log của `ago-qc-backend`:
```
[gRPC] QCService đang nghe ở cổng 50051 (mạng riêng, plaintext)
```

---

## 7. Checklist bàn giao

**Phía App QC (đã xong):**
- [x] `GetStatus` + `CreateQC` theo proto ở mục 2, kiểm `x-api-key`, log mỗi call
- [x] Cột `order_id` (unique) + nút "Hoàn tất QC" trong app
- [x] `QC_APP_API_KEY`, `QC_GRPC_PORT=50051` đặt trên `ago-qc-backend`
- [ ] `ago-qc-backend` gói Starter (gói free **không nhận** kết nối mạng riêng)

**Phía checklist (Go):**
- [ ] Thay proto bằng bản mục 2, gen lại `qcpb`
- [ ] Gọi `CreateQC` khi đơn vào bước Sản xuất (idempotent, gọi lại vô hại)
- [ ] Đặt `QC_APP_GRPC_ADDR`, `QC_APP_API_KEY` trên `ago-order-api`
- [ ] Không cache `done = true` (QC có thể mở lại hồ sơ)
- [ ] Chạy `grpcurl` mục 6 từ shell `ago-order-api`, cả 2 RPC trả đúng

**Quy tắc chung:** không đổi/dùng lại số thứ tự trường trong proto; thêm trường → dùng số mới.
Muốn thêm trường vào `CreateQCRequest` (vd ngày dự kiến xuất) → báo phía QC, thêm số 9, 10…
