// Tầng truy vấn SQL cho bảng qc_samples (mẫu QC của hàng nhập).
// Mỗi mẫu chứa tối đa 4 ảnh trong cột photos (JSONB): [{url, path, captured_at}, ...].
import { query, queryOne } from '../lib/db.js';

export function findByFile(qcFileId) {
  return query(
    `SELECT id, daily_qc_id, qc_file_id, sample_no, photos
     FROM qc_samples WHERE qc_file_id = $1
     ORDER BY sample_no`,
    [qcFileId]
  );
}

export function findById(id) {
  return queryOne(
    'SELECT id, daily_qc_id, qc_file_id, sample_no, photos FROM qc_samples WHERE id = $1',
    [id]
  );
}

export function findByDaily(dailyQcId) {
  return query('SELECT id, sample_no, photos FROM qc_samples WHERE daily_qc_id = $1', [dailyQcId]);
}

// Tạo mẫu mới: sample_no = số lớn nhất hiện có trong phiên + 1 (lấy qc_file_id từ phiên).
export function insert(dailyQcId) {
  return queryOne(
    `INSERT INTO qc_samples (daily_qc_id, qc_file_id, sample_no, photos)
     SELECT $1, dq.qc_file_id,
            COALESCE((SELECT MAX(sample_no) FROM qc_samples WHERE daily_qc_id = $1), 0) + 1,
            '[]'::jsonb
     FROM daily_qc dq WHERE dq.id = $1
     RETURNING id, sample_no`,
    [dailyQcId]
  );
}

export function remove(id) {
  return query('DELETE FROM qc_samples WHERE id = $1', [id]);
}

// Ghi đè toàn bộ mảng 4 ảnh của mẫu.
export function updatePhotos(id, photos) {
  return query(
    'UPDATE qc_samples SET photos = $2::jsonb, updated_at = now() WHERE id = $1',
    [id, JSON.stringify(photos)]
  );
}
