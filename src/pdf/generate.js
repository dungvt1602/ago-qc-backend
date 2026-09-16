// Tạo PDF bằng pdfmake — thuần JavaScript, KHÔNG cần Chrome.
//
// Trước đây PDF được in bằng Puppeteer (Chrome chạy ngầm) từ template HTML: mỗi lần in phải mở Chrome
// (~200MB RAM, vài giây), giải nén toàn bộ ảnh thành bitmap, in từng trang rồi ghép lại. Trên máy Render 512MB
// việc này vừa chậm (10-30s) vừa hay tràn RAM. Với pdfmake, ảnh JPEG được nhúng NGUYÊN BYTES vào PDF
// (không giải nén), toàn bộ hồ sơ dựng xong trong ~1-3s và RAM chỉ tăng cỡ dung lượng ảnh.
//
// Ba khuôn (doc/export.js, doc/import.js, doc/en.js) được chuyển 1:1 từ template EJS cũ, giữ nguyên kích thước.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdfmake from 'pdfmake';
import { FONTS, FONTS_DIR } from './doc/common.js';
import { buildExportDoc } from './doc/export.js';
import { buildImportDoc } from './doc/import.js';
import { buildEnDoc } from './doc/en.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

pdfmake.setFonts(FONTS);
pdfmake.setLocalAccessPolicy((p) => p.startsWith(FONTS_DIR)); // chỉ được đọc file font
pdfmake.setUrlAccessPolicy(() => false);                       // không tải gì từ Internet

const PHOTO_CONCURRENCY = 10; // số ảnh tải song song từ Storage (CDN chịu tốt; đo thử 10 nhanh hơn 6 ~30%)
let queue = Promise.resolve();  // in tuần tự: máy 512MB, tránh 2 hồ sơ nhiều ảnh cùng nằm trong RAM

// Đọc logo.png một lần: data URL để nhúng + tỉ lệ rộng/cao (đọc từ IHDR) để đặt kích thước.
// Không có file -> null, khuôn tự thay bằng logo chữ.
let logoCache;
async function getLogo() {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = await fs.readFile(path.join(__dirname, 'logo.png'));
    const ratio = buf.readUInt32BE(16) / buf.readUInt32BE(20);
    logoCache = { dataUrl: 'data:image/png;base64,' + buf.toString('base64'), ratio };
  } catch (e) {
    logoCache = null;
  }
  return logoCache;
}

// Nhận dạng ảnh theo byte đầu file: JPEG (FF D8) hoặc PNG (89 'P' 'N' 'G'); khác -> null.
function imageMime(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  return null;
}

// Gom mọi ảnh của hồ sơ (hạng mục QC ngày, ảnh container, ảnh mẫu hàng nhập) -> tải về -> gắn khóa ảnh
// (PHOTO_KEY / imageKey) vào từng mục để khuôn tham chiếu. Ảnh tải lỗi thì bỏ qua: ô đó in chỗ trống.
async function loadPhotos(data, loadPhoto) {
  const targets = []; // { path, set(key) }
  data.dailySessions.forEach((s) => {
    s.items.forEach((it) => { if (it.PHOTO_PATH) targets.push({ path: it.PHOTO_PATH, set: (k) => { it.PHOTO_KEY = k; } }); });
    (s.samples || []).forEach((sm) => (sm.PHOTOS || []).forEach((p) => {
      if (p && p.path) targets.push({ path: p.path, set: (k) => { p.imageKey = k; } });
    }));
  });
  data.containerItems.forEach((it) => { if (it.PHOTO_PATH) targets.push({ path: it.PHOTO_PATH, set: (k) => { it.PHOTO_KEY = k; } }); });

  const images = {};
  let next = 0;
  async function worker() {
    while (next < targets.length) {
      const i = next++;
      const t = targets[i];
      try {
        const buf = await loadPhoto(t.path);
        if (!buf || !buf.length) throw new Error('ảnh rỗng');
        // pdfmake chỉ nhận JPEG/PNG; file lạ (hỏng, HEIC...) -> bỏ qua, in ô trống thay vì hỏng cả PDF.
        const mime = imageMime(buf);
        if (!mime) throw new Error('không phải JPEG/PNG');
        const key = `p${i}`;
        images[key] = `data:${mime};base64,` + buf.toString('base64');
        t.set(key);
      } catch (err) {
        console.warn('[PDF] Không tải được ảnh', t.path, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, targets.length) }, worker));
  return images;
}

// data: object đã chuẩn bị sẵn trong pdf.service (qcFile, summary, settings, dailySessions, containerChunks...).
// variant: 'internal' (song ngữ, theo loại hồ sơ) | 'en' (khách hàng, tiếng Anh).
// loadPhoto(path) -> Promise<Buffer>: cách lấy bytes ảnh (Storage khi chạy thật, file khi test).
// Trả về Buffer PDF.
export async function renderPdf(data, { variant = 'internal', loadPhoto }) {
  const run = queue.then(async () => {
    const t0 = Date.now();
    const images = await loadPhotos(data, loadPhoto);
    const tPhotos = Date.now();
    const logo = await getLogo();
    if (logo) {
      images.logo = logo.dataUrl;
      data.logo = { ratio: logo.ratio };
    }

    const isImport = data.qcFile.QC_TYPE === 'IMPORT';
    const doc = variant === 'en' ? buildEnDoc(data) : (isImport ? buildImportDoc(data) : buildExportDoc(data));
    doc.images = images;
    doc.info = { title: `AGO QC ${data.qcFile.LOT_CODE || data.qcFile.QC_FILE_NO || ''}`.trim(), author: 'AGO Fruit' };

    const buf = await pdfmake.createPdf(doc).getBuffer();
    // Log để biết thời gian nằm ở đâu: tải ảnh (mạng tới Storage) hay dựng PDF (CPU).
    const photoCount = Object.keys(images).length - (logo ? 1 : 0);
    const photoMb = (Object.values(images).reduce((n, s) => n + s.length, 0) * 0.75) / 1048576; // base64 -> bytes
    console.log(`[PDF] ${variant}: tải ${photoCount} ảnh (${photoMb.toFixed(1)}MB) ${((tPhotos - t0) / 1000).toFixed(1)}s, dựng ${((Date.now() - tPhotos) / 1000).toFixed(1)}s -> ${(buf.length / 1048576).toFixed(1)}MB`);
    return buf;
  });
  queue = run.catch(() => {}); // lần in sau vẫn chạy dù lần này lỗi
  return run;
}
