// Tầng truy vấn SQL cho bảng container_photos (21 ảnh giao hàng).
import { query } from '../lib/db.js';

export function findByFile(qcFileId) {
  return query(
    `SELECT id, qc_file_id, lot_code, photo_no, item_code, item_name_vi, item_name_en,
       description_vi, description_en, pass_rate, fail_rate, remarks, photo_url, photo_path,
       to_char(captured_at, 'YYYY-MM-DD HH24:MI:SS') AS captured_at
     FROM container_photos WHERE qc_file_id = $1
     ORDER BY photo_no`,
    [qcFileId]
  );
}

// Lưu kết quả (pass/fail/remarks) cho 1 ảnh container.
export async function upsertResult(qcFileId, def, fields) {
  await query(
    `INSERT INTO container_photos
       (qc_file_id, lot_code, photo_no, item_code, item_name_vi, item_name_en,
        description_vi, description_en, pass_rate, fail_rate, remarks)
     SELECT $1, lot_code, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM qc_files WHERE id = $1
     ON CONFLICT (qc_file_id, photo_no)
     DO UPDATE SET pass_rate = EXCLUDED.pass_rate, fail_rate = EXCLUDED.fail_rate,
       remarks = EXCLUDED.remarks, updated_at = now()`,
    [qcFileId, def.no, def.code, def.vi, def.en, def.descVi, def.descEn,
      fields.pass_rate, fields.fail_rate, fields.remarks]
  );
}

// Gắn ảnh cho 1 ảnh container (tạo dòng nếu chưa có).
export async function upsertPhoto(qcFileId, def, photo) {
  await query(
    `INSERT INTO container_photos
       (qc_file_id, lot_code, photo_no, item_code, item_name_vi, item_name_en,
        description_vi, description_en, photo_url, photo_path, captured_at)
     SELECT $1, lot_code, $2, $3, $4, $5, $6, $7, $8, $9, $10 FROM qc_files WHERE id = $1
     ON CONFLICT (qc_file_id, photo_no)
     DO UPDATE SET photo_url = EXCLUDED.photo_url, photo_path = EXCLUDED.photo_path,
       captured_at = EXCLUDED.captured_at, updated_at = now()`,
    [qcFileId, def.no, def.code, def.vi, def.en, def.descVi, def.descEn,
      photo.url, photo.path, photo.capturedAt]
  );
}
