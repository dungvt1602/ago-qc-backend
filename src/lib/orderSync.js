// Đồng bộ thông tin ĐƠN -> hồ sơ QC (gRPC SyncOrderInfo, PLAN-0043 bên checklist).
// File này THUẦN (không DB, không mạng) để test được từng ca. Hai việc:
//   1) khai báo MỘT danh sách duy nhất các ô "do đơn sở hữu";
//   2) hàm quyết định ô nào cần ghi (selectFieldsToWrite).
import grpc from '@grpc/grpc-js';

// 9 ô của mục "Thông tin lô hàng" mà ĐƠN là nguồn sự thật.
//   key = tên trường frontend (camelCase, cùng khoá với FIELD_MAP của qcFiles.service)
//   col = cột trong bảng qc_files
// Danh sách này dùng cho CẢ HAI việc, để không bao giờ lệch nhau:
//   - gRPC SyncOrderInfo: chỉ xét các ô này;
//   - HTTP updateQCFile: với hồ sơ có order_id thì BỎ các khoá này khỏi payload (ô chỉ-đọc).
// KHÔNG nằm trong đây: po_no, supplier_code, production_order, standard_appendix, est_finish_date,
// contract_no, qc_staff, start_date — các ô đó QC tự nhập hoặc đã có luồng riêng.
export const ORDER_OWNED_FIELDS = Object.freeze([
  Object.freeze({ key: 'customer', col: 'customer' }),
  Object.freeze({ key: 'productName', col: 'product_name' }),
  Object.freeze({ key: 'specification', col: 'specification' }),
  Object.freeze({ key: 'poQuantity', col: 'po_quantity' }),
  Object.freeze({ key: 'unit', col: 'unit' }),
  Object.freeze({ key: 'supplier', col: 'supplier' }),
  Object.freeze({ key: 'containerNo', col: 'container_no' }),
  Object.freeze({ key: 'sealNo', col: 'seal_no' }),
  Object.freeze({ key: 'containerLoadingDate', col: 'container_loading_date', date: true }),
]);

export const ORDER_OWNED_KEYS = Object.freeze(ORDER_OWNED_FIELDS.map((f) => f.key));

// Lỗi do dữ liệu gửi sang sai (không phải lỗi App QC). Mang grpcCode để wrapper rpc() trả đúng mã.
export class InvalidOrderInfoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InvalidOrderInfoError';
    this.grpcCode = grpc.status.INVALID_ARGUMENT;
  }
}

// yyyy-MM-dd và là NGÀY CÓ THẬT (loại 2026-02-30, 2026-13-01, năm 0000).
export function isValidIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1) return false; // Postgres không có năm 0000
  const dt = new Date(0);
  dt.setUTCFullYear(y, mo - 1, d); // setUTCFullYear (không phải Date.UTC) để năm < 100 không bị đổi thành 19xx
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Chuẩn hoá giá trị gửi sang: mọi ô thành chuỗi đã trim ('' = "đơn chưa có thông tin").
// Chỉ trả về 9 ô do đơn sở hữu; ô lạ bị bỏ. Ngày sai định dạng -> InvalidOrderInfoError.
// Idempotent: chuẩn hoá lại kết quả cho ra đúng kết quả đó.
export function normalizeOrderInfo(info) {
  const src = info || {};
  const out = {};
  for (const f of ORDER_OWNED_FIELDS) {
    const raw = src[f.key];
    const v = raw === undefined || raw === null ? '' : String(raw).trim();
    if (f.date && v !== '' && !isValidIsoDate(v)) {
      throw new InvalidOrderInfoError('container_loading_date phải là ngày hợp lệ dạng yyyy-MM-dd hoặc để trống');
    }
    out[f.key] = v;
  }
  return out;
}

// Ô hiện tại của hồ sơ có "trống" không? NULL, '' hoặc toàn khoảng trắng đều là trống.
function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

// QUYẾT ĐỊNH ô nào cần ghi. Đầu vào:
//   current : dòng hiện tại của hồ sơ (khoá = tên cột; ngày ở dạng 'YYYY-MM-DD' hoặc null)
//   info    : thông tin từ đơn (khoá = key camelCase của ORDER_OWNED_FIELDS)
//   onlyFillEmpty : true = lần đồng bộ ĐẦU, chỉ điền ô QC còn trống (không đè thứ QC đã gõ tay)
// Trả về { [cột]: giá trị } — chỉ những cột THẬT SỰ đổi. Rỗng = không có gì để ghi (đừng chạy UPDATE).
// Luật:
//   - giá trị rỗng từ đơn KHÔNG BAO GIỜ ghi (không xoá dữ liệu bên QC);
//   - onlyFillEmpty: chỉ ghi vào ô hiện đang trống;
//   - ngược lại: ghi khi khác giá trị hiện tại (đơn thắng).
export function selectFieldsToWrite(current, info, { onlyFillEmpty = false } = {}) {
  const incoming = normalizeOrderInfo(info);
  const row = current || {};
  const updates = {};
  for (const f of ORDER_OWNED_FIELDS) {
    const next = incoming[f.key];
    if (next === '') continue;
    const cur = row[f.col];
    if (onlyFillEmpty) {
      if (!isBlank(cur)) continue;
    } else if (cur !== undefined && cur !== null && String(cur) === next) {
      continue;
    }
    updates[f.col] = next;
  }
  return updates;
}

// HTTP updateQCFile: bỏ các khoá do đơn sở hữu khỏi payload. Trả bản sao nông, KHÔNG sửa payload gốc.
export function stripOrderOwnedKeys(payload) {
  const out = { ...payload };
  for (const key of ORDER_OWNED_KEYS) delete out[key];
  return out;
}
