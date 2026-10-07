// LUẬT KHOÁ hồ sơ QC — MỘT chỗ duy nhất.
// Hồ sơ đã "Hoàn tất QC" (qc_done_at có giá trị) thì KHOÁ: kết quả đã dùng để đóng đơn sản xuất,
// không ai được sửa bằng chứng sau đó (muốn sửa phải "Mở lại" trước).
// Dùng bởi: completion.assertEditable (CHẶN các action HTTP sửa hồ sơ — đổi luật ở đây thì chỗ này đổi theo) và
// qcFiles.syncOrderInfo (gRPC; chỉ dùng để BÁO `locked` trong response và log, KHÔNG quyết định có ghi hay không —
// 9 ô thuộc đơn luôn được ghi, owner chốt 2026-10-06; đổi luật khoá không đổi việc ghi đó).
export function isLocked(fileRow) {
  return Boolean(fileRow && fileRow.qc_done_at);
}
