// Đếm ô ảnh đã chụp / tổng ô ảnh của một hồ sơ QC (dữ liệu do getQCFile ghép sẵn).
// Hàm THUẦN (không đụng DB) -> dùng được ở cả kiểm tra Hoàn tất (backend) lẫn thanh tiến độ (frontend).
//
// Quy ước "đủ ảnh":
//   Hàng xuất: mọi hạng mục của mọi đợt QC (6/đợt) + đủ 21 ảnh container, và có >= 1 đợt.
//   Hàng nhập: mọi ô của mọi mẫu (4/mẫu) + đủ 9 ảnh container (13-21), và có >= 1 mẫu.
const hasPhoto = (it) => Boolean(it && (it.PHOTO_PATH || it.PHOTO_URL));

export function photoProgress(data) {
  const isImport = data.qcFile.QC_TYPE === 'IMPORT';
  let filled = 0, total = 0, units = 0;

  for (const sess of data.dailySessions || []) {
    if (isImport) {
      for (const sm of sess.samples || []) {
        units++;
        total += 4;
        filled += (sm.PHOTOS || []).filter((p) => p && (p.url || p.path)).length;
      }
    } else {
      units++;
      for (const it of sess.items || []) { total++; if (hasPhoto(it)) filled++; }
    }
  }
  for (const it of data.containerItems || []) { total++; if (hasPhoto(it)) filled++; }

  return {
    filled, total, units,
    unitLabel: isImport ? 'mẫu' : 'đợt QC',
    complete: units > 0 && total > 0 && filled === total,
  };
}
