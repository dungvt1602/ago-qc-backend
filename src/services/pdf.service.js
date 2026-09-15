// Logic xuất PDF: gom dữ liệu, tải ảnh SONG SONG, render, upload, lưu link.
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import { getQCFile } from './qcFiles.service.js';
import { uploadBuffer } from '../lib/storage.js';
import { pdfImageUrl } from '../pdf/images.js';
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
  // Lấy dữ liệu hồ sơ và cấu hình công ty cùng lúc.
  const [data, settings] = await Promise.all([getQCFile(qcFileId), getSettings()]);
  data.settings = settings;

  // Gom tất cả ảnh cần nhúng (daily + container) có đường dẫn Storage.
  const photoItems = [];
  data.dailySessions.forEach((s) => s.items.forEach((it) => { if (it.PHOTO_PATH) photoItems.push(it); }));
  data.containerItems.forEach((it) => { if (it.PHOTO_PATH) photoItems.push(it); });

  // Ảnh của các MẪU (hàng nhập) nằm trong JSONB -> gom vào cùng danh sách.
  const samplePhotos = [];
  data.dailySessions.forEach((s) => (s.samples || []).forEach((sm) => (sm.PHOTOS || []).forEach((p) => { if (p && p.path) samplePhotos.push(p); })));

  // KHÔNG tải/nhúng ảnh ở đây nữa: chỉ gắn URL nội bộ, Chrome tự lấy từng tấm (đã thu nhỏ 1024px)
  // khi in tới trang đó. Xem pdf/images.js. Giữ RAM Node ~90MB thay vì phình theo số ảnh.
  photoItems.forEach((it) => { it.PHOTO_RENDER_URL = pdfImageUrl(it.PHOTO_PATH); });
  samplePhotos.forEach((p) => { p.render = pdfImageUrl(p.path); });

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

  // Chia ảnh container thành các trang 9 ảnh, tính tổng số trang.
  data.containerChunks = chunk(data.containerItems, 9);
  data.totalPages = 1 + data.dailySessions.length + data.containerChunks.length;
  // Hàng nhập: đưa ảnh container lên TRƯỚC phần QC ngày trong PDF.
  data.containerFirst = data.qcFile.QC_TYPE === 'IMPORT';

  // 2 khuôn: bản NỘI BỘ song ngữ (theo loại hồ sơ) và bản KHÁCH HÀNG tiếng Anh (dùng chung).
  const isEn = variant === 'en';
  const templateFile = isEn
    ? 'template-en.ejs'
    : (isImportFile ? 'template-import.ejs' : 'template.ejs');
  const pdfBuffer = await renderPdf(data, templateFile);

  // Tên file CỐ ĐỊNH theo hồ sơ + ngôn ngữ -> lần xuất sau GHI ĐÈ file cũ (không tích rác).
  const name = sanitizeFileName(data.qcFile.LOT_CODE || data.qcFile.QC_FILE_NO || 'AGO_QC');
  const filePath = `${qcFileId}/${name}${isEn ? '_EN' : '_VN'}.pdf`;
  const uploaded = await uploadBuffer(config.pdfBucket, filePath, pdfBuffer, 'application/pdf');

  // Thêm ?t= để trình duyệt/CDN luôn lấy bản mới (file bị ghi đè nhưng URL gốc không đổi).
  const freshUrl = `${uploaded.url}?t=${Date.now()}`;
  const urlColumn = isEn ? 'pdf_url_en' : 'pdf_url';
  await qcFilesRepo.update(qcFileId, { status: 'EXPORTED', [urlColumn]: freshUrl });
  return getQCFile(qcFileId);
}
