# Bàn giao gRPC: App QC ↔ Backend checklist

Tài liệu cho đội backend checklist (Go). Bổ sung cho `docs/qc-app-grpc-contract.md` phía các bạn:
App QC **đã implement xong** `GetStatus` như hợp đồng, và **đề xuất thêm 1 RPC `CreateQC`** để hai bên
khớp đơn với nhau tự động (xem mục 3 — vì sao bắt buộc phải có).

---

## 1. Kết nối

Hai backend nằm **cùng workspace Render, cùng region Singapore** → dùng **mạng riêng Render**,
đúng kịch bản "plaintext nội bộ" trong tài liệu của các bạn. Không TLS, cổng không public ra Internet.

| | Giá trị |
|---|---|
| Địa chỉ | `ago-qc-backend:50051` (tên service = hostname nội bộ) |
| Giao thức | gRPC plaintext (`insecure`) |
| Xác thực | metadata `x-api-key: <khóa>` trên **mọi** call — thiếu/sai → `UNAUTHENTICATED` |
| Deadline khuyến nghị | 3 giây (`GetStatus` thực tế < 100 ms) |

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
```

Tên RPC trên đường dây: `/ago.qc.v1.QCService/GetStatus` và `/ago.qc.v1.QCService/CreateQC`.

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
| `product_name`, `specification`, `quantity`, `unit`, `customer`, `contract_no` | Điền sẵn vào mục "Thông tin lô hàng". QC viên sửa được sau. Đều được phép trống. |

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
