// Logic nghiệp vụ cho QC hàng ngày: thêm phiên QC, lưu kết quả hạng mục.
import { withTransaction } from '../lib/db.js';
import * as dailyRepo from '../repositories/daily.repo.js';
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import { DAILY_ITEMS } from '../data/catalog.js';
import { todayStr } from '../lib/util.js';
import { getQCFile } from './qcFiles.service.js';

export async function addDailyQC(p) {
  const file = await qcFilesRepo.findById(p.qcFileId);
  if (!file) throw new Error('Không tìm thấy hồ sơ QC');
  const qcDate = p.qcDate || todayStr();

  // Tạo phiên + 6 hạng mục trong 1 transaction để dữ liệu luôn nhất quán.
  await withTransaction(async (client) => {
    const sessionId = await dailyRepo.insertSession(client, {
      qc_file_id: p.qcFileId,
      lot_code: file.lot_code,
      qc_date: qcDate,
      warehouse: p.warehouse || '',
      qc_staff: p.qcStaff || file.qc_staff || '',
    });
    await dailyRepo.insertItems(client, sessionId, p.qcFileId, DAILY_ITEMS);
  });

  await qcFilesRepo.updateCounts(p.qcFileId);
  return getQCFile(p.qcFileId);
}

export async function saveDailyQCItem(p) {
  const def = DAILY_ITEMS.find((d) => d.code === p.itemCode);
  if (!def) throw new Error('Sai mã hạng mục QC: ' + p.itemCode);
  const session = await dailyRepo.findSessionById(p.dailyQcId);
  if (!session) throw new Error('Không tìm thấy ngày QC');

  await dailyRepo.upsertItemResult(p.dailyQcId, p.itemCode, def, {
    pass_rate: p.passRate || '',
    fail_rate: p.failRate || '',
    remarks: p.remarks || '',
  });
  return getQCFile(session.qc_file_id);
}
