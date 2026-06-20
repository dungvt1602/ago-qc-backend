// Tầng truy vấn SQL cho bảng daily_qc (phiên QC) và daily_qc_items (hạng mục trong phiên).
import { query, queryOne } from '../lib/db.js';

export function findSessions(qcFileId) {
  return query(
    `SELECT id, qc_file_id, lot_code,
       to_char(qc_date, 'YYYY-MM-DD') AS qc_date, warehouse, qc_staff, status,
       to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
       to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
     FROM daily_qc WHERE qc_file_id = $1
     ORDER BY qc_date, warehouse`,
    [qcFileId]
  );
}

export function findItems(qcFileId) {
  return query(
    `SELECT id, daily_qc_id, qc_file_id, item_code, item_name_vi, item_name_en,
       pass_rate, fail_rate, remarks, photo_url, photo_path,
       to_char(captured_at, 'YYYY-MM-DD HH24:MI:SS') AS captured_at
     FROM daily_qc_items WHERE qc_file_id = $1`,
    [qcFileId]
  );
}

export function findSessionById(id) {
  return queryOne(
    `SELECT id, qc_file_id, lot_code,
       to_char(qc_date, 'YYYY-MM-DD') AS qc_date, warehouse, qc_staff
     FROM daily_qc WHERE id = $1`,
    [id]
  );
}

// Chèn phiên QC (chạy trong transaction -> nhận client).
export async function insertSession(client, data) {
  const res = await client.query(
    `INSERT INTO daily_qc (qc_file_id, lot_code, qc_date, warehouse, qc_staff, status)
     VALUES ($1,$2, NULLIF($3,'')::date, $4,$5, 'DRAFT') RETURNING id`,
    [data.qc_file_id, data.lot_code, data.qc_date, data.warehouse, data.qc_staff]
  );
  return res.rows[0].id;
}

// Chèn cả 6 hạng mục trong MỘT câu lệnh (1 round-trip = nhanh nhất).
export async function insertItems(client, sessionId, qcFileId, items) {
  const valueRows = [];
  const params = [];
  items.forEach((def, i) => {
    const b = i * 5;
    valueRows.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
    params.push(sessionId, qcFileId, def.code, def.vi, def.en);
  });
  await client.query(
    `INSERT INTO daily_qc_items (daily_qc_id, qc_file_id, item_code, item_name_vi, item_name_en)
     VALUES ${valueRows.join(', ')}
     ON CONFLICT (daily_qc_id, item_code) DO NOTHING`,
    params
  );
}

// Lưu kết quả 1 hạng mục (tạo mới nếu chưa có, cập nhật nếu đã có).
export async function upsertItemResult(dailyQcId, itemCode, def, fields) {
  await query(
    `INSERT INTO daily_qc_items
       (daily_qc_id, qc_file_id, item_code, item_name_vi, item_name_en, pass_rate, fail_rate, remarks)
     SELECT $1, qc_file_id, $2, $3, $4, $5, $6, $7 FROM daily_qc WHERE id = $1
     ON CONFLICT (daily_qc_id, item_code)
     DO UPDATE SET pass_rate = EXCLUDED.pass_rate, fail_rate = EXCLUDED.fail_rate,
       remarks = EXCLUDED.remarks, updated_at = now()`,
    [dailyQcId, itemCode, def.vi, def.en, fields.pass_rate, fields.fail_rate, fields.remarks]
  );
}

// Gắn ảnh vào 1 hạng mục đã có sẵn (hạng mục được tạo cùng lúc với phiên).
export async function updateItemPhoto(dailyQcId, itemCode, photo) {
  await query(
    `UPDATE daily_qc_items
     SET photo_url = $3, photo_path = $4, captured_at = $5, updated_at = now()
     WHERE daily_qc_id = $1 AND item_code = $2`,
    [dailyQcId, itemCode, photo.url, photo.path, photo.capturedAt]
  );
}

// Lấy đường dẫn ảnh của một phiên (để xóa khỏi Storage).
export function findPhotoPathsBySession(sessionId) {
  return query(
    "SELECT photo_path FROM daily_qc_items WHERE daily_qc_id = $1 AND coalesce(photo_path, '') <> ''",
    [sessionId]
  );
}

// Tìm 1 hạng mục (kèm photo_path) để biết ảnh cần xóa.
export function findItem(dailyQcId, itemCode) {
  return queryOne(
    'SELECT id, photo_path FROM daily_qc_items WHERE daily_qc_id = $1 AND item_code = $2',
    [dailyQcId, itemCode]
  );
}

// Gỡ ảnh khỏi 1 hạng mục.
export function clearItemPhoto(dailyQcId, itemCode) {
  return query(
    `UPDATE daily_qc_items SET photo_url = NULL, photo_path = NULL, captured_at = NULL, updated_at = now()
     WHERE daily_qc_id = $1 AND item_code = $2`,
    [dailyQcId, itemCode]
  );
}

// Sửa thông tin phiên QC (ngày / kho / nhân viên).
export function updateSession(id, fields) {
  return query(
    `UPDATE daily_qc SET qc_date = NULLIF($2,'')::date, warehouse = $3, qc_staff = $4, updated_at = now()
     WHERE id = $1`,
    [id, fields.qc_date, fields.warehouse, fields.qc_staff]
  );
}

// Xóa phiên QC (CASCADE tự xóa các hạng mục của phiên).
export function removeSession(id) {
  return query('DELETE FROM daily_qc WHERE id = $1', [id]);
}
