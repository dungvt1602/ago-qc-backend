// Tạo PDF bằng Puppeteer (Chrome chạy ngầm) từ template EJS.
// TỐI ƯU: mở trình duyệt MỘT lần rồi tái dùng cho các lần xuất sau (tránh ~1s khởi động mỗi lần).
import puppeteer from 'puppeteer';
import ejs from 'ejs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

// data: object đã chuẩn bị sẵn (qcFile, summary, settings, dailySessions, containerChunks, totalPages...).
// Trả về Buffer PDF.
export async function renderPdf(data, templateFile = 'template.ejs') {
  const template = await fs.readFile(path.join(__dirname, templateFile), 'utf8');
  const html = ejs.render(template, { d: data });

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
    await page.close();
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
