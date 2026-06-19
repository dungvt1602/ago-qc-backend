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

// Làm sạch tên file / khóa Storage.
// Supabase Storage KHÔNG nhận ký tự có dấu (tiếng Việt) hay ký tự lạ -> báo "Invalid key".
// Vì vậy: bỏ dấu, đổi đ/Đ, rồi chỉ giữ A-Z a-z 0-9 . _ -
export function sanitizeFileName(s) {
  const ascii = String(s || 'file')
    .normalize('NFD').replace(/\p{M}/gu, '') // tách và bỏ dấu (Ả->A, Ợ->O...)
    .replace(/đ/g, 'd').replace(/Đ/g, 'D');
  return ascii
    .replace(/[^A-Za-z0-9._-]+/g, '-') // mọi ký tự còn lại không an toàn -> gạch ngang
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 160) || 'file';
}

// Cắt mảng thành từng nhóm kích thước size
export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
