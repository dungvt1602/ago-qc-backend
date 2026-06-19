// Đọc và kiểm tra biến môi trường ở MỘT nơi duy nhất.
// Nếu thiếu biến bắt buộc, app dừng ngay lúc khởi động (fail fast) thay vì lỗi mơ hồ sau này.
import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}. Hãy kiểm tra file .env`);
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 8080,
  databaseUrl: required('DATABASE_URL'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
  photoBucket: process.env.PHOTO_BUCKET || 'qc-photos',
  pdfBucket: process.env.PDF_BUCKET || 'qc-pdfs',
  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),
  apiSecret: process.env.API_SECRET || '',
};
