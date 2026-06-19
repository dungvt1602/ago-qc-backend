// Tiện ích chuyển dòng DB (cột snake_case viết thường) sang object mà frontend mong đợi
// (khóa UPPER_SNAKE_CASE, ví dụ qc_file_no -> QC_FILE_NO). Nhờ đó giữ nguyên "hợp đồng" API cũ,
// frontend gần như không phải sửa.
// Đồng thời đổi null -> '' để khớp hành vi cũ (Google Sheet trả chuỗi rỗng cho ô trống).
export function upperKeys(row) {
  if (!row) return null;
  const out = {};
  for (const key of Object.keys(row)) {
    out[key.toUpperCase()] = row[key] === null ? '' : row[key];
  }
  return out;
}
