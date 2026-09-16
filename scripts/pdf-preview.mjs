// Xem thử 4 khuôn PDF với dữ liệu giả — KHÔNG cần DB, Storage hay .env.
// Dùng khi sửa bố cục trong src/pdf/doc/*.js:   node scripts/pdf-preview.mjs [thư-mục-xuất]
// Ảnh minh hoạ dùng logo.png (PNG cũng nhúng được như JPEG).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderPdf } from '../src/pdf/generate.js';
import { DAILY_ITEMS, CONTAINER_ITEMS } from '../src/data/catalog.js';
import { chunk } from '../src/lib/util.js';

const outDir = process.argv[2] || path.join(os.tmpdir(), 'ago-qc-pdf-preview');
const photo = await fs.readFile(new URL('../src/pdf/logo.png', import.meta.url));

const settings = {
  COMPANY_NAME: 'AGO IMPORT EXPORT CO., LTD', ADDRESS: '50 Street No 5, Linh Xuan Ward, Ho Chi Minh City',
  WEBSITE: 'agoexim.com', EMAIL: 'info@agoexim.com',
  COMPANY_NAME_EN: 'AGO IMPORT EXPORT COMPANY LIMITED',
  ADDRESS_EN: 'Km 5, National Highway 1A, Tuyen Quang Commune, Lam Dong Province, Vietnam',
};
const qcFile = (type) => ({
  ID: 'demo', QC_FILE_NO: 'QC-2026-0001', LOT_CODE: 'DEMO-LOT-01', QC_TYPE: type,
  CONTRACT_NO: 'HD-01', PO_NO: 'PO-01', PRODUCTION_ORDER: 'LSX-01', STANDARD_APPENDIX: 'PL-01',
  PRODUCT_NAME: 'Thanh long ruột đỏ / Red dragon fruit', SPECIFICATION: 'Size 350-450g', SUPPLIER: 'HTX Demo',
  SUPPLIER_CODE: 'NCC-01', PO_QUANTITY: '18,000', UNIT: 'kg', START_DATE: '2026-09-14', EST_FINISH_DATE: '2026-09-18',
  TOTAL_PRODUCTION_DAYS: 4, TOTAL_WAREHOUSES: 2, CONTAINER_NO: 'MSKU 123456-7', SEAL_NO: 'SL-01',
  CONTAINER_LOADING_DATE: '2026-09-18', QC_STAFF: 'Nguyễn Văn A', CUSTOMER: 'Demo Customer LLC',
});
const summary = { CUMULATIVE_PASS_RATE: '96%', CUMULATIVE_FAIL_RATE: '4%', FAIL_REASON: 'Vỏ trầy nhẹ', HANDLING_ACTION: 'Phân loại lại' };

// Chuẩn bị dữ liệu giống pdf.service.exportPDF.
function prepare(data) {
  data.settings = settings;
  const isImport = data.qcFile.QC_TYPE === 'IMPORT';
  data.dailySessions.forEach((s) => s.items.forEach((it) => {
    const def = DAILY_ITEMS.find((d) => d.code === it.ITEM_CODE);
    it.EN_TITLE = def ? (def.enFull || def.en) : it.ITEM_NAME_EN;
  }));
  data.containerItems.forEach((it, idx) => {
    const def = CONTAINER_ITEMS.find((c) => c.no === Number(it.PHOTO_NO));
    let title = def ? (def.enFull || def.en) : it.ITEM_NAME_EN;
    if (isImport) title = String(title).replace(/^(PHOTO\s*)\d+/i, `$1${idx + 1}`);
    it.EN_TITLE = title;
  });
  data.containerChunks = chunk(data.containerItems, 9);
  data.containerFirst = isImport;
  return data;
}

function exportFile() {
  const f = qcFile('EXPORT');
  const session = (id, date) => ({
    ID: id, QC_DATE: date, LOT_CODE: f.LOT_CODE, QC_STAFF: f.QC_STAFF, samples: [],
    items: DAILY_ITEMS.map((d, i) => ({
      ITEM_CODE: d.code, ITEM_NAME_VI: d.vi, ITEM_NAME_EN: d.en,
      PASS_RATE: '97%', FAIL_RATE: '3%', REMARKS: i % 2 ? 'Đạt yêu cầu, không phát hiện lỗi lớn.' : 'OK',
      PHOTO_PATH: i < 5 ? 'demo.png' : '',
    })),
  });
  const containerItems = CONTAINER_ITEMS.map((d, i) => ({
    PHOTO_NO: d.no, ITEM_CODE: d.code, ITEM_NAME_VI: d.vi, ITEM_NAME_EN: d.en,
    PASS_RATE: '100%', FAIL_RATE: '0%', REMARKS: 'Đạt / OK', PHOTO_PATH: i < 16 ? 'demo.png' : '',
  }));
  return { qcFile: f, summary, dailySessions: [session('s1', '2026-09-14'), session('s2', '2026-09-15')], containerItems };
}

function importFile() {
  const f = qcFile('IMPORT');
  const samples = [1, 2].map((n) => ({
    ID: `sm${n}`, SAMPLE_NO: n,
    PHOTOS: [0, 1, 2, 3].map((slot) => (n === 2 && slot === 3 ? null : { path: 'demo.png' })),
  }));
  const containerItems = CONTAINER_ITEMS.filter((d) => d.no >= 13).map((d, i) => ({
    PHOTO_NO: d.no, ITEM_CODE: d.code,
    ITEM_NAME_VI: d.vi.replace(/^(ẢNH\s*)\d+/i, `$1${i + 1}`), ITEM_NAME_EN: d.en.replace(/^(PHOTO\s*)\d+/i, `$1${i + 1}`),
    PASS_RATE: '100%', FAIL_RATE: '0%', REMARKS: 'Đạt / OK', PHOTO_PATH: i < 8 ? 'demo.png' : '',
  }));
  return { qcFile: f, summary, dailySessions: [{ ID: 's1', QC_DATE: '2026-09-14', items: [], samples }], containerItems };
}

await fs.mkdir(outDir, { recursive: true });
const cases = [
  ['export-internal', exportFile, 'internal'], ['export-en', exportFile, 'en'],
  ['import-internal', importFile, 'internal'], ['import-en', importFile, 'en'],
];
for (const [name, make, variant] of cases) {
  const t0 = Date.now();
  const buf = await renderPdf(prepare(make()), { variant, loadPhoto: async () => photo });
  const file = path.join(outDir, `${name}.pdf`);
  await fs.writeFile(file, buf);
  console.log(`${name}: ${Math.round(buf.length / 1024)} KB, ${Date.now() - t0} ms -> ${file}`);
}
