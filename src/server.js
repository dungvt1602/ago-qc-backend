// Điểm khởi động backend: bật Express, CORS, nạp route, bắt lỗi tổng.
import express from 'express';
import cors from 'cors';
import { config } from './config/env.js';
import apiRouter from './routes/api.js';
import { closeBrowser } from './pdf/generate.js';

const app = express();

// CORS: '*' = cho phép tất cả (lúc test). Khi deploy nên đặt domain Netlify cụ thể.
const origin = config.corsOrigin.includes('*') ? true : config.corsOrigin;
app.use(cors({ origin }));

// Ảnh gửi lên dạng base64 có thể lớn -> nâng giới hạn body.
app.use(express.json({ limit: '25mb' }));

// Kiểm tra sức khỏe server.
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'AGO QC Backend', time: new Date().toISOString() });
});

// Toàn bộ API ở POST /api
app.use('/api', apiRouter);

// Bắt lỗi không lường trước.
app.use((err, req, res, next) => {
  console.error('Lỗi server:', err);
  res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
});

const server = app.listen(config.port, () => {
  console.log(`AGO QC Backend đang chạy ở http://localhost:${config.port}`);
});

// Đóng gọn gàng khi tắt server (Ctrl+C / Render restart).
async function shutdown() {
  console.log('Đang tắt server...');
  await closeBrowser();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
