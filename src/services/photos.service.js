// Logic nghiệp vụ cho ảnh: nhận dataURL từ frontend, upload Storage, gắn link vào đúng mục.
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import * as dailyRepo from '../repositories/daily.repo.js';
import * as containerRepo from '../repositories/container.repo.js';
import * as samplesRepo from '../repositories/samples.repo.js';
import { uploadDataUrl, removeFiles } from '../lib/storage.js';
import { config } from '../config/env.js';
import { CONTAINER_ITEMS } from '../data/catalog.js';
import { sanitizeFileName, nowStr } from '../lib/util.js';
import { getQCFile } from './qcFiles.service.js';

export async function uploadPhoto(p) {
  const file = await qcFilesRepo.findById(p.qcFileId);
  if (!file) throw new Error('Không tìm thấy hồ sơ QC');
  if (!p.dataUrl) throw new Error('Thiếu ảnh dataUrl');

  const lot = sanitizeFileName(file.lot_code || 'NO_LOT');
  const fileName = sanitizeFileName(p.fileName || `photo_${Date.now()}.jpg`);
  const path = `${lot}/${Date.now()}_${fileName}`;
  const photo = await uploadDataUrl(config.photoBucket, path, p.dataUrl);
  const capturedAt = p.capturedAt || nowStr();

  if (p.targetType === 'daily') {
    await dailyRepo.updateItemPhoto(p.dailyQcId, p.itemCode, { ...photo, capturedAt });
  } else if (p.targetType === 'container') {
    const def = CONTAINER_ITEMS.find((x) => x.no === Number(p.photoNo));
    if (!def) throw new Error('Sai số ảnh container');
    await containerRepo.upsertPhoto(p.qcFileId, def, { ...photo, capturedAt });
  } else if (p.targetType === 'sample') {
    // Hàng nhập: gắn ảnh vào ô (slot 1-4) của 1 mẫu.
    const sample = await samplesRepo.findById(p.sampleId);
    if (!sample) throw new Error('Không tìm thấy mẫu');
    const slot = Math.max(1, Math.min(4, Number(p.slot) || 1));
    const photos = Array.isArray(sample.photos) ? sample.photos.slice(0, 4) : [];
    while (photos.length < 4) photos.push(null);
    photos[slot - 1] = { url: photo.url, path: photo.path, captured_at: capturedAt };
    await samplesRepo.updatePhotos(p.sampleId, photos);
  } else {
    throw new Error('Sai targetType: ' + p.targetType);
  }
  return getQCFile(p.qcFileId);
}

// Xóa ảnh của 1 mục: gỡ file khỏi Storage rồi xóa link trong DB.
export async function deletePhoto(p) {
  if (p.targetType === 'daily') {
    const item = await dailyRepo.findItem(p.dailyQcId, p.itemCode);
    if (item && item.photo_path) {
      try { await removeFiles(config.photoBucket, [item.photo_path]); } catch (e) { /* bỏ qua */ }
    }
    await dailyRepo.clearItemPhoto(p.dailyQcId, p.itemCode);
    const session = await dailyRepo.findSessionById(p.dailyQcId);
    if (!session) throw new Error('Không tìm thấy phiên QC');
    return getQCFile(session.qc_file_id);
  }
  if (p.targetType === 'container') {
    const row = await containerRepo.findOne(p.qcFileId, Number(p.photoNo));
    if (row && row.photo_path) {
      try { await removeFiles(config.photoBucket, [row.photo_path]); } catch (e) { /* bỏ qua */ }
    }
    await containerRepo.clearPhoto(p.qcFileId, Number(p.photoNo));
    return getQCFile(p.qcFileId);
  }
  if (p.targetType === 'sample') {
    const sample = await samplesRepo.findById(p.sampleId);
    if (!sample) throw new Error('Không tìm thấy mẫu');
    const slot = Math.max(1, Math.min(4, Number(p.slot) || 1));
    const photos = Array.isArray(sample.photos) ? sample.photos.slice(0, 4) : [];
    while (photos.length < 4) photos.push(null);
    const old = photos[slot - 1];
    if (old && old.path) { try { await removeFiles(config.photoBucket, [old.path]); } catch (e) { /* bỏ qua */ } }
    photos[slot - 1] = null;
    await samplesRepo.updatePhotos(p.sampleId, photos);
    return getQCFile(sample.qc_file_id);
  }
  throw new Error('Sai targetType: ' + p.targetType);
}
