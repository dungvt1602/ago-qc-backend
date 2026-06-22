// Logic nghiệp vụ cho hồ sơ QC: tạo, đọc (ghép dữ liệu), cập nhật thông tin & thống kê.
import * as repo from '../repositories/qcFiles.repo.js';
import * as dailyRepo from '../repositories/daily.repo.js';
import * as containerRepo from '../repositories/container.repo.js';
import { DAILY_ITEMS, CONTAINER_ITEMS } from '../data/catalog.js';
import { upperKeys } from '../lib/rows.js';
import { todayStr, dateCompact, sanitizeCode } from '../lib/util.js';
import { removeFiles, removeFolder } from '../lib/storage.js';
import { config } from '../config/env.js';

// Trả về danh mục cố định (frontend hiện chưa dùng, giữ cho đủ "hợp đồng" cũ).
export function setupInfo() {
  return { dailyItems: DAILY_ITEMS, containerItems: CONTAINER_ITEMS };
}

export async function listQCFiles() {
  const rows = await repo.listAll();
  return rows.map(upperKeys);
}

// Sinh mã lô dạng QC-{PO}-{yyyyMMdd}, thêm hậu tố -02, -03... nếu trùng.
async function generateLotCode(poNo) {
  const base = `QC-${sanitizeCode(poNo)}-${dateCompact()}`;
  const existing = await repo.findLotCodesByPrefix(base);
  if (existing.length === 0) return base;
  return `${base}-${String(existing.length + 1).padStart(2, '0')}`;
}

export async function createQCFile(p) {
  const lotCode = await generateLotCode(p.poNo || 'NOPO');
  const id = await repo.insert({
    qc_file_no: lotCode,
    lot_code: lotCode,
    contract_no: p.contractNo || '',
    po_no: p.poNo || '',
    production_order: p.productionOrder || '',
    standard_appendix: p.standardAppendix || '',
    product_name: p.productName || '',
    specification: p.specification || '',
    supplier: p.supplier || '',
    supplier_code: p.supplierCode || '',
    po_quantity: p.poQuantity || '',
    unit: p.unit || '',
    start_date: p.startDate || todayStr(),
    est_finish_date: p.estFinishDate || '',
    container_no: p.containerNo || '',
    seal_no: p.sealNo || '',
    container_loading_date: p.containerLoadingDate || '',
    qc_staff: p.qcStaff || '',
    status: 'DRAFT',
    qc_type: (p.qcType === 'EXPORT') ? 'EXPORT' : 'IMPORT',
  });
  await repo.insertSummary(id);
  return getQCFile(id);
}

// Đọc 1 hồ sơ đầy đủ. Đây là hàm trung tâm — hầu hết thao tác kết thúc bằng việc gọi nó.
// TỐI ƯU: bắn 5 truy vấn độc lập CÙNG LÚC bằng Promise.all thay vì chờ lần lượt.
export async function getQCFile(id) {
  const [fileRow, summaryRow, sessionRows, itemRows, containerRows] = await Promise.all([
    repo.findById(id),
    repo.findSummary(id),
    dailyRepo.findSessions(id),
    dailyRepo.findItems(id),
    containerRepo.findByFile(id),
  ]);
  if (!fileRow) throw new Error('Không tìm thấy hồ sơ QC: ' + id);

  const qcFile = upperKeys(fileRow);
  const summary = upperKeys(summaryRow) || { QC_FILE_ID: id };

  // Mỗi phiên QC luôn hiện đủ 6 hạng mục (lấp ô trống nếu chưa nhập).
  const dailySessions = sessionRows.map((s) => {
    const session = upperKeys(s);
    const itemsOfSession = itemRows.filter((it) => it.daily_qc_id === s.id);
    session.items = DAILY_ITEMS.map((def) => {
      const found = itemsOfSession.find((it) => it.item_code === def.code);
      return found ? upperKeys(found) : emptyDailyItem(def, session);
    });
    return session;
  });

  // Hàng nhập kho (IMPORT): chỉ dùng ảnh container từ 13 tới cuối (13-21). Hàng xuất: đủ 21.
  const isImport = qcFile.QC_TYPE === 'IMPORT';
  const containerDefs = isImport
    ? CONTAINER_ITEMS.filter((def) => def.no >= 13)
    : CONTAINER_ITEMS;
  const containerItems = containerDefs.map((def, idx) => {
    const found = containerRows.find((c) => Number(c.photo_no) === def.no);
    const item = found ? upperKeys(found) : emptyContainerItem(def, qcFile);
    if (isImport) {
      // Đánh số nhãn hiển thị lại 1..9 (GIỮ NGUYÊN PHOTO_NO thật để lưu/đọc đúng chỗ).
      const seq = idx + 1;
      item.ITEM_NAME_VI = String(item.ITEM_NAME_VI || '').replace(/^(ẢNH\s*)\d+/i, `$1${seq}`);
      item.ITEM_NAME_EN = String(item.ITEM_NAME_EN || '').replace(/^(PHOTO\s*)\d+/i, `$1${seq}`);
    }
    return item;
  });

  return { qcFile, summary, dailySessions, containerItems, dailyItemDefs: DAILY_ITEMS };
}

function emptyDailyItem(def, session) {
  return {
    ID: '', DAILY_QC_ID: session.ID, QC_FILE_ID: session.QC_FILE_ID, LOT_CODE: session.LOT_CODE,
    QC_DATE: session.QC_DATE, WAREHOUSE: session.WAREHOUSE, ITEM_CODE: def.code,
    ITEM_NAME_VI: def.vi, ITEM_NAME_EN: def.en, PASS_RATE: '', FAIL_RATE: '', REMARKS: '',
    PHOTO_FILE_ID: '', PHOTO_URL: '', PHOTO_PATH: '', CAPTURED_AT: '',
  };
}

function emptyContainerItem(def, qcFile) {
  return {
    ID: '', QC_FILE_ID: qcFile.ID, LOT_CODE: qcFile.LOT_CODE, PHOTO_NO: def.no, ITEM_CODE: def.code,
    ITEM_NAME_VI: def.vi, ITEM_NAME_EN: def.en, DESCRIPTION_VI: def.descVi, DESCRIPTION_EN: def.descEn,
    PASS_RATE: '', FAIL_RATE: '', REMARKS: '', PHOTO_FILE_ID: '', PHOTO_URL: '', PHOTO_PATH: '', CAPTURED_AT: '',
  };
}

// Ánh xạ tên trường từ frontend (camelCase) -> cột DB (snake_case).
const FIELD_MAP = {
  contractNo: 'contract_no', poNo: 'po_no', productionOrder: 'production_order',
  standardAppendix: 'standard_appendix', productName: 'product_name', specification: 'specification',
  supplier: 'supplier', supplierCode: 'supplier_code', poQuantity: 'po_quantity', unit: 'unit',
  startDate: 'start_date', estFinishDate: 'est_finish_date', containerNo: 'container_no',
  sealNo: 'seal_no', containerLoadingDate: 'container_loading_date', qcStaff: 'qc_staff', status: 'status',
};
const DATE_FIELDS = new Set(['start_date', 'est_finish_date', 'container_loading_date']);

export async function updateQCFile(p) {
  const updates = {};
  for (const [camel, col] of Object.entries(FIELD_MAP)) {
    if (camel in p) {
      let val = p[camel];
      if (DATE_FIELDS.has(col) && val === '') val = null; // tránh lỗi ép '' -> date
      updates[col] = val;
    }
  }
  await repo.update(p.qcFileId, updates);
  return getQCFile(p.qcFileId);
}

const SUMMARY_MAP = {
  cumulativePassRate: 'cumulative_pass_rate',
  cumulativeFailRate: 'cumulative_fail_rate',
  failReason: 'fail_reason',
  handlingAction: 'handling_action',
};

export async function updateSummary(p) {
  const updates = {};
  for (const [camel, col] of Object.entries(SUMMARY_MAP)) updates[col] = p[camel] || '';
  await repo.upsertSummary(p.qcFileId, updates);
  return getQCFile(p.qcFileId);
}

// Xóa cả hồ sơ QC: gỡ ảnh khỏi Storage trước, rồi xóa bản ghi (CASCADE xóa con).
export async function deleteQCFile(qcFileId) {
  const file = await repo.findById(qcFileId);
  if (!file) throw new Error('Không tìm thấy hồ sơ QC');
  const [items, containers] = await Promise.all([
    dailyRepo.findItems(qcFileId),
    containerRepo.findByFile(qcFileId),
  ]);
  const paths = [...items, ...containers].map((x) => x.photo_path).filter(Boolean);
  try { await removeFiles(config.photoBucket, paths); } catch (e) { /* lỗi xóa ảnh không chặn việc xóa hồ sơ */ }
  try { await removeFolder(config.pdfBucket, qcFileId); } catch (e) { /* dọn PDF nội bộ + khách hàng của hồ sơ */ }
  await repo.remove(qcFileId);
  return { deleted: true, id: qcFileId };
}
