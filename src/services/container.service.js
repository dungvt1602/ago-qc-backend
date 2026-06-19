// Logic nghiệp vụ cho ảnh container: lưu kết quả 1 mục ảnh.
import * as containerRepo from '../repositories/container.repo.js';
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import { CONTAINER_ITEMS } from '../data/catalog.js';
import { getQCFile } from './qcFiles.service.js';

export async function saveContainerItem(p) {
  const def = CONTAINER_ITEMS.find((x) => x.no === Number(p.photoNo));
  if (!def) throw new Error('Sai số ảnh container: ' + p.photoNo);
  const file = await qcFilesRepo.findById(p.qcFileId);
  if (!file) throw new Error('Không tìm thấy hồ sơ QC');

  await containerRepo.upsertResult(p.qcFileId, def, {
    pass_rate: p.passRate || '',
    fail_rate: p.failRate || '',
    remarks: p.remarks || '',
  });
  return getQCFile(p.qcFileId);
}
