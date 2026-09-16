// Tầng làm việc với Supabase Storage (lưu ảnh + PDF).
import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
});

// Tách dataURL base64 -> { mime, buffer }
function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:(.+);base64,(.*)$/);
  if (!m) throw new Error('dataUrl không hợp lệ');
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64') };
}

// Upload ảnh từ dataURL -> trả { path, url }
export async function uploadDataUrl(bucket, path, dataUrl) {
  const { mime, buffer } = parseDataUrl(dataUrl);
  return uploadBuffer(bucket, path, buffer, mime);
}

// Upload một buffer bất kỳ (ví dụ PDF) -> trả { path, url }
export async function uploadBuffer(bucket, path, buffer, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error('Upload Storage thất bại: ' + error.message);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

// Tải file từ Storage rồi đổi thành dataURL base64 (để nhúng ảnh vào PDF).
// Tải file về dạng Buffer (bytes thô).
export async function downloadBuffer(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error('Tải ảnh thất bại: ' + error.message);
  return Buffer.from(await data.arrayBuffer());
}

// Tải file qua URL PUBLIC (đi qua CDN — nhanh hơn Storage API vài lần, nhất là file đã được app xem qua).
// Bucket không public / CDN trả lỗi -> tự quay về Storage API (downloadBuffer).
export async function downloadPublicBuffer(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  try {
    const res = await fetch(data.publicUrl);
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  } catch (e) { /* lỗi mạng -> thử Storage API */ }
  return downloadBuffer(bucket, path);
}

export async function downloadAsDataUrl(bucket, path) {
  const buffer = await downloadBuffer(bucket, path);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

// Xóa một hoặc nhiều file khỏi Storage (dùng khi xóa ảnh / xóa hồ sơ).
export async function removeFiles(bucket, paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.storage.from(bucket).remove(list);
  if (error) throw new Error('Xóa file Storage thất bại: ' + error.message);
}

// Xóa toàn bộ file trong một "thư mục" (Supabase không có folder thật, nên list rồi xóa).
export async function removeFolder(bucket, folder) {
  const { data, error } = await supabase.storage.from(bucket).list(folder);
  if (error || !data || !data.length) return;
  const paths = data.map((file) => `${folder}/${file.name}`);
  await supabase.storage.from(bucket).remove(paths);
}
