// Logic xuất PDF: gom dữ liệu, tải ảnh SONG SONG, render, upload, lưu link.
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import { getQCFile } from './qcFiles.service.js';
import { downloadAsDataUrl, uploadBuffer } from '../lib/storage.js';
import { renderPdf } from '../pdf/generate.js';
import { config } from '../config/env.js';
import { DAILY_ITEMS } from '../data/catalog.js';
import { query } from '../lib/db.js';
import { chunk, sanitizeFileName } from '../lib/util.js';

async function getSettings() {
  const rows = await query('SELECT key, value FROM settings');
  const out = {};
  rows.forEach((r) => { out[r.key] = r.value; });
  return out;
}

export async function exportPDF(qcFileId) {
  // Lấy dữ liệu hồ sơ và cấu hình công ty cùng lúc.
  const [data, settings] = await Promise.all([getQCFile(qcFileId), getSettings()]);
  data.settings = settings;

  // Gom tất cả ảnh cần nhúng (daily + container) có đường dẫn Storage.
  const photoItems = [];
  data.dailySessions.forEach((s) => s.items.forEach((it) => { if (it.PHOTO_PATH) photoItems.push(it); }));
  data.containerItems.forEach((it) => { if (it.PHOTO_PATH) photoItems.push(it); });

  // TỐI ƯU LỚN NHẤT: tải TẤT CẢ ảnh cùng lúc thay vì lần lượt từng cái.
  await Promise.all(
    photoItems.map(async (it) => {
      try {
        it.PHOTO_RENDER_URL = await downloadAsDataUrl(config.photoBucket, it.PHOTO_PATH);
      } catch {
        it.PHOTO_RENDER_URL = ''; // ảnh lỗi thì hiện ô trống, không làm hỏng cả PDF
      }
    })
  );

  // Gắn nhãn ảnh cho từng hạng mục QC ngày.
  data.dailySessions.forEach((s) =>
    s.items.forEach((it) => {
      const def = DAILY_ITEMS.find((d) => d.code === it.ITEM_CODE);
      it.photoLabel = def ? def.photoLabel : '';
    })
  );

  // Chia ảnh container thành các trang 9 ảnh, tính tổng số trang.
  data.containerChunks = chunk(data.containerItems, 9);
  data.totalPages = 1 + data.dailySessions.length + data.containerChunks.length;

  const pdfBuffer = await renderPdf(data);

  const name = sanitizeFileName(data.qcFile.LOT_CODE || data.qcFile.QC_FILE_NO || `AGO_QC_${Date.now()}`);
  const uploaded = await uploadBuffer(config.pdfBucket, `${name}_${Date.now()}.pdf`, pdfBuffer, 'application/pdf');

  await qcFilesRepo.update(qcFileId, { status: 'EXPORTED', pdf_url: uploaded.url });
  return getQCFile(qcFileId);
}
