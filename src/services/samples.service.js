// Logic nghiệp vụ cho "mẫu QC" (hàng nhập): thêm mẫu, xóa mẫu.
// Ảnh của mẫu được xử lý trong photos.service.js (targetType = 'sample').
import * as samplesRepo from '../repositories/samples.repo.js';
import { removeFiles } from '../lib/storage.js';
import { config } from '../config/env.js';
import { getQCFile } from './qcFiles.service.js';

// Lấy danh sách đường dẫn ảnh từ cột photos (JSONB) của 1 mẫu.
export function samplePaths(sample) {
  return ((sample && sample.photos) || []).filter(Boolean).map((x) => x && x.path).filter(Boolean);
}

export async function addSample(p) {
  const created = await samplesRepo.insert(p.dailyQcId);
  if (!created) throw new Error('Không tìm thấy phiên QC để thêm mẫu');
  const sample = await samplesRepo.findById(created.id);
  return getQCFile(sample.qc_file_id);
}

export async function deleteSample(p) {
  const sample = await samplesRepo.findById(p.sampleId);
  if (!sample) throw new Error('Không tìm thấy mẫu');
  try { await removeFiles(config.photoBucket, samplePaths(sample)); } catch (e) { /* bỏ qua lỗi xóa ảnh */ }
  await samplesRepo.remove(p.sampleId);
  return getQCFile(sample.qc_file_id);
}
