// Đếm ô ảnh đã chụp / tổng ô ảnh của một hồ sơ QC (dữ liệu do getQCFile ghép sẵn).
// Hàm THUẦN (không đụng DB) -> dùng cho: nút Hoàn tất (backend kiểm), thanh tiến độ (frontend),
// và gRPC GetStatus (photo_count / photo_total / groups cho checklist).
//
// Quy ước "đủ ảnh":
//   Hàng xuất: mọi hạng mục của mọi đợt QC (6/đợt) + đủ 21 ảnh container, và có >= 1 đợt.
//   Hàng nhập: mọi ô của mọi mẫu (4/mẫu) + đủ 9 ảnh container (13-21), và có >= 1 mẫu.
//
// groups: tiến độ theo nhóm, tính trong CÙNG vòng đếm với filled/total nên
//   sum(groups.count) == filled và sum(groups.total) == total luôn đúng (checklist yêu cầu).
const hasPhoto = (it) => Boolean(it && (it.PHOTO_PATH || it.PHOTO_URL));

export function photoProgress(data) {
  const isImport = data.qcFile.QC_TYPE === 'IMPORT';
  const daily = { name: 'QC ngày', count: 0, total: 0 };
  const samples = { name: 'Mẫu', count: 0, total: 0 };
  const container = { name: 'Container', count: 0, total: 0 };
  let units = 0;

  for (const sess of data.dailySessions || []) {
    if (isImport) {
      for (const sm of sess.samples || []) {
        units++;
        samples.total += 4;
        samples.count += (sm.PHOTOS || []).filter((p) => p && (p.url || p.path)).length;
      }
    } else {
      units++;
      for (const it of sess.items || []) { daily.total++; if (hasPhoto(it)) daily.count++; }
    }
  }
  for (const it of data.containerItems || []) { container.total++; if (hasPhoto(it)) container.count++; }

  // Hàng nhập: container trước rồi mẫu (đúng thứ tự trong app/PDF). Hàng xuất: QC ngày rồi container.
  const groups = isImport ? [container, samples] : [daily, container];
  const filled = groups.reduce((a, g) => a + g.count, 0);
  const total = groups.reduce((a, g) => a + g.total, 0);

  return {
    filled, total, units, groups,
    unitLabel: isImport ? 'mẫu' : 'đợt QC',
    complete: units > 0 && total > 0 && filled === total,
  };
}
