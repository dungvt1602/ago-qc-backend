// Chuyển bản PDF SONG NGỮ ("Tiếng Việt / English") thành bản THUẦN TIẾNG ANH.
//
// Cách làm: template vẫn viết song ngữ như cũ. Sau khi render ra HTML, ta chỉ sửa
// các Ô NHÃN CỐ ĐỊNH (nhãn bảng, thanh tiêu đề mục, tiêu đề trang, ghi chú, chân trang).
// KHÔNG đụng vào nội dung QC gõ tay (nhận xét, lý do không đạt, tên hàng...) vì
// máy không tự dịch được — phần đó QC gõ ngôn ngữ nào thì ra ngôn ngữ đó.
//
// Lợi ích: sau này thêm nhãn mới dạng "Tiếng Việt / English" là tự động có bản tiếng Anh,
// không phải sửa ở 2 nơi.

// "Mã lô / Lot code" -> "Lot code".
// Giữ tiền tố mục ("A. THÔNG TIN... / LOT INFORMATION" -> "A. LOT INFORMATION")
// và giữ dấu ngoặc ("[chèn ảnh / insert photo]" -> "[insert photo]").
export function pickEn(text) {
  const s = String(text);
  const i = s.lastIndexOf(' / ');
  if (i < 0) return s; // không phải nhãn song ngữ -> để nguyên
  const en = s.slice(i + 3);
  const m = s.match(/^(\[|[A-Z]\.\s)/);
  if (!m) return en;
  if (m[1] === '[') return en.startsWith('[') ? en : '[' + en;
  return m[1] + en;
}

// Chuỗi nhiều đoạn ngăn bằng " | " -> lấy vế tiếng Anh của từng đoạn.
const pickEnParts = (t) => String(t).split(' | ').map(pickEn).join(' | ');

export function toEnglish(html) {
  return html
    // Tiêu đề trang: <h1>Tiếng Việt</h1><h2>English</h2> -> chỉ giữ <h1>English</h1>
    .replace(/<h1>[^<]*<\/h1>\s*<h2>([^<]*)<\/h2>/g, '<h1>$1</h1>')
    // Quốc hiệu: chỉ giữ các dòng tiếng Anh (<span class="en">)
    .replace(/<div class="republic">([\s\S]*?)<\/div>/g, (m, inner) => {
      const en = [...inner.matchAll(/<span class="en">([^<]*)<\/span>/g)].map((x) => x[1]);
      return `<div class="republic">${en.join('<br>')}</div>`;
    })
    // Ô nhãn trong bảng + thanh tiêu đề mục (A. / B. / C.)
    .replace(/(<t[dh] class="(?:label|section)"[^>]*>)([^<]*)(<\/t[dh]>)/g, (m, a, t, b) => a + pickEn(t) + b)
    // Tiêu đề ảnh, tên mục, số báo cáo, ghi chú chữ ký, ô "chưa có ảnh"
    .replace(/(<div class="(?:sec|box-title|pbox-title|report-no|sign-note|placeholder)"[^>]*>)([^<]*)(<\/div>)/g,
      (m, a, t, b) => a + pickEn(t) + b)
    // Nhãn in đậm trong ô ảnh: <b>Tỉ lệ đạt / Pass rate:</b>
    .replace(/(<b>)([^<]*)(<\/b>)/g, (m, a, t, b) => a + pickEn(t) + b)
    // Chức danh ký tên (đứng ngay trước ghi chú chữ ký)
    .replace(/>([^<>]+)(<div class="sign-note">)/g, (m, t, rest) => '>' + pickEn(t) + rest)
    // Ghi chú: giữ phần tiếng Anh — ưu tiên <span class="en">, nếu không thì lấy dòng sau <br>
    .replace(/(<div class="note"[^>]*>)([\s\S]*?)(<\/div>)/g, (m, a, t, b) => {
      const spans = [...t.matchAll(/<span class="en">([\s\S]*?)<\/span>/g)].map((x) => x[1]);
      if (spans.length) return a + spans.join(' ') + b;
      return a + (t.includes('<br>') ? t.slice(t.lastIndexOf('<br>') + 4) : t) + b;
    })
    // Chân trang: "AGO Fruit | Hồ sơ QC lô hàng / Lot QC File | Nội bộ / Internal"
    .replace(/(<div>)(AGO Fruit \|[^<]*)(<\/div>)/g, (m, a, t, b) => a + pickEnParts(t) + b)
    // Vài chỗ viết dính "Việt/English" (không có dấu cách) nên phải liệt kê riêng.
    .replace(/Trang\/Page/g, 'Page')
    .replace(/ngày\/days/g, 'days')
    .replace(/kho\/warehouse/g, 'warehouse');
}
