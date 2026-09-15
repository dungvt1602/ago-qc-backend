// Điểm khởi động backend: bật Express, CORS, nạp route, bắt lỗi tổng.
import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import apiRouter from './routes/api.js';
import { closeBrowser } from './pdf/generate.js';
import { startGrpc, stopGrpc } from './grpc/server.js';
import { pdfImageHandler } from './pdf/images.js';

const app = express();

// CORS: '*' = cho phép tất cả (lúc test). Khi deploy nên đặt domain Netlify cụ thể.
const origin = config.corsOrigin.includes('*') ? true : config.corsOrigin;
app.use(cors({ origin }));

// Ảnh gửi lên dạng base64 có thể lớn -> nâng giới hạn body.
app.use(express.json({ limit: '25mb' }));

// Kiểm tra sức khỏe server.
app.get('/', (req, res) => {
  const mem = process.memoryUsage();
  res.json({
    ok: true, service: 'AGO QC Backend', time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),           // vừa restart? (Render free hay bị kill)
    rssMb: Math.round(mem.rss / 1048576),              // RAM Node đang dùng (Render 512MB tổng, kể cả Chrome)
    heapMb: Math.round(mem.heapUsed / 1048576),        // phần JS (V8) - dọn được bằng GC
    nativeMb: Math.round((mem.external + mem.arrayBuffers) / 1048576), // Buffer/ảnh/sharp - ngoài heap
    grpc: Boolean(config.qcAppApiKey),                 // gRPC có bật không
  });
});

// Toàn bộ API ở POST /api
app.use('/api', apiRouter);

// Ảnh cho Chrome in PDF — chỉ nhận từ 127.0.0.1 kèm token, bên ngoài gọi sẽ bị 403.
app.get('/pdf-img', pdfImageHandler);

// Bắt lỗi không lường trước.
app.use((err, req, res, next) => {
  console.error('Lỗi server:', err);
  res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
});

// Bật HTTP TRƯỚC, gRPC SAU: Render lấy cổng mở đầu tiên làm cổng web công khai.
let grpcServer = null;
const server = app.listen(config.port, async () => {
  console.log(`AGO QC Backend đang chạy ở http://localhost:${config.port}`);
  try {
    grpcServer = await startGrpc();
  } catch (err) {
    console.error('[gRPC] Không bật được:', err); // HTTP vẫn chạy bình thường
  }
});

// Đóng gọn gàng khi tắt server (Ctrl+C / Render restart).
async function shutdown() {
  console.log('Đang tắt server...');
  await Promise.all([closeBrowser(), stopGrpc(grpcServer)]);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
