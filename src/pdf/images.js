// Ảnh cho PDF: Chrome KHÔNG nhận ảnh nhúng base64 mà tự tải từng tấm qua GET /pdf-img
// (chỉ nhận kết nối nội bộ 127.0.0.1 + token ngẫu nhiên). Node chỉ CHUYỂN TIẾP bytes gốc từ Storage,
// không xử lý ảnh -> RAM Node đứng yên ~100MB dù hồ sơ bao nhiêu ảnh.
// (Đã thử thu nhỏ ảnh bằng sharp ở đây: libvips giữ lại ~170MB sau khi xong -> phản tác dụng trên máy 512MB.)
import crypto from 'node:crypto';
import { downloadBuffer } from '../lib/storage.js';
import { config } from '../config/env.js';

const TOKEN = crypto.randomBytes(16).toString('hex'); // đổi mỗi lần server chạy

// URL để đặt vào <img src> trong HTML. path = đường dẫn trong bucket ảnh.
export function pdfImageUrl(path) {
  return `http://127.0.0.1:${config.port}/pdf-img?t=${TOKEN}&p=${encodeURIComponent(path)}`;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Handler Express cho GET /pdf-img. Từ chối mọi thứ không phải Chrome nội bộ.
export async function pdfImageHandler(req, res) {
  if (!LOOPBACK.has(req.socket.remoteAddress) || req.query.t !== TOKEN) return res.status(403).end();
  const path = String(req.query.p || '');
  if (!path || path.includes('..')) return res.status(400).end();
  try {
    const buf = await downloadBuffer(config.photoBucket, path);
    // CORS: để Chrome (trang about:blank) được vẽ ảnh lên canvas mà thu nhỏ. Cache 1 phút: ảnh được nạp 2 lần
    // (hiển thị + nạp lại kiểu anonymous) -> lần 2 lấy từ cache, không tải lại từ Storage.
    res.set('Content-Type', 'image/jpeg').set('Access-Control-Allow-Origin', '*').set('Cache-Control', 'private, max-age=60').send(buf);
  } catch (err) {
    console.warn('[PDF] Không tải được ảnh', path, err.message);
    res.status(404).end(); // ô ảnh trống, PDF vẫn ra
  }
}
