// Tạo PDF bằng Puppeteer (Chrome chạy ngầm) từ template EJS.
// TỐI ƯU: mở trình duyệt MỘT lần rồi tái dùng cho các lần xuất sau (tránh ~1s khởi động mỗi lần).
import puppeteer from 'puppeteer';
import ejs from 'ejs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let browserPromise = null;

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

async function getBrowser() {
  // Tái dùng Chrome đang sống. Nếu Chrome đã chết (hết RAM / bị kill) thì BỎ xác cũ, mở lại —
  // trước đây giữ mãi tham chiếu cũ nên mọi lần xuất sau đều lỗi "Connection closed" tới khi restart.
  if (browserPromise) {
    const alive = await browserPromise.catch(() => null);
    if (alive && alive.connected) return alive;
    browserPromise = null;
    console.warn('[PDF] Chrome ngầm đã chết, mở lại...');
  }
  const launching = puppeteer.launch({ headless: true, args: CHROME_ARGS });
  browserPromise = launching;
  const browser = await launching;
  browser.once('disconnected', () => { if (browserPromise === launching) browserPromise = null; });
  return browser;
}

const isBrowserGone = (err) => /Connection closed|Target closed|Session closed|browser has disconnected/i.test(String(err && err.message));

// data: object đã chuẩn bị sẵn (qcFile, summary, settings, dailySessions, containerChunks, totalPages...).
// Trả về Buffer PDF.
export async function renderPdf(data, templateFile = 'template.ejs') {
  data.logoUrl = await getLogoDataUrl();
  const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');
  const html = ejs.render(template, { d: data });

  // Thử lại đúng 1 lần nếu Chrome chết giữa chừng (getBrowser sẽ mở Chrome mới ở lần 2).
  try {
    return await printHtml(html);
  } catch (err) {
    if (!isBrowserGone(err)) throw err;
    console.warn('[PDF] Chrome chết giữa chừng, thử lại 1 lần...');
    browserPromise = null;
    return await printHtml(html);
  }
}

async function printHtml(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Ảnh đã được nhúng sẵn dạng dataURL nên 'load' là đủ, không cần chờ mạng.
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      printBackground: true,
      preferCSSPageSize: true, // tôn trọng @page { size:A4; margin } trong template
    });
  } finally {
    await page.close().catch(() => {}); // Chrome đã chết thì close cũng lỗi, bỏ qua
  }
}

// Đóng trình duyệt khi tắt server (gọi từ server.js).
export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
