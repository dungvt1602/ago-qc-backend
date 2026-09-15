// Router chính: nhận POST { action, payload } và điều phối tới đúng service.
// Giữ nguyên "hợp đồng" cũ (trả { ok, result }) để frontend gần như không phải sửa.
import express from 'express';
import { config } from '../config/env.js';
import * as qcFiles from '../services/qcFiles.service.js';
import * as daily from '../services/daily.service.js';
import * as container from '../services/container.service.js';
import * as photos from '../services/photos.service.js';
import * as pdf from '../services/pdf.service.js';
import * as samples from '../services/samples.service.js';
import * as completion from '../services/completion.service.js';

const router = express.Router();

// Các action làm THAY ĐỔI hồ sơ -> bị chặn khi hồ sơ đã Hoàn tất QC (xem completion.service.js).
// exportPDF, getQCFile, reopenQC... không nằm trong danh sách này.
const LOCKED_WHEN_DONE = new Set([
  'updateQCFile', 'updateSummary', 'addDailyQC', 'saveDailyQCItem', 'saveContainerItem',
  'uploadPhoto', 'deleteQCFile', 'updateDailyQC', 'deleteDailyQC', 'deletePhoto',
  'addSample', 'deleteSample',
]);

// Bảng tra: action -> hàm xử lý. payload đã được tách sẵn.
const handlers = {
  setupInfo: () => qcFiles.setupInfo(),
  listQCFiles: () => qcFiles.listQCFiles(),
  createQCFile: (p) => qcFiles.createQCFile(p),
  getQCFile: (p) => qcFiles.getQCFile(p.qcFileId),
  updateQCFile: (p) => qcFiles.updateQCFile(p),
  updateSummary: (p) => qcFiles.updateSummary(p),
  addDailyQC: (p) => daily.addDailyQC(p),
  saveDailyQCItem: (p) => daily.saveDailyQCItem(p),
  saveContainerItem: (p) => container.saveContainerItem(p),
  uploadPhoto: (p) => photos.uploadPhoto(p),
  exportPDF: (p) => pdf.exportPDF(p.qcFileId, p.variant),
  deleteQCFile: (p) => qcFiles.deleteQCFile(p.qcFileId),
  updateDailyQC: (p) => daily.updateDailyQC(p),
  deleteDailyQC: (p) => daily.deleteDailyQC(p),
  deletePhoto: (p) => photos.deletePhoto(p),
  addSample: (p) => samples.addSample(p),
  deleteSample: (p) => samples.deleteSample(p),
  completeQC: (p) => completion.completeQC(p),
  reopenQC: (p) => completion.reopenQC(p),
};

router.post('/', async (req, res) => {
  const { action, payload = {}, secret } = req.body || {};
  try {
    // Kiểm tra secret nếu được cấu hình (để trống = bỏ qua, tiện cho lúc test).
    if (config.apiSecret && secret !== config.apiSecret) {
      return res.status(401).json({ ok: false, error: 'Sai hoặc thiếu secret' });
    }
    const handler = handlers[action];
    if (!handler) throw new Error('Action không hợp lệ: ' + action);

    if (LOCKED_WHEN_DONE.has(action)) await completion.assertEditable(payload);
    const result = await handler(payload);
    res.json({ ok: true, result });
  } catch (err) {
    // Lỗi nghiệp vụ (không tìm thấy, sai tham số...) -> 400 kèm thông báo rõ ràng.
    res.status(400).json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
});

export default router;
