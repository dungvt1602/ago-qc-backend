// Logic nghiệp vụ cho ảnh: nhận dataURL từ frontend, upload Storage, gắn link vào đúng mục.
import * as qcFilesRepo from '../repositories/qcFiles.repo.js';
import * as dailyRepo from '../repositories/daily.repo.js';
import * as containerRepo from '../repositories/container.repo.js';
import { uploadDataUrl } from '../lib/storage.js';
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
  } else {
    throw new Error('Sai targetType: ' + p.targetType);
  }
  return getQCFile(p.qcFileId);
}
