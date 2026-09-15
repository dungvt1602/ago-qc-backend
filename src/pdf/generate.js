// Tạo PDF bằng Puppeteer (Chrome chạy ngầm) từ template EJS.
//
// Máy Render chỉ có 512MB nên thiết kế xoay quanh việc GIỮ RAM THẤP:
//   1. Chrome KHÔNG chạy thường trực: mỗi lần in mở mới -> in -> đóng ngay (Chrome ngồi chờ cũng tốn ~200MB).
//   2. In TUẦN TỰ: 2 người bấm cùng lúc thì xếp hàng, không bao giờ 2 Chrome cùng chạy.
//   3. In TỪNG TRANG rồi ghép (pdf-lib): Chrome chỉ giải nén ảnh của 1 trang (tối đa 9) thay vì cả hồ sơ
//      (57 ảnh x ~3MB điểm ảnh là quá sức). Ảnh do Chrome tự tải từng tấm qua /pdf-img (xem images.js),
//      không nhúng base64 vào HTML -> Node không phải giữ hàng MB chuỗi.
import puppeteer from 'puppeteer';
import ejs from 'ejs';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let current = null;            // Chrome đang in (để đóng khi tắt server)
let queue = Promise.resolve();  // hàng đợi in tuần tự

const PAGES_PER_CHUNK = 1; // 1 trang/lần: Chrome giải nén tối đa 9 ảnh (~45MB) mỗi lượt
const PDF_PHOTO_MAX_SIDE = 1024; // ô ảnh trên A4 chỉ ~6cm, 1024px vẫn dư nét
const PDF_JPEG_QUALITY = 0.72;
const A4_MAX_PX = 1043; // 297mm - lề 21mm = 276mm ≈ 1043px @96dpi

// Chạy TRONG trang Chrome: thay từng <img> tải từ /pdf-img bằng bản thu nhỏ (tuần tự để không dồn RAM).
async function shrinkImagesInPage(maxSide, quality) {
  const imgs = Array.from(document.images).filter((im) => im.src.includes('/pdf-img'));
  for (const img of imgs) {
    if (!img.complete || !img.naturalWidth) continue;
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    if (s >= 1) continue;
    // Trang là about:blank còn ảnh ở 127.0.0.1 -> canvas bị "tainted". Nạp lại ảnh ở chế độ anonymous
    // (server /pdf-img đã gửi Access-Control-Allow-Origin) thì mới được phép đọc canvas.
    const src = new Image();
    src.crossOrigin = 'anonymous';
    await new Promise((done) => { src.onload = done; src.onerror = done; src.src = img.src; });
    if (!src.naturalWidth) continue;
    const c = document.createElement('canvas');
    c.width = Math.round(src.naturalWidth * s);
    c.height = Math.round(src.naturalHeight * s);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', quality);
    await new Promise((done) => { img.onload = done; img.onerror = done; img.src = url; });
    c.width = c.height = 0; // trả bộ nhớ canvas ngay
  }
}

// Cờ tiết kiệm RAM cho Chrome.
const CHROME_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--no-zygote', '--disable-extensions', '--disable-background-networking',
  '--disable-default-apps', '--disable-sync', '--no-first-run', '--mute-audio',
];

// Đọc logo.png một lần, chuyển thành data URL base64 để nhúng thẳng vào PDF
// (không phụ thuộc mạng). Nếu không có file -> trả '' và template tự dùng logo chữ.
let logoCache = null;
async function getLogoDataUrl() {
  if (logoCache !== null) return logoCache;
  try {
    const buf = await fs.readFile(path.join(__dirname, 'logo.png'));
    logoCache = 'data:image/png;base64,' + buf.toString('base64');
  } catch (e) {
    logoCache = '';
  }
  return logoCache;
}

// Tách HTML đã render thành phần <head>... và danh sách các khối <div class="page">.
// Số trang ("Trang 3/7") đã được template ghi sẵn vào từng khối nên tách sau khi render vẫn đúng.
function splitPages(html) {
  const bodyTag = '<body>';
  const at = html.indexOf(bodyTag);
  if (at < 0) return { head: '', pages: [html] };
  const head = html.slice(0, at + bodyTag.length);
  const body = html.slice(at + bodyTag.length).replace(/<\/body>\s*<\/html>\s*$/i, '');
  // Chỉ giữ khối thật sự là trang: ghi chú <!-- --> đứng trước trang đầu nếu giữ lại sẽ in ra 1 trang trắng.
  const pages = body.split(/(?=<div class="page[ "])/).map((p) => p.trim()).filter((p) => p.startsWith('<div class="page'));
  return { head, pages };
}

// data: object đã chuẩn bị sẵn (qcFile, summary, settings, dailySessions, containerChunks, totalPages...).
// Trả về Buffer PDF.
export async function renderPdf(data, templateFile = 'template.ejs') {
  data.logoUrl = await getLogoDataUrl();
  const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');
  const html = ejs.render(template, { d: data });

  // Xếp hàng: lần in này chỉ bắt đầu khi lần trước xong (kể cả lần trước lỗi).
  const run = queue.then(() => printChunked(html));
  queue = run.catch(() => {});
  return run;
}

// Mở Chrome 1 lần -> in từng khúc -> đóng Chrome -> ghép các khúc.
async function printChunked(html) {
  const { head, pages } = splitPages(html);
  const chunks = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_CHUNK) {
    chunks.push(head + pages.slice(i, i + PAGES_PER_CHUNK).join('\n') + '</body></html>');
  }
  if (!chunks.length) chunks.push(html);

  // Mỗi khúc in thẳng ra FILE tạm (không giữ trong RAM), ghép xong thì xóa thư mục tạm.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agoqc-pdf-'));
  const parts = [];
  const browser = await puppeteer.launch({ headless: true, args: CHROME_ARGS });
  current = browser;
  try {
    for (let i = 0; i < chunks.length; i++) {
      const page = await browser.newPage();
      try {
        // Ảnh do Chrome tự tải từ /pdf-img -> chờ tới khi không còn request nào đang chạy.
        await page.setContent(chunks[i], { waitUntil: 'networkidle0', timeout: 90000 });
        // Thu nhỏ ảnh NGAY TRONG CHROME (vẽ lại lên canvas 1024px, JPEG 72%) rồi mới in.
        // Chrome in PDF sẽ nén lại ảnh theo độ phân giải bitmap, nên ảnh nhỏ -> PDF nhẹ (~130KB/ảnh thay vì ~280KB).
        // Làm ở Chrome chứ không ở Node: Node không tốn RAM, và Chrome đằng nào cũng đã giải nén ảnh.
        await page.evaluate(shrinkImagesInPage, PDF_PHOTO_MAX_SIDE, PDF_JPEG_QUALITY);
        // Cảnh báo sớm nếu nội dung cao hơn khổ A4 -> sẽ đẻ thêm trang trắng.
        const h = await page.evaluate(() => Math.round(document.querySelector('.page')?.scrollHeight || 0));
        if (h > A4_MAX_PX) console.warn(`[PDF] trang ${i + 1}/${chunks.length} cao ${h}px > ${A4_MAX_PX}px -> tràn sang trang trắng`);
        const file = path.join(tmpDir, `p${String(i).padStart(3, '0')}.pdf`);
        await page.pdf({ path: file, printBackground: true, preferCSSPageSize: true });
        parts.push(file);
      } finally {
        await page.close().catch(() => {});
      }
    }
    return parts.length === 1 ? await fs.readFile(parts[0]) : await mergePdfFiles(parts, path.join(tmpDir, 'out.pdf'));
  } finally {
    current = null;
    await browser.close().catch(() => {}); // Chrome đã chết thì close cũng lỗi, bỏ qua
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Ghép các file PDF. Ưu tiên qpdf (có trong Docker): ghép kiểu luồng, RAM gần như 0.
// Máy dev không có qpdf -> dùng pdf-lib (giữ cả PDF trong JS, tốn RAM hơn nhưng chạy được).
async function mergePdfFiles(files, outFile) {
  try {
    await execFileAsync('qpdf', ['--empty', '--pages', ...files, '--', outFile]);
    return await fs.readFile(outFile);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // qpdf có nhưng lỗi thật -> báo lên
    console.warn('[PDF] Không có qpdf, ghép bằng pdf-lib (tốn RAM hơn).');
    const out = await PDFDocument.create();
    for (const file of files) {
      const doc = await PDFDocument.load(await fs.readFile(file));
      const copied = await out.copyPages(doc, doc.getPageIndices());
      copied.forEach((p) => out.addPage(p));
    }
    return Buffer.from(await out.save());
  }
}

// Đóng Chrome đang in dở (nếu có) khi tắt server (gọi từ server.js).
export async function closeBrowser() {
  if (current) await current.close().catch(() => {});
}
