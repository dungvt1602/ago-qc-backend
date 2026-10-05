// Đọc và kiểm tra biến môi trường ở MỘT nơi duy nhất.
// Nếu thiếu biến bắt buộc, app dừng ngay lúc khởi động (fail fast) thay vì lỗi mơ hồ sau này.
import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}. Hãy kiểm tra file .env`);
  return value;
}

// Cờ bật/tắt: true/1/yes/on (không phân biệt hoa thường) = bật; thiếu hoặc giá trị khác = TẮT.
function flag(name) {
  return /^(true|1|yes|on)$/i.test(String(process.env[name] || '').trim());
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

  // gRPC cho backend checklist gọi sang (mạng riêng Render). Khóa để TRỐNG = không bật gRPC,
  // tránh vô tình mở một cổng không xác thực.
  grpcPort: Number(process.env.QC_GRPC_PORT) || 50051,
  qcAppApiKey: process.env.QC_APP_API_KEY || '',
  // Địa chỉ frontend (Next.js), để gRPC trả file_url = <url>/qc/<id> mở thẳng hồ sơ cho checklist.
  qcAppUrl: (process.env.QC_APP_URL || 'https://ago-qc.netlify.app').replace(/\/+$/, ''),

  // Đồng bộ thông tin đơn (PLAN-0043): BẬT thì với hồ sơ có order_id, HTTP updateQCFile bỏ âm thầm 9 ô do đơn
  // sở hữu (supplier, container_no, seal_no, container_loading_date, customer, product_name, specification,
  // po_quantity, unit). Mặc định TẮT — chỉ bật SAU KHI đợt đồng bộ đầu từ checklist đã chạy xong, nếu không
  // chữ QC gõ vào bị bỏ mà chưa có gì điền thay. SyncOrderInfo (gRPC) KHÔNG bị cờ này chi phối.
  orderFieldsReadonly: flag('QC_ORDER_FIELDS_READONLY'),
};
