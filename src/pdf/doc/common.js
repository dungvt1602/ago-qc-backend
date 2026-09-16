// Khối dùng chung cho các khuôn PDF dựng bằng pdfmake.
//
// Các khuôn này được chuyển 1:1 từ template HTML/CSS cũ (in bằng Chrome). Để bản in giống bản cũ
// nhất có thể, mọi kích thước vẫn được ghi bằng px CSS như trong template rồi đổi sang pt (1px = 0.75pt),
// và chiều cao dòng được tính theo đúng cách Chrome làm tròn số đo font (xem chromeLine).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const px = (n) => n * 0.75;
export const mmPx = (n) => Math.round((n * 96) / 25.4); // mm -> px (Chrome làm tròn về px nguyên khi in)

// Màu sắc lấy nguyên từ CSS cũ.
export const C = {
  green: '#3f7f25',      // tiêu đề, nền mục, đường kẻ đậm
  line: '#5d8d3e',       // viền bảng
  label: '#e9f1e3',      // nền ô nhãn
  text: '#111',
  grey: '#777',          // footer, ghi chú ký tên
  note: '#666',          // ghi chú cuối trang
  placeholder: '#999',   // "[chèn hình ảnh tại đây]"
  dark: '#17220f',       // số báo cáo (hàng nhập)
};

// Font: Liberation Sans — cùng số đo với Arial (template cũ ghi Arial; trên máy Linux của Render, Chrome cũng
// thay Arial bằng chính font này). Có đủ dấu tiếng Việt. Giấy phép SIL OFL — xem fonts/LICENSE.
export const FONTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
export const FONTS = {
  LiberationSans: {
    normal: path.join(FONTS_DIR, 'LiberationSans-Regular.ttf'),
    bold: path.join(FONTS_DIR, 'LiberationSans-Bold.ttf'),
    italics: path.join(FONTS_DIR, 'LiberationSans-Italic.ttf'),
    bolditalics: path.join(FONTS_DIR, 'LiberationSans-BoldItalic.ttf'),
  },
};

// Chiều cao dòng "line-height: normal" của Chrome với Arial/Liberation: Chrome làm tròn ascent, descent, lineGap
// ra px nguyên rồi cộng lại (10px -> 9+2+0 = 11px; 20px -> 18+4+1 = 23px). pdfmake thì lấy (ascent+descent)
// = 1.1172 × cỡ chữ. Hệ số lineHeight của pdfmake được suy ra để dòng cao đúng bằng Chrome.
const PDFMAKE_LINE = 1.1172;
export function chromeLine(sizePx) {
  return Math.round(0.9053 * sizePx) + Math.round(0.2119 * sizePx) + Math.round(0.0327 * sizePx);
}
export function lineHeightFor(sizePx, linePx = chromeLine(sizePx)) {
  return linePx / (PDFMAKE_LINE * sizePx);
}

// Khổ giấy A4 (pt) và bề rộng phần nội dung: Chrome in ra 711px = 533.25pt (lề trái 42px, lề phải 40px).
export const PAGE = { width: 595.28, height: 841.89 };
export const CONTENT_W = 533.25;
export const MARGIN_L = px(42);
export const MARGIN_R = PAGE.width - MARGIN_L - CONTENT_W;

// Chiều cao footer (đường kẻ 1px + đệm 4px + 1 dòng chữ 9px) — footer cũ nằm sát đáy .page (position:absolute).
export const FOOTER_H = 1 + 4 + chromeLine(9);

// Lề trang: footerTopPx = vị trí mép trên footer tính từ đầu trang (px). Phần nội dung kết thúc ngay trên footer.
export function pageMargins(topPx, footerTopPx) {
  return [MARGIN_L, px(topPx), MARGIN_R, PAGE.height - px(footerTopPx)];
}

// Chuỗi hiển thị: null/undefined -> ''. (Template hàng nhập/khách hàng dùng dấu thay thế riêng, xem từng file.)
export const ph = (x) => (x === null || x === undefined) ? '' : String(x);

// Chrome không xuống dòng sau dấu "/" nằm giữa hai từ (COORDINATION/PURCHASING), pdfmake thì có. Chèn ZERO WIDTH
// JOINER (U+200D, rộng 0) sau dấu "/" để pdfmake cũng giữ nguyên. Chỉ dùng cho nhãn/tiêu đề cố định, không dùng cho
// dữ liệu người nhập (để tìm kiếm / sao chép trong PDF không bị lẫn ký tự ẩn).
export const nb = (text) => String(text).replace(/(\S)\/(?=\S)/g, '$1/\u200D');

// Đoạn chữ. o: size (px, mặc định 10), line (px, mặc định = line-height normal), bold, italic, color, align,
// ls (letter-spacing px), margin ([trái, trên, phải, dưới] px). text có thể là mảng inline của pdfmake.
export function txt(text, o = {}) {
  const size = o.size ?? 10;
  const node = { text, fontSize: px(size), lineHeight: lineHeightFor(size, o.line) };
  if (o.bold) node.bold = true;
  if (o.italic) node.italics = true;
  if (o.color) node.color = o.color;
  if (o.align) node.alignment = o.align;
  if (o.ls) node.characterSpacing = px(o.ls);
  const margin = (o.margin || [0, 0, 0, 0]).map(px);
  // line-height lớn hơn cỡ chữ: Chrome chia đều phần dư lên trên/dưới (half-leading) nên chữ nằm thấp hơn
  // pdfmake (vốn dồn hết xuống dưới). Đẩy khối xuống bằng lề trên và bù lại bằng lề dưới âm -> tổng cao không đổi.
  if (o.line) {
    const hl = (o.line - (Math.round(0.9053 * size) + Math.round(0.2119 * size))) / 2;
    if (hl > 0) { margin[1] += px(hl); margin[3] -= px(hl); }
  }
  if (margin.some((m) => m !== 0)) node.margin = margin;
  return node;
}

// Dòng chữ nhỏ nằm trong khối có cỡ chữ lớn hơn (vd dòng tiếng Anh 10px trong khối 14px của quốc hiệu):
// Chrome đặt baseline của chữ nhỏ trùng baseline của khối lớn. Bù bằng margin để vị trí và tổng chiều cao dòng
// (linePx) giống hệt.
export function inlineLine(text, o, strutPx, linePx) {
  const size = o.size ?? 10;
  const strutAscent = (linePx - (Math.round(0.9053 * strutPx) + Math.round(0.2119 * strutPx))) / 2 + Math.round(0.9053 * strutPx);
  const top = strutAscent - 0.9053 * size;             // baseline pdfmake nằm ở 0.9053 × size từ mép trên
  const own = chromeLine(size);
  return txt(text, { ...o, margin: [0, top, 0, Math.max(0, linePx - top - own)] });
}

// Đường kẻ ngang hết bề rộng (thay border-bottom/border-top của div). pdfmake tính chiều cao canvas theo toạ độ y
// lớn nhất mà không tính độ dày nét, nên vẽ nét ở y = w/2 và bù w/2 vào lề dưới để chiếm đúng w px.
export function hr(thicknessPx, color, marginPx = [0, 0, 0, 0], widthPt = CONTENT_W) {
  const w = px(thicknessPx);
  return {
    canvas: [{ type: 'line', x1: 0, y1: w / 2, x2: widthPt, y2: w / 2, lineWidth: w, lineColor: color }],
    margin: [px(marginPx[0]), px(marginPx[1]), px(marginPx[2]), px(marginPx[3]) + w / 2],
  };
}

// Nút rỗng cao ~0 (pdfmake cho chữ rỗng cao bằng 1 dòng, nên phải ép cỡ chữ về 1).
export const empty = () => ({ text: '', fontSize: 1, lineHeight: 0.001 });

// Khoảng trống dọc (thay <br> hoặc margin của div): 1 <br> trong body 10px cao 11px.
export const gap = (h = chromeLine(10)) => ({ ...empty(), margin: [0, 0, 0, px(h)] });

// Bố cục bảng theo CSS `border:1px solid; padding:...`. pad = [trên, phải, dưới, trái] px; padByRow(i) trả về đệm
// trên/dưới riêng cho hàng i (lưới ảnh: mỗi loại hàng đệm khác nhau) — khi đó đệm trái/phải (áp theo cột trong
// pdfmake) lấy từ padLR = [trái, phải]. line = 0 -> không kẻ (bảng chữ ký).
export function tableLayout({ line = 1, pad = [5, 5, 5, 5], padByRow, padLR } = {}) {
  const row = (i, k) => px((padByRow ? padByRow(i) : pad)[k]);
  const lr = padLR || [pad[3], pad[1]];
  return {
    hLineWidth: () => px(line),
    vLineWidth: () => px(line),
    hLineColor: () => C.line,
    vLineColor: () => C.line,
    paddingTop: (i) => row(i, 0),
    paddingRight: () => px(lr[1]),
    paddingBottom: (i) => row(i, 2),
    paddingLeft: () => px(lr[0]),
  };
}

// Bề rộng cột kiểu `table-layout: fixed` với các ô nhãn có `width: N%`: cột nhãn = N% bề rộng bảng + đệm + viền,
// các cột còn lại chia đều phần dư. Trả về mảng widths cho pdfmake (số = bề rộng nội dung; '*' = chia đều).
export function fixedWidths(labelPct, cols = 4) {
  const labelContent = (labelPct / 100) * CONTENT_W; // pdfmake tự cộng đệm + viền vào cột
  const out = [];
  for (let i = 0; i < cols; i++) out.push(i % 2 === 0 ? labelContent : '*');
  return out;
}

// Ô bảng thông tin: nhãn (nền xanh nhạt, đậm) hoặc giá trị. Template cũ căn giữa dọc (vertical-align: middle),
// hàng nhập căn trên (top).
export function cell(text, { label = false, span = 1, valign = 'middle', size } = {}) {
  const node = txt(label ? nb(text) : text, { bold: label, size });
  if (label) node.fillColor = C.label;
  if (span > 1) node.colSpan = span;
  if (valign === 'middle') node.verticalAlignment = 'middle';
  return node;
}

// Hàng tiêu đề mục (th.section colspan=4): nền xanh, chữ trắng đậm.
export function sectionRow(title, cols = 4) {
  const row = [{ ...txt(title, { bold: true, color: '#fff' }), fillColor: C.green, colSpan: cols }];
  for (let i = 1; i < cols; i++) row.push({});
  return row;
}

// Bảng thông tin 4 cột: rows = [[nhãn, giá trị, nhãn, giá trị], ...] hoặc [[nhãn, {text, span:3}]].
// widths mặc định: chia đều (bảng mở đầu bằng hàng mục colspan=4 nên Chrome bỏ qua width:17% của ô nhãn).
// minH: chiều cao tối thiểu phần nội dung mỗi hàng dữ liệu (td { height: 22px }).
export function infoTable({ section, rows, widths = ['*', '*', '*', '*'], valign = 'middle', pad = [5, 5, 5, 5], size, minH = 0 }) {
  const body = [];
  if (section) body.push(sectionRow(section, widths.length));
  rows.forEach((r) => {
    const out = [];
    r.forEach((c, i) => {
      const isLabel = i % 2 === 0;
      if (c && typeof c === 'object' && !Array.isArray(c) && c.span) {
        out.push(cell(c.text, { label: isLabel, span: c.span, valign, size }));
        for (let k = 1; k < c.span; k++) out.push({});
      } else {
        out.push(cell(c, { label: isLabel, valign, size }));
      }
    });
    body.push(out);
  });
  const table = { widths, body };
  if (minH) table.heights = (i) => (section && i === 0 ? 0 : px(minH));
  return { table, layout: tableLayout({ pad }) };
}

// Bảng ký tên: không viền, chữ đậm xanh căn giữa, ghi chú nghiêng xám bên dưới.
export function signTable(entries, { padTop = 18, pad = [5, 5, 5, 5], noteMargin = 4, valign = 'middle' } = {}) {
  const body = [entries.map(([title, note]) => {
    const node = {
      stack: [
        txt(nb(title), { bold: true, color: C.green, align: 'center' }),
        txt(nb(note), { italic: true, color: C.grey, align: 'center', margin: [0, noteMargin, 0, 0] }),
      ],
    };
    if (valign === 'middle') node.verticalAlignment = 'middle';
    return node;
  })];
  return {
    table: { widths: entries.map(() => '*'), body },
    layout: tableLayout({ line: 0, pad: [padTop, pad[1], pad[2], pad[3]] }),
  };
}

// Lưới ảnh — thay cho table.photo-grid với mỗi ô là một chồng div (tiêu đề / ảnh / các dòng mô tả).
// Mọi đường kẻ trong ô cũ đều cùng màu và độ dày với viền ô nên dựng thành MỘT bảng phẳng: mỗi "hàng ảnh"
// = nhiều hàng bảng (1 hàng cho mỗi phần của ô), ô trống dùng rowSpan để không có kẻ ngang bên trong.
//   cols        số cột
//   items       danh sách ô (null = ô trống), tự cắt thành các hàng ảnh
//   rowsPerCell số hàng bảng cho một ô
//   parts(item) -> mảng { node, pad: [t,r,b,l] px, minH: px }
//   fillRows    số hàng ảnh tối thiểu (trang ảnh container cũ luôn vẽ đủ 3 hàng <tr>, hàng trống cao emptyRowH px)
export function photoGrid({ cols, items, rowsPerCell, parts, fillRows = 0, emptyRowH = 0 }) {
  const body = [];
  const rowPad = [];
  const rowMinH = [];
  const groups = [];
  for (let i = 0; i < items.length; i += cols) groups.push(items.slice(i, i + cols));
  while (groups.length < fillRows) groups.push(null);

  // pdfmake chỉ cho đệm trái/phải theo CỘT (đệm trên/dưới mới theo hàng). Lấy đệm trái/phải nhỏ nhất trong các
  // phần của ô làm đệm cột, phần dư của từng hàng chuyển thành margin của nút bên trong ô.
  const sample = items.find(Boolean);
  const sampleParts = sample ? parts(sample) : [];
  const padL = sampleParts.length ? Math.min(...sampleParts.map((p) => p.pad[3])) : 0;
  const padR = sampleParts.length ? Math.min(...sampleParts.map((p) => p.pad[1])) : 0;
  const withMargin = (node, pad) => {
    const extraL = pad[3] - padL;
    const extraR = pad[1] - padR;
    if (!extraL && !extraR) return node;
    const m = node.margin || [0, 0, 0, 0];
    return { ...node, margin: [m[0] + px(extraL), m[1], m[2] + px(extraR), m[3]] };
  };

  groups.forEach((group) => {
    if (!group) {
      // Hàng trống: <tr><td>&nbsp;</td>...</tr> -> cao bằng 1 dòng chữ (hoặc 0 nếu ô rỗng thật sự).
      body.push(Array.from({ length: cols }, () => empty()));
      rowPad.push([0, 0, 0, 0]);
      rowMinH.push(emptyRowH);
      return;
    }
    const cellsParts = [];
    for (let c = 0; c < cols; c++) cellsParts.push(group[c] ? parts(group[c]) : null);
    for (let r = 0; r < rowsPerCell; r++) {
      const row = [];
      let pad = [0, 0, 0, 0];
      let minH = 0;
      for (let c = 0; c < cols; c++) {
        const p = cellsParts[c];
        if (!p) {
          // Ô trống chiếm trọn chiều cao hàng ảnh (rowSpan), các hàng sau đặt {} theo quy ước pdfmake.
          row.push(r === 0 ? { ...empty(), rowSpan: rowsPerCell } : {});
        } else {
          row.push(withMargin(p[r].node, p[r].pad));
          pad = p[r].pad;
          minH = Math.max(minH, p[r].minH || 0);
        }
      }
      body.push(row);
      rowPad.push(pad);
      rowMinH.push(minH);
    }
  });

  return {
    table: {
      widths: Array.from({ length: cols }, () => '*'),
      body,
      heights: (i) => px(rowMinH[i] || 0),
      dontBreakRows: true,
    },
    layout: tableLayout({ padByRow: (i) => rowPad[i] || [0, 0, 0, 0], padLR: [padL, padR] }),
  };
}

// Bề rộng nội dung một ô của lưới `cols` cột với đệm trái+phải padLR px (để `fit` ảnh vừa ô như max-width:100%).
export function gridCellWidth(cols, padLR) {
  return (CONTENT_W - px(1)) / cols - px(1) - px(padLR);
}

// Ảnh trong ô: căn giữa cả hai chiều trong khung boxH px (flex center); ảnh cao tối đa imgMaxH, rộng tối đa ô.
export function photoNode(imageKey, { cellW, imgMaxH, placeholder }) {
  if (imageKey) {
    return { image: imageKey, fit: [cellW, px(imgMaxH)], alignment: 'center', verticalAlignment: 'middle' };
  }
  return { ...txt(placeholder, { italic: true, color: C.placeholder, align: 'center' }), verticalAlignment: 'middle' };
}

// Header/footer chung của khuôn nội bộ (hàng xuất) và khuôn khách hàng: logo 42px bên trái, khối công ty bên phải,
// gạch xanh 2px, cách nội dung 10px.
// sep: chuỗi giữa website và email (template cũ dùng &nbsp; khác nhau giữa các khuôn).
export function companyHeader(d, { name, address, website, email, addressPrefix = '', sep = ' \u00A0 | \u00A0 ' }) {
  const logo = d.logo
    ? { image: 'logo', width: px(42) * d.logo.ratio, height: px(42) }
    : txt([{ text: 'ago' }, { text: 'fruit', color: '#5a9d35' }], { size: 28, bold: true, color: C.green, ls: -1 });
  return [
    {
      columns: [
        { width: 'auto', ...logo },
        {
          width: '*',
          stack: [
            txt(name, { size: 12, line: 15.6, bold: true, color: C.green, align: 'right' }),
            txt(addressPrefix + address, { size: 10, line: 13, align: 'right' }),
            txt(`Website: ${website}${sep}Email: ${email}`, { size: 10, line: 13, italic: true, align: 'right' }),
          ],
        },
      ],
      columnGap: 0,
    },
    hr(2, C.green, [0, 6, 0, 10]),
  ];
}

// Footer: đường kẻ xanh 1px, chữ nghiêng xám 9px hai bên. pageLabel(cur, total) -> "Trang/Page 1/6".
export function footerDef(leftText, pageLabel) {
  return (cur, total) => ({
    margin: [MARGIN_L, 0, MARGIN_R, 0],
    stack: [
      hr(1, C.green),
      {
        columns: [
          txt(leftText, { size: 9, italic: true, color: C.grey }),
          txt(pageLabel(cur, total), { size: 9, italic: true, color: C.grey, align: 'right' }),
        ],
        margin: [0, px(4), 0, 0],
      },
    ],
  });
}

// Khối tiêu đề .title: h1 (xanh, đậm) + h2 (nghiêng) tuỳ chọn, căn giữa. margin = [trên, dưới] px.
export function titleBlock(h1, h2, { h1Size = 20, h2Size = 14, margin = [12, 12], ls = 0.2 } = {}) {
  const stack = [txt(h1, { size: h1Size, bold: true, color: C.green, align: 'center', ls })];
  if (h2) stack.push(txt(h2, { size: h2Size, italic: true, color: C.green, align: 'center', margin: [0, 2, 0, 0] }));
  return { stack, margin: [0, px(margin[0]), 0, px(margin[1])] };
}

// Gom các khối của một trang; từ trang thứ hai trở đi ngắt trang trước khi vẽ.
export function pages(list) {
  return list.map((nodes, i) => (i === 0 ? { stack: nodes } : { stack: nodes, pageBreak: 'before' }));
}
