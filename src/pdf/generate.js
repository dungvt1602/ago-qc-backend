// Tạo PDF bằng Puppeteer (Chrome chạy ngầm) từ template EJS.
// TỐI ƯU: mở trình duyệt MỘT lần rồi tái dùng cho các lần xuất sau (tránh ~1s khởi động mỗi lần).
import puppeteer from 'puppeteer';
import ejs from 'ejs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Chrome KHÔNG chạy thường trực: mỗi lần in mở mới -> in -> đóng ngay để trả RAM
// (Render 512MB; Chrome ngồi chờ cũng chiếm ~200MB). Đổi lại chậm thêm ~1 giây/lần in.
let current = null;     // Chrome đang in (để đóng khi tắt server)
let queue = Promise.resolve(); // in TUẦN TỰ: 2 người bấm cùng lúc thì xếp hàng, không mở 2 Chrome

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

// Cờ tiết kiệm RAM: Render chỉ có 512MB, Chrome chết vì thiếu RAM là nguyên nhân số 1 làm PDF lỗi.
const CHROME_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--no-zygote', '--disable-extensions', '--disable-background-networking',
  '--disable-default-apps', '--disable-sync', '--no-first-run', '--mute-audio',
];

const isBrowserGone = (err) => /Connection closed|Target closed|Session closed|browser has disconnected/i.test(String(err && err.message));

// data: object đã chuẩn bị sẵn (qcFile, summary, settings, dailySessions, containerChunks, totalPages...).
// Trả về Buffer PDF.
export async function renderPdf(data, templateFile = 'template.ejs') {
  data.logoUrl = await getLogoDataUrl();
  const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');
  const html = ejs.render(template, { d: data });

  // Xếp hàng: lần in này chỉ bắt đầu khi lần trước xong (kể cả lần trước lỗi).
  const run = queue.then(async () => {
    try {
      return await printHtml(html);
    } catch (err) {
      if (!isBrowserGone(err)) throw err;
      console.warn('[PDF] Chrome chết giữa lúc in (thiếu RAM?), thử lại 1 lần...');
      return await printHtml(html);
    }
  });
  queue = run.catch(() => {});
  return run;
}

// Mở Chrome -> in -> ĐÓNG. Không giữ lại gì sau khi xong.
async function printHtml(html) {
  const browser = await puppeteer.launch({ headless: true, args: CHROME_ARGS });
  current = browser;
  try {
    const page = await browser.newPage();
    // Ảnh đã được nhúng sẵn dạng dataURL nên 'load' là đủ, không cần chờ mạng.
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // tôn trọng @page { size:A4; margin } trong template
    });
  } finally {
    current = null;
    await browser.close().catch(() => {}); // Chrome đã chết thì close cũng lỗi, bỏ qua
  }
}

// Đóng Chrome đang in dở (nếu có) khi tắt server (gọi từ server.js).
export async function closeBrowser() {
  if (current) await current.close().catch(() => {});
}
