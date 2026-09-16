// Khuôn KHÁCH HÀNG tiếng Anh, dùng chung cho hàng xuất và hàng nhập (chuyển từ template-en.ejs cũ, dựng theo
// mẫu docx của AGO). Khác bản nội bộ: không có mục thống kê, ô ảnh không hiện tỉ lệ đạt/không đạt/nhận xét,
// có thêm dòng Customer, dùng tên/địa chỉ công ty bản tiếng Anh.
import {
  C, px, mmPx, nb, txt, gap, infoTable, fixedWidths, signTable, photoGrid, gridCellWidth, photoNode,
  companyHeader, footerDef, titleBlock, pages, pageMargins, FOOTER_H,
} from './common.js';

const v = (x) => (x === null || x === undefined || x === '') ? '' : String(x);
const dots = (x) => v(x) || '.....................................';
const PLACEHOLDER = '[Insert photo here]';

// Chiều cao khung ảnh (px). Bản HTML cũ: QC ngày 400, container 260, mẫu 330 — nhưng lưới của 2 trang đầu thực ra
// cao hơn chỗ trống 7px / 6px và Chrome in đè lên đường kẻ footer. pdfmake không cho tràn (sẽ đẩy cả hàng ảnh sang
// trang mới) nên rút khung QC ngày 5px, container 3px cho vừa trang; ảnh cao tối đa = khung - 5px như cũ.
const BOX = { daily: 395, container: 257, sample: 330 };

function header(d) {
  const set = d.settings || {};
  return companyHeader(d, {
    name: v(set.COMPANY_NAME_EN || 'AGO IMPORT EXPORT COMPANY LIMITED'),
    address: v(set.ADDRESS_EN || 'Km 5, National Highway 1A, Tuyen Quang Commune, Lam Dong Province, Vietnam'),
    website: v(set.WEBSITE || 'agoexim.com'),
    email: v(set.EMAIL || 'info@agoexim.com'),
    sep: ' \u00A0|\u00A0 ',
  });
}

// Tiêu đề trang (.title: margin 12px 0 10px). Đứng ngay sau header thì margin-top gộp với margin-bottom 10px
// của .header (CSS margin collapsing) -> chỉ cách thêm 2px.
const title = (h1, afterHeader = true) => titleBlock(h1, null, { h1Size: 19, margin: [afterHeader ? 12 - 10 : 12, 10], ls: 0.2 });

// Ô ảnh: tiêu đề in hoa 9px + ảnh; KHÔNG có tỉ lệ / nhận xét (bản khách hàng).
function photoParts(boxH, cols) {
  const cellW = gridCellWidth(cols, 8);
  return (item) => [
    {
      node: txt(nb(v(item.title).toUpperCase()), { size: 9, bold: true, color: C.green, align: 'center' }),
      pad: [5, 4, 5, 4],
      minH: 26,
    },
    { node: photoNode(item.key, { cellW, imgMaxH: boxH - 5, placeholder: PLACEHOLDER }), pad: [4, 4, 4, 4], minH: boxH },
  ];
}

function coverPage(d) {
  const f = d.qcFile;
  return [
    ...header(d),
    // .republic: 13px đậm, line-height 1.3; .sub: 11px (vẫn đậm), line-height 1.3.
    {
      stack: [
        txt('SOCIALIST REPUBLIC OF VIETNAM', { size: 13, line: 13 * 1.3, bold: true, align: 'center' }),
        txt('Independence - Freedom - Happiness', { size: 11, line: 11 * 1.3, bold: true, align: 'center' }),
      ],
    },
    title('QC LOT INFORMATION AND PHOTO REPORT', false),
    txt(`Lam Dong, ${dots(f.START_DATE)}`, { italic: true, align: 'right', margin: [0, 0, 0, 10] }),
    infoTable({
      section: 'A. LOT INFORMATION',
      rows: [
        ['QC Report No.', dots(f.QC_FILE_NO), 'Lot No.', dots(f.LOT_CODE)],
        ['Product Name', dots(f.PRODUCT_NAME), 'Specification / Size / Grade', dots(f.SPECIFICATION)],
        ['Quantity as per PO', dots(f.PO_QUANTITY), 'Unit of Measure', dots(f.UNIT)],
      ],
    }),
    gap(),
    infoTable({
      section: 'C. SHIPMENT INFORMATION',
      rows: [
        ['Customer', { text: dots(f.CUSTOMER), span: 3 }],
        ['Container No.', dots(f.CONTAINER_NO), 'Seal No.', dots(f.SEAL_NO)],
        ['Container Loading Date', dots(f.CONTAINER_LOADING_DATE), 'QC Inspector', dots(f.QC_STAFF)],
      ],
    }),
    signTable([
      ['PREPARED BY', '(Signature and full name)'],
      ['QC MANAGER', '(Signature and full name)'],
      ['OPERATIONS / PURCHASING', '(Signature and full name)'],
    ], { padTop: 20 }),
  ];
}

// Hàng xuất: mỗi đợt QC = 1 trang, 6 hạng mục 3 cột × 2 hàng.
function dailyPage(d, sess) {
  const f = d.qcFile;
  const items = (sess.items || []).slice(0, 6).map((it) => ({ title: it.EN_TITLE || it.ITEM_NAME_EN, key: it.PHOTO_KEY }));
  return [
    ...header(d),
    title('QC INSPECTION PROCESS REPORT'),
    infoTable({
      widths: fixedWidths(22),
      minH: 22,
      rows: [['QC Date', dots(sess.QC_DATE), 'QC Inspector', dots(sess.QC_STAFF || f.QC_STAFF)]],
    }),
    gap(),
    photoGrid({ cols: 3, items, rowsPerCell: 2, parts: photoParts(BOX.daily, 3), fillRows: 2, emptyRowH: 0 }),
  ];
}

// Ảnh container: 3 cột × 3 hàng, 9 ảnh mỗi trang.
function containerPage(d, group) {
  const items = group.map((it) => ({ title: it.EN_TITLE || it.ITEM_NAME_EN, key: it.PHOTO_KEY }));
  return [
    ...header(d),
    title('CONTAINER LOADING AND DELIVERY PHOTOS'),
    txt('(Keep original photos clearly showing the time, container number, seal number and lot number)',
      { size: 9, italic: true, color: C.note, align: 'center', margin: [0, 0, 0, 8] }),
    photoGrid({ cols: 3, items, rowsPerCell: 2, parts: photoParts(BOX.container, 3), fillRows: 3, emptyRowH: 0 }),
  ];
}

// Hàng nhập: mỗi mẫu QC = 1 trang, 4 ảnh xếp 2 × 2.
function samplePage(d, sm) {
  const photos = sm.PHOTOS || [];
  const items = [0, 1, 2, 3].map((i) => ({ title: `PHOTO ${i + 1}`, key: photos[i] && photos[i].imageKey }));
  return [
    ...header(d),
    title(`SAMPLE ${sm.SAMPLE_NO} - QUALITY INSPECTION`),
    photoGrid({ cols: 2, items, rowsPerCell: 2, parts: photoParts(BOX.sample, 2) }),
  ];
}

export function buildEnDoc(d) {
  const isImport = d.qcFile.QC_TYPE === 'IMPORT';
  const sessions = d.dailySessions || [];
  const daily = isImport ? [] : sessions.map((s) => dailyPage(d, s));
  const container = (d.containerChunks || []).map((g) => containerPage(d, g));
  const samples = isImport ? sessions.flatMap((s) => s.samples || []).map((sm) => samplePage(d, sm)) : [];
  const list = [coverPage(d), ...daily, ...container, ...samples];

  // @page margin 11mm 11mm 10mm; .page min-height 275mm; footer sát đáy .page (giống khuôn nội bộ hàng xuất).
  const footerTop = 42 + mmPx(275) - FOOTER_H;
  return {
    pageSize: 'A4',
    pageMargins: pageMargins(42, footerTop),
    defaultStyle: { font: 'LiberationSans', fontSize: px(10), color: C.text },
    footer: footerDef('AGO Fruit | QC Lot Report', (cur, total) => `Page ${cur}/${total}`),
    content: pages(list),
  };
}
