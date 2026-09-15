// Tải ảnh từ Storage và THU NHỎ trước khi nhúng vào PDF.
// Lý do: Chrome phải giải nén mỗi ảnh thành điểm ảnh khi in (1280x960 ≈ 5MB RAM/ảnh).
// Thu về 1024px giảm ~36% RAM lúc in và PDF nhẹ hơn; ô ảnh trên A4 chỉ ~6cm nên vẫn dư nét.
import sharp from 'sharp';
import { downloadBuffer } from '../lib/storage.js';

export const PDF_PHOTO_MAX_SIDE = 1024;
const JPEG_QUALITY = 72;

export async function downloadPhotoForPdf(bucket, path) {
  const original = await downloadBuffer(bucket, path);
  let out;
  try {
    out = await sharp(original)
      .rotate() // tôn trọng EXIF nếu có (ảnh app đã xoay sẵn, gọi thêm cũng vô hại)
      .resize({ width: PDF_PHOTO_MAX_SIDE, height: PDF_PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (e) {
    out = original; // ảnh lạ không xử lý được -> dùng nguyên bản, không làm hỏng PDF
  }
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

// Chạy song song nhưng GIỚI HẠN số việc cùng lúc (mỗi ảnh giải nén tốn RAM tạm thời).
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
