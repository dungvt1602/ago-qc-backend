// Hoàn tất QC: đánh dấu xong / mở lại, và KHÓA hồ sơ sau khi xong.
// Backend checklist đọc kết quả này qua gRPC (done = qc_done_at IS NOT NULL) để cho phép đóng đơn sản xuất.
import * as repo from '../repositories/qcFiles.repo.js';
import * as dailyRepo from '../repositories/daily.repo.js';
import * as samplesRepo from '../repositories/samples.repo.js';
import { getQCFile } from './qcFiles.service.js';
import { photoProgress } from '../lib/progress.js';

// Chỉ cho hoàn tất khi đủ 100% ảnh. Kiểm ở đây (không tin frontend).
export async function completeQC(p) {
  const data = await getQCFile(p.qcFileId);
  if (data.qcFile.QC_DONE_AT) return data; // bấm 2 lần cũng vô hại
  const prog = photoProgress(data);
  if (prog.units === 0) throw new Error(`Chưa có ${prog.unitLabel} nào — không thể hoàn tất.`);
  if (!prog.complete) throw new Error(`Chưa đủ ảnh: mới ${prog.filled}/${prog.total} ô. Chụp đủ 100% rồi mới hoàn tất được.`);
  await repo.update(p.qcFileId, { qc_done_at: new Date() });
  return getQCFile(p.qcFileId);
}

export async function reopenQC(p) {
  await repo.update(p.qcFileId, { qc_done_at: null });
  return getQCFile(p.qcFileId);
}

// Payload mỗi action chỉ mang 1 trong 3 loại id -> lần ngược về hồ sơ.
async function resolveQcFileId(p) {
  if (p.qcFileId) return p.qcFileId;
  if (p.dailyQcId) { const s = await dailyRepo.findSessionById(p.dailyQcId); return s ? s.qc_file_id : null; }
  if (p.sampleId) { const sm = await samplesRepo.findById(p.sampleId); return sm ? sm.qc_file_id : null; }
  return null;
}

// Chặn mọi thay đổi khi hồ sơ đã Hoàn tất: kết quả này đã được dùng để đóng đơn sản xuất,
// không được để ai xóa/sửa bằng chứng sau đó. Muốn sửa phải "Mở lại" trước (có ghi vết).
export async function assertEditable(p) {
  const id = await resolveQcFileId(p);
  if (!id) return;
  const f = await repo.findById(id);
  if (f && f.qc_done_at) {
    throw new Error('Hồ sơ đã Hoàn tất QC nên đang KHÓA. Vào "Tổng quan" bấm "Mở lại" nếu thật sự cần sửa.');
  }
}
