// Các tiện ích nhỏ dùng chung. Mọi mốc thời gian dùng múi giờ Việt Nam.
const TZ = 'Asia/Ho_Chi_Minh';

// 'YYYY-MM-DD' theo giờ VN
export function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

// 'YYYY-MM-DD HH:MM:SS' theo giờ VN (locale sv-SE cho đúng định dạng này)
export function nowStr() {
  return new Date().toLocaleString('sv-SE', { timeZone: TZ });
}

// 'yyyyMMdd' theo giờ VN — dùng cho mã lô
export function dateCompact() {
  return todayStr().replace(/-/g, '');
}

// Chuẩn hóa mã (PO) thành chữ in hoa, chỉ giữ A-Z 0-9 và dấu gạch
export function sanitizeCode(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'NOPO';
}

// Làm sạch tên file (bỏ ký tự không hợp lệ)
export function sanitizeFileName(s) {
  return String(s || 'file').replace(/[\\/:*?"<>|]/g, '-').slice(0, 160);
}

// Cắt mảng thành từng nhóm kích thước size
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
