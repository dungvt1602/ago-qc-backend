// Khuôn NỘI BỘ song ngữ cho hồ sơ HÀNG NHẬP — "Báo cáo giám định hàng nhập" (chuyển từ template-import.ejs cũ).
// Trang bìa: thông tin + kết quả đánh giá + ký tên. Ảnh container 6 ảnh/trang (2 × 3). Mỗi mẫu QC = 1 trang (4 ảnh 2 × 2).
import {
  C, px, mmPx, nb, txt, hr, infoTable, fixedWidths, signTable, tableLayout, photoGrid, gridCellWidth, photoNode,
  footerDef, titleBlock, pages, pageMargins, FOOTER_H,
} from './common.js';

const v = (x) => (x === null || x === undefined || x === '') ? '—' : String(x);
const PLACEHOLDER = '[chưa có ảnh / no photo]';
const CAP_LINE = 9 * 1.3; // .pbox-cap { font-size:9px; line-height:1.3 }

// Header hàng nhập: logo 40px (inline -> dư 2px descender bên dưới), khối công ty 9px căn giữa theo chiều dọc,
// gạch xanh 2px cách 8px, rồi dòng số báo cáo.
function header(d) {
  const set = d.settings || {};
  const f = d.qcFile;
  const logo = d.logo
    ? { image: 'logo', width: px(40) * d.logo.ratio, height: px(40), margin: [0, 0, 0, px(2)] }
    : txt('agofruit', { size: 26, bold: true, color: C.green });
  const company = [
    txt(v(set.COMPANY_NAME || 'AGO IMPORT EXPORT CO., LTD'), { size: 11, line: 11 * 1.35, bold: true, color: C.green, align: 'right' }),
    txt(v(set.ADDRESS || '50 Street No 5, Linh Xuan Ward, Ho Chi Minh City'), { size: 9, line: 9 * 1.35, align: 'right' }),
    txt(`Website: ${v(set.WEBSITE || 'agoexim.com')} | Email: ${v(set.EMAIL || 'info@agoexim.com')}`, { size: 9, line: 9 * 1.35, italic: true, align: 'right' }),
  ];
  const companyH = 11 * 1.35 + 2 * 9 * 1.35;
  return [
    {
      columns: [
        { width: 'auto', ...logo },
        { width: '*', stack: company, margin: [0, px((42 - companyH) / 2), 0, 0] }, // align-items: center
      ],
      columnGap: 0,
    },
    hr(2, C.green, [0, 8, 0, 0]),
    txt(`BÁO CÁO GIÁM ĐỊNH HÀNG NHẬP SỐ / REPORT NO: ${v(f.QC_FILE_NO)}`, { size: 11, bold: true, color: C.dark, align: 'center', margin: [0, 6, 0, 0] }),
  ];
}

// Dải tiêu đề mục (.sec): nền xanh, chữ trắng in hoa, đệm 5px 8px, cách trên 12px, dưới 6px.
function sectionBand(title) {
  return {
    table: { widths: ['*'], body: [[{ ...txt(title.toUpperCase(), { bold: true, color: '#fff' }), fillColor: C.green }]] },
    layout: tableLayout({ line: 0, pad: [5, 8, 5, 8] }),
    margin: [0, px(12), 0, px(6)],
  };
}

// Ô ảnh container: tiêu đề nền nhạt / ảnh (khung 50mm, ảnh cao tối đa 48mm) / 2 dòng tỉ lệ + nhận xét.
function containerParts(it) {
  const cellW = gridCellWidth(2, 8);
  return [
    {
      node: { ...txt(nb(`${v(it.ITEM_NAME_VI)} / ${v(it.ITEM_NAME_EN)}`), { size: 9.5, bold: true, color: C.green, align: 'center' }), fillColor: C.label },
      pad: [5, 5, 5, 5],
      minH: 24,
    },
    { node: photoNode(it.PHOTO_KEY, { cellW, imgMaxH: mmPx(48), placeholder: PLACEHOLDER }), pad: [4, 4, 4, 4], minH: mmPx(50) },
    {
      node: txt([
        { text: 'Đạt / Pass: ', bold: true }, v(it.PASS_RATE), ' \u00A0|\u00A0 ',
        { text: 'Không đạt / Fail: ', bold: true }, v(it.FAIL_RATE), '\n',
        { text: 'Nhận xét / Remarks: ', bold: true }, v(it.REMARKS),
      ], { size: 9, line: CAP_LINE }),
      pad: [4, 6, 4, 6],
      minH: 0,
    },
  ];
}

// Ô ảnh của mẫu: chỉ tiêu đề "Ảnh n / Photo n" + ảnh to (khung 92mm, ảnh cao tối đa 90mm).
function sampleParts(slot) {
  const cellW = gridCellWidth(2, 12);
  return [
    {
      node: { ...txt(`Ảnh ${slot.idx} / Photo ${slot.idx}`, { size: 9.5, bold: true, color: C.green, align: 'center' }), fillColor: C.label },
      pad: [5, 5, 5, 5],
      minH: 24,
    },
    { node: photoNode(slot.photo && slot.photo.imageKey, { cellW, imgMaxH: mmPx(90), placeholder: PLACEHOLDER }), pad: [6, 6, 6, 6], minH: mmPx(92) },
  ];
}

function coverPage(d) {
  const f = d.qcFile;
  const s = d.summary || {};
  const info = { widths: fixedWidths(22), pad: [5, 7, 5, 7], valign: 'top' };
  return [
    ...header(d),
    titleBlock('BÁO CÁO GIÁM ĐỊNH HÀNG NHẬP', 'IMPORT INSPECTION REPORT', { h1Size: 18, h2Size: 12, margin: [8, 12], ls: 0.3 }),
    infoTable({
      ...info,
      rows: [
        ['Mã hồ sơ / Report no.', v(f.QC_FILE_NO), 'Mã lô / Lot no.', v(f.LOT_CODE)],
        ['Nhà cung cấp (Người XK) / Supplier (Exporter)', v(f.SUPPLIER), 'Mã NCC / Supplier code', v(f.SUPPLIER_CODE)],
        ['Hợp đồng / Invoice', v(f.CONTRACT_NO), 'Số PO / Ref no.', v(f.PO_NO)],
        ['Tên hàng / Product', v(f.PRODUCT_NAME), 'Quy cách / Size', v(f.SPECIFICATION)],
        ['Số lượng / Quantity', `${v(f.PO_QUANTITY)} ${f.UNIT ? v(f.UNIT) : ''}`.trimEnd(), 'Ngày hàng về / Arrival date', v(f.CONTAINER_LOADING_DATE)],
        ['Số container / Container no.', v(f.CONTAINER_NO), 'Số seal / Seal no.', v(f.SEAL_NO)],
        ['Nhân viên QC / Inspector', v(f.QC_STAFF), 'Ngày kiểm / Inspected date', v(f.START_DATE)],
      ],
    }),
    sectionBand('KẾT QUẢ ĐÁNH GIÁ / ASSESSMENT RESULT'),
    infoTable({
      ...info,
      rows: [
        ['Tỷ lệ đạt / Pass rate', v(s.CUMULATIVE_PASS_RATE), 'Tỷ lệ không đạt / Fail rate', v(s.CUMULATIVE_FAIL_RATE)],
        ['Lý do không đạt / Reason', { text: v(s.FAIL_REASON), span: 3 }],
        ['Hướng xử lý / Handling', { text: v(s.HANDLING_ACTION), span: 3 }],
      ],
    }),
    {
      ...signTable([
        ['NGƯỜI LẬP / PREPARED BY', '(Ký, ghi rõ họ tên) / Signature & full name'],
        ['QC MANAGER', '(Ký, ghi rõ họ tên) / Signature & full name'],
      ], { padTop: 24, pad: [24, 7, 5, 7], valign: 'top' }),
      margin: [0, px(18), 0, 0],
    },
  ];
}

function containerPage(d, group) {
  return [
    ...header(d),
    sectionBand('HÌNH ẢNH KIỂM TRA CONTAINER / CONTAINER INSPECTION'),
    // Trang cũ luôn vẽ đủ 3 hàng <tr>; hàng thiếu là các ô <td> rỗng (cao 0).
    photoGrid({ cols: 2, items: group, rowsPerCell: 3, parts: containerParts, fillRows: 3, emptyRowH: 0 }),
  ];
}

function samplePage(d, sm) {
  const photos = sm.PHOTOS || [];
  const slots = [0, 1, 2, 3].map((i) => ({ idx: i + 1, photo: photos[i] }));
  return [
    ...header(d),
    sectionBand(`MẪU ${sm.SAMPLE_NO} - QC CHẤT LƯỢNG / SAMPLE ${sm.SAMPLE_NO}`),
    photoGrid({ cols: 2, items: slots, rowsPerCell: 2, parts: sampleParts }),
  ];
}

export function buildImportDoc(d) {
  // Ảnh container (13-21, đã đánh số lại 1-9): 6 ảnh/trang.
  const items = d.containerItems || [];
  const groups = [];
  for (let i = 0; i < items.length; i += 6) groups.push(items.slice(i, i + 6));
  const samples = (d.dailySessions || []).flatMap((s) => s.samples || []);

  const list = [coverPage(d), ...groups.map((g) => containerPage(d, g)), ...samples.map((sm) => samplePage(d, sm))];

  // @page margin 12mm 11mm 12mm; .page min-height 268mm; footer sát đáy .page.
  const top = mmPx(12);
  const footerTop = top + mmPx(268) - FOOTER_H;
  return {
    pageSize: 'A4',
    pageMargins: pageMargins(top, footerTop),
    defaultStyle: { font: 'LiberationSans', fontSize: px(10), color: C.text },
    footer: footerDef('AGO Fruit | Báo cáo giám định hàng nhập / Import Inspection Report', (cur, total) => `Trang/Page ${cur}/${total}`),
    content: pages(list),
  };
}
