// Logic xuất PDF: gom dữ liệu hồ sơ, dựng PDF (pdfmake, ảnh tải từ Storage), upload, lưu link.
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import { getQCFile } from './qcFiles.service.js';
import { uploadBuffer, downloadPublicBuffer } from '../lib/storage.js';
import { renderPdf } from '../pdf/generate.js';
import { config } from '../config/env.js';
import { DAILY_ITEMS, CONTAINER_ITEMS } from '../data/catalog.js';
import { query } from '../lib/db.js';
import { chunk, sanitizeFileName } from '../lib/util.js';

async function getSettings() {
  const rows = await query('SELECT key, value FROM settings');
  const out = {};
  rows.forEach((r) => { out[r.key] = r.value; });
  return out;
}

export async function exportPDF(qcFileId, variant = 'internal') {
  const t0 = Date.now();
  // Lấy dữ liệu hồ sơ và cấu hình công ty cùng lúc.
  const [data, settings] = await Promise.all([getQCFile(qcFileId), getSettings()]);
  data.settings = settings;

  // Gắn nhãn ảnh + chữ TIẾNG ANH (bản khách hàng) cho từng hạng mục QC.
  // Lấy từ danh mục chứ không lấy từ DB: bản ghi cũ lưu chữ tiếng Anh cũ, danh mục mới là bản chuẩn.
  data.dailySessions.forEach((s) =>
    s.items.forEach((it) => {
      const def = DAILY_ITEMS.find((d) => d.code === it.ITEM_CODE);
      it.photoLabel = def ? def.photoLabel : '';
      it.EN_TITLE = def ? (def.enFull || def.en) : it.ITEM_NAME_EN;
    })
  );

  const isImportFile = data.qcFile.QC_TYPE === 'IMPORT';
  data.containerItems.forEach((it, idx) => {
    const def = CONTAINER_ITEMS.find((c) => c.no === Number(it.PHOTO_NO));
    let title = def ? (def.enFull || def.en) : it.ITEM_NAME_EN;
    // Hàng nhập chỉ dùng ảnh 13-21 nhưng hiển thị lại là 1-9 -> đánh số lại trong tiêu đề.
    if (isImportFile) title = String(title).replace(/^(PHOTO\s*)\d+/i, `$1${idx + 1}`);
    it.EN_TITLE = title;
  });

  // Chia ảnh container thành các trang 9 ảnh (khuôn hàng xuất + khách hàng; khuôn hàng nhập tự chia 6 ảnh/trang).
  data.containerChunks = chunk(data.containerItems, 9);
  // Hàng nhập: đưa ảnh container lên TRƯỚC phần QC ngày trong PDF.
  data.containerFirst = isImportFile;

  // Ảnh lấy theo PHOTO_PATH qua URL public (CDN); khuôn (nội bộ theo loại hồ sơ / khách hàng) chọn trong renderPdf.
  const isEn = variant === 'en';
  const pdfBuffer = await renderPdf(data, {
    variant: isEn ? 'en' : 'internal',
    loadPhoto: (path) => downloadPublicBuffer(config.photoBucket, path),
  });

  // Tên file CỐ ĐỊNH theo hồ sơ + ngôn ngữ -> lần xuất sau GHI ĐÈ file cũ (không tích rác).
  const name = sanitizeFileName(data.qcFile.LOT_CODE || data.qcFile.QC_FILE_NO || 'AGO_QC');
  const filePath = `${qcFileId}/${name}${isEn ? '_EN' : '_VN'}.pdf`;
  const tUp = Date.now();
  const uploaded = await uploadBuffer(config.pdfBucket, filePath, pdfBuffer, 'application/pdf');
  console.log(`[PDF] ${variant}: upload ${(pdfBuffer.length / 1048576).toFixed(1)}MB ${((Date.now() - tUp) / 1000).toFixed(1)}s, tổng ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Thêm ?t= để trình duyệt/CDN luôn lấy bản mới (file bị ghi đè nhưng URL gốc không đổi).
  const freshUrl = `${uploaded.url}?t=${Date.now()}`;
  const urlColumn = isEn ? 'pdf_url_en' : 'pdf_url';
  await qcFilesRepo.update(qcFileId, { status: 'EXPORTED', [urlColumn]: freshUrl });
  return getQCFile(qcFileId);
}
