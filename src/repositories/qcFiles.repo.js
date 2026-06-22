// Tầng truy vấn SQL cho bảng qc_files và summaries. Chỉ đọc/ghi DB, không có logic nghiệp vụ.
import { query, queryOne } from '../lib/db.js';

// Dùng to_char để trả ngày/giờ ở dạng chuỗi giống định dạng cũ -> frontend không cần đổi cách hiển thị.
const SELECT_FILE = `
  SELECT id, qc_file_no, lot_code, qc_type, contract_no, po_no, production_order,
    standard_appendix, product_name, specification, supplier, supplier_code,
    po_quantity, unit,
    to_char(start_date, 'YYYY-MM-DD') AS start_date,
    to_char(est_finish_date, 'YYYY-MM-DD') AS est_finish_date,
    total_production_days, total_warehouses, container_no, seal_no,
    to_char(container_loading_date, 'YYYY-MM-DD') AS container_loading_date,
    qc_staff, status, pdf_url, pdf_url_customer,
    to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
    to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
  FROM qc_files`;

export function listAll() {
  return query(SELECT_FILE + ' ORDER BY created_at DESC');
}

export function findById(id) {
  return queryOne(SELECT_FILE + ' WHERE id = $1', [id]);
}

export function findSummary(id) {
  return queryOne(
    `SELECT qc_file_id, produced_qty, pending_production_qty, total_passed_finished_goods,
       cumulative_pass_rate, total_failed_pending, cumulative_fail_rate, total_delivered,
       total_stock_on_hand, difference_to_resolve, handling_action, fail_reason,
       to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') AS updated_at
     FROM summaries WHERE qc_file_id = $1`,
    [id]
  );
}

export function findLotCodesByPrefix(prefix) {
  return query('SELECT lot_code FROM qc_files WHERE lot_code LIKE $1', [prefix + '%']);
}

export async function insert(data) {
  const row = await queryOne(
    `INSERT INTO qc_files (
       qc_file_no, lot_code, contract_no, po_no, production_order, standard_appendix,
       product_name, specification, supplier, supplier_code, po_quantity, unit,
       start_date, est_finish_date, container_no, seal_no, container_loading_date,
       qc_staff, status, qc_type
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
       NULLIF($13,'')::date, NULLIF($14,'')::date, $15,$16, NULLIF($17,'')::date, $18,$19,$20
     ) RETURNING id`,
    [
      data.qc_file_no, data.lot_code, data.contract_no, data.po_no, data.production_order,
      data.standard_appendix, data.product_name, data.specification, data.supplier,
      data.supplier_code, data.po_quantity, data.unit, data.start_date, data.est_finish_date,
      data.container_no, data.seal_no, data.container_loading_date, data.qc_staff, data.status,
      data.qc_type,
    ]
  );
  return row.id;
}

export function insertSummary(qcFileId) {
  return query(
    'INSERT INTO summaries (qc_file_id) VALUES ($1) ON CONFLICT (qc_file_id) DO NOTHING',
    [qcFileId]
  );
}

// Cập nhật động: chỉ ghi những cột được truyền vào.
export async function update(id, updates) {
  const cols = Object.keys(updates);
  if (cols.length === 0) return;
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const values = cols.map((c) => updates[c]);
  await query(`UPDATE qc_files SET ${setClause}, updated_at = now() WHERE id = $1`, [id, ...values]);
}

export async function upsertSummary(qcFileId, updates) {
  const cols = Object.keys(updates);
  const allCols = ['qc_file_id', ...cols];
  const placeholders = allCols.map((_, i) => `$${i + 1}`).join(', ');
  const updateSet = cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  await query(
    `INSERT INTO summaries (${allCols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (qc_file_id) DO UPDATE SET ${updateSet}, updated_at = now()`,
    [qcFileId, ...cols.map((c) => updates[c])]
  );
}

// Tính lại tổng số ngày SX và số kho dựa trên các phiên QC thực tế.
export async function updateCounts(id) {
  await query(
    `UPDATE qc_files SET
       total_production_days = sub.days,
       total_warehouses = sub.whs,
       start_date = COALESCE(sub.min_date, start_date),
       updated_at = now()
     FROM (
       SELECT count(DISTINCT qc_date) AS days,
              count(DISTINCT warehouse) AS whs,
              min(qc_date) AS min_date
       FROM daily_qc WHERE qc_file_id = $1
     ) sub
     WHERE qc_files.id = $1`,
    [id]
  );
}

// Xóa hồ sơ QC (CASCADE tự xóa summary / daily / items / container).
export function remove(id) {
  return query('DELETE FROM qc_files WHERE id = $1', [id]);
}
