// Khuôn NỘI BỘ song ngữ cho hồ sơ HÀNG XUẤT (chuyển từ template.ejs cũ).
// Trang 1: quốc hiệu + thông tin lô + thống kê + xuất hàng + ký tên. Sau đó mỗi phiên QC ngày = 1 trang
// (6 hạng mục, 3 cột × 2 hàng) và ảnh container 9 ảnh/trang (3 × 3).
import {
  C, px, mmPx, ph, nb, txt, gap, inlineLine, infoTable, fixedWidths, signTable, photoGrid, gridCellWidth, photoNode,
  companyHeader, footerDef, titleBlock, pages, pageMargins, FOOTER_H,
} from './common.js';

const PLACEHOLDER = '[chèn hình ảnh tại đây / insert photo here]';

// Tiêu đề trang đứng ngay sau header: margin-top 12px của .title gộp (collapse) với margin-bottom 10px của
// .header trong CSS -> chỉ cách thêm 2px.
const pageTitle = (h1, h2) => titleBlock(h1, h2, { margin: [12 - 10, 12] });
const NOTE_LINE = 9 * 1.35; // .note { font-size:9px; line-height:1.35 }

// Ô ảnh: tiêu đề / ảnh (khung 165px, ảnh cao tối đa 160px) / 3 dòng tỉ lệ + nhận xét.
function photoParts(item) {
  const cellW = gridCellWidth(3, 8);
  const field = (label, value) => ({
    node: txt([{ text: label, bold: true }, ph(value)]),
    pad: [5, 6, 5, 6],
    minH: 18,
  });
  return [
    {
      node: txt(nb(`${ph(item.ITEM_NAME_VI)} / ${ph(item.ITEM_NAME_EN)}`.toUpperCase()), { bold: true, color: C.green, align: 'center' }),
      pad: [6, 5, 6, 5],
      minH: 28,
    },
    { node: photoNode(item.PHOTO_KEY, { cellW, imgMaxH: 160, placeholder: PLACEHOLDER }), pad: [4, 4, 4, 4], minH: 165 },
    field('Tỉ lệ đạt / Pass rate: ', item.PASS_RATE),
    field('Tỉ lệ không đạt / Fail rate: ', item.FAIL_RATE),
    field('Nhận xét / Remarks: ', item.REMARKS),
  ];
}

function header(d) {
  const set = d.settings || {};
  return companyHeader(d, {
    name: set.COMPANY_NAME || 'AGO IMPORT EXPORT CO., LTD',
    addressPrefix: 'Add: ',
    address: set.ADDRESS || '50 Street No 5, Linh Xuan Ward, Ho Chi Minh City',
    website: set.WEBSITE || 'agoexim.com',
    email: set.EMAIL || 'info@agoexim.com',
  });
}

function coverPage(d) {
  const f = d.qcFile;
  const s = d.summary || {};
  return [
    ...header(d),
    // Quốc hiệu: khối 14px đậm, line-height 1.25 (17.5px); dòng tiếng Anh 10px nghiêng nằm cùng baseline.
    {
      stack: [
        txt('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', { size: 14, line: 17.5, bold: true, align: 'center' }),
        inlineLine('SOCIALIST REPUBLIC OF VIETNAM', { size: 10, italic: true, align: 'center' }, 14, 17.5),
        txt('Độc lập - Tự do - Hạnh phúc', { size: 14, line: 17.5, bold: true, align: 'center' }),
        inlineLine('Independence - Freedom - Happiness', { size: 10, italic: true, align: 'center' }, 14, 17.5),
      ],
    },
    titleBlock('BỘ THÔNG TIN VÀ HÌNH ẢNH QC LÔ HÀNG', 'LOT QC INFORMATION AND PHOTO RECORD'),
    infoTable({
      section: 'A. THÔNG TIN LÔ HÀNG / LOT INFORMATION',
      rows: [
        ['Mã hồ sơ QC / QC file no.', ph(f.QC_FILE_NO), 'Mã lô / Lot code', ph(f.LOT_CODE)],
        ['Hợp đồng số / Contract no.', ph(f.CONTRACT_NO), 'PO số / PO no.', ph(f.PO_NO)],
        ['Lệnh sản xuất / Production order', ph(f.PRODUCTION_ORDER), 'Phụ lục tiêu chuẩn / Standard appendix', ph(f.STANDARD_APPENDIX)],
        ['Tên sản phẩm / Product name', ph(f.PRODUCT_NAME), 'Quy cách/Size/Grade / Specification', ph(f.SPECIFICATION)],
        ['Nhà cung cấp / Supplier', ph(f.SUPPLIER), 'Mã NCC / Supplier code', ph(f.SUPPLIER_CODE)],
        ['Số lượng theo PO / PO quantity', ph(f.PO_QUANTITY), 'Đơn vị tính / Unit', ph(f.UNIT)],
        ['Ngày bắt đầu / Start date', ph(f.START_DATE), 'Dự kiến kết thúc / Est. finish date', ph(f.EST_FINISH_DATE)],
        ['Tổng số ngày SX / Total production days', `${ph(f.TOTAL_PRODUCTION_DAYS)} ngày/days`, 'Tổng số kho/cơ sở / Total warehouses/facilities', `${ph(f.TOTAL_WAREHOUSES)} kho/warehouse`],
      ],
    }),
    gap(),
    infoTable({
      section: 'B. THỐNG KÊ / SUMMARY',
      rows: [
        ['Tỷ lệ đạt / Pass rate', ph(s.CUMULATIVE_PASS_RATE), 'Tỷ lệ không đạt / Fail rate', ph(s.CUMULATIVE_FAIL_RATE)],
        ['Lý do không đạt / Reason for failure', ph(s.FAIL_REASON), 'Hướng xử lý / Handling action', ph(s.HANDLING_ACTION)],
      ],
    }),
    gap(),
    infoTable({
      section: 'C. THÔNG TIN XUẤT HÀNG / SHIPMENT INFORMATION',
      rows: [
        ['Số container / Container no.', ph(f.CONTAINER_NO), 'Số seal / Seal no.', ph(f.SEAL_NO)],
        ['Ngày đóng cont / Container loading date', ph(f.CONTAINER_LOADING_DATE), 'Nhân viên QC / QC staff', ph(f.QC_STAFF)],
      ],
    }),
    signTable([
      ['NGƯỜI LẬP HỒ SƠ / PREPARED BY', '(Ký, ghi rõ họ tên) / Signature & full name'],
      ['QC MANAGER', '(Ký, ghi rõ họ tên) / Signature & full name'],
      ['ĐIỀU PHỐI/MUA HÀNG / COORDINATION/PURCHASING', '(Ký, ghi rõ họ tên) / Signature & full name'],
    ]),
  ];
}

function dailyPage(d, sess) {
  return [
    ...header(d),
    pageTitle('BÁO CÁO QC CHẤT LƯỢNG', 'QUALITY CHECK REPORT'),
    infoTable({
      widths: fixedWidths(17),
      minH: 22,
      rows: [['Ngày QC / QC date', ph(sess.QC_DATE), 'Mã lô / Lot code', ph(sess.LOT_CODE)]],
    }),
    gap(),
    photoGrid({ cols: 3, items: sess.items.slice(0, 6), rowsPerCell: 5, parts: photoParts }),
    txt(
      'Ảnh phải rõ mã lô/kho/ngày hoặc có bảng nhận diện đi kèm. Không chỉnh sửa làm thay đổi bản chất tình trạng hàng hóa.\n'
        + 'Photos must clearly show lot code/warehouse/date or include an ID board. Do not edit photos in a way that changes the actual condition of goods.',
      { size: 9, line: NOTE_LINE, italic: true, color: C.note, margin: [0, 5, 0, 0] },
    ),
  ];
}

function containerPage(d, group, isLast) {
  const ctnVi = d.containerFirst ? 'HÌNH ẢNH KIỂM TRA CONTAINER' : 'HÌNH ẢNH GIAO HÀNG - CONTAINER';
  const ctnEn = d.containerFirst ? 'CONTAINER INSPECTION PHOTOS' : 'DELIVERY - CONTAINER PHOTOS';
  const out = [
    ...header(d),
    pageTitle(ctnVi, ctnEn),
    // Trang cũ luôn vẽ đủ 3 hàng <tr>; hàng thiếu ảnh là ô &nbsp; cao 1 dòng chữ.
    photoGrid({ cols: 3, items: group, rowsPerCell: 5, parts: photoParts, fillRows: 3, emptyRowH: 11 }),
  ];
  if (isLast) {
    out.push(txt('Tài liệu này là bộ hồ sơ QC của một lô hàng. This document is the QC record for one lot.',
      { size: 9, line: NOTE_LINE, italic: true, color: C.note, margin: [0, 14, 0, 0] }));
  }
  return out;
}

export function buildExportDoc(d) {
  const chunks = d.containerChunks || [];
  const daily = (d.dailySessions || []).map((sess) => dailyPage(d, sess));
  const container = chunks.map((group, i) => containerPage(d, group, i === chunks.length - 1));
  const list = [coverPage(d), ...(d.containerFirst ? [...container, ...daily] : [...daily, ...container])];

  // @page margin 11mm 11mm 10mm; .page min-height 275mm; footer sát đáy .page.
  const footerTop = 42 + mmPx(275) - FOOTER_H;
  return {
    pageSize: 'A4',
    pageMargins: pageMargins(42, footerTop),
    defaultStyle: { font: 'LiberationSans', fontSize: px(10), color: C.text },
    footer: footerDef('AGO Fruit | Hồ sơ QC lô hàng / Lot QC File | Nội bộ / Internal', (cur, total) => `Trang/Page ${cur}/${total}`),
    content: pages(list),
  };
}
