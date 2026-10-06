// LUẬT KHOÁ hồ sơ QC — MỘT chỗ duy nhất.
// Hồ sơ đã "Hoàn tất QC" (qc_done_at có giá trị) thì KHOÁ: kết quả đã dùng để đóng đơn sản xuất,
// không ai được sửa bằng chứng sau đó (muốn sửa phải "Mở lại" trước).
// Dùng bởi: completion.assertEditable (chặn các action HTTP sửa hồ sơ) và qcFiles.syncOrderInfo (gRPC; CHỈ để
// báo `locked` trong response — 9 ô thuộc đơn vẫn được ghi cả khi khoá, owner chốt 2026-10-06). Đổi luật ở đây
// thì cả hai đổi theo.
export function isLocked(fileRow) {
  return Boolean(fileRow && fileRow.qc_done_at);
}
