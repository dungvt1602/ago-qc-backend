// Test THUẦN (không DB, không mạng) cho đồng bộ đơn -> hồ sơ QC (PLAN-0043):
//   (a) lib/orderSync.js: hàm quyết định ô nào cần ghi + kiểm ngày;
//   (b) qcFiles.service buildFileUpdates: HTTP updateQCFile bỏ 9 ô do đơn sở hữu với hồ sơ có order_id.
// Chạy: npm test
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_OWNED_FIELDS, ORDER_OWNED_KEYS, InvalidOrderInfoError,
  isValidIsoDate, normalizeOrderInfo, selectFieldsToWrite, stripOrderOwnedKeys,
} from '../src/lib/orderSync.js';
import { isLocked } from '../src/lib/lock.js';

// Một dòng qc_files "đã điền đủ" (khoá = tên cột, ngày dạng 'YYYY-MM-DD' như SELECT_FILE trả).
const FILLED = {
  customer: 'Khách A', product_name: 'Thanh long', specification: 'Loại 1', po_quantity: '100', unit: 'kg',
  supplier: 'Xưởng A', container_no: 'MSKU1', seal_no: 'S1', container_loading_date: '2026-10-01',
};
// Thông tin đơn khớp y hệt FILLED (theo key camelCase).
const SAME = {
  customer: 'Khách A', productName: 'Thanh long', specification: 'Loại 1', poQuantity: '100', unit: 'kg',
  supplier: 'Xưởng A', containerNo: 'MSKU1', sealNo: 'S1', containerLoadingDate: '2026-10-01',
};
const EMPTY_ROW = Object.fromEntries(ORDER_OWNED_FIELDS.map((f) => [f.col, null]));

describe('ORDER_OWNED_FIELDS', () => {
  it('đúng 9 ô, không trùng, khớp cột qc_files', () => {
    assert.equal(ORDER_OWNED_FIELDS.length, 9);
    assert.equal(new Set(ORDER_OWNED_KEYS).size, 9);
    assert.deepEqual(ORDER_OWNED_FIELDS.map((f) => f.col).sort(), [
      'container_loading_date', 'container_no', 'customer', 'po_quantity', 'product_name',
      'seal_no', 'specification', 'supplier', 'unit',
    ]);
  });
  it('KHÔNG chứa ô QC tự quản (po_no, supplier_code, contract_no, est_finish_date, qc_staff...)', () => {
    for (const k of ['poNo', 'supplierCode', 'contractNo', 'estFinishDate', 'qcStaff', 'startDate', 'productionOrder', 'standardAppendix', 'status']) {
      assert.ok(!ORDER_OWNED_KEYS.includes(k), k);
    }
  });
});

describe('isValidIsoDate', () => {
  it('nhận ngày thật', () => {
    for (const s of ['2026-10-05', '2024-02-29', '2000-02-29', '0099-01-01', '9999-12-31', '2026-12-31']) {
      assert.equal(isValidIsoDate(s), true, s);
    }
  });
  it('loại sai định dạng và ngày không có thật', () => {
    for (const s of ['', '2026/10/05', '05-10-2026', '2026-1-5', '2026-10-5', '20261005', 'abc', ' 2026-10-05',
      '2026-10-05 ', '2026-10-05T00:00:00', '2026-02-30', '2025-02-29', '1900-02-29', '2026-13-01', '2026-00-10',
      '2026-10-00', '2026-04-31', '0000-01-01']) {
      assert.equal(isValidIsoDate(s), false, JSON.stringify(s));
    }
  });
});

describe('normalizeOrderInfo', () => {
  it('trim, null/undefined thành rỗng, số thành chuỗi, bỏ khoá lạ', () => {
    const out = normalizeOrderInfo({ customer: '  Khách A  ', unit: null, poQuantity: 100, supplier: '   ', poNo: 'X', contractNo: 'Y' });
    assert.equal(out.customer, 'Khách A');
    assert.equal(out.unit, '');
    assert.equal(out.poQuantity, '100');
    assert.equal(out.supplier, '');
    assert.equal(out.containerNo, '');
    assert.deepEqual(Object.keys(out).sort(), [...ORDER_OWNED_KEYS].sort());
  });
  it('idempotent', () => {
    const once = normalizeOrderInfo({ customer: '  A ', containerLoadingDate: ' 2026-10-05 ' });
    assert.deepEqual(normalizeOrderInfo(once), once);
  });
  it('chấp nhận null/undefined cả đối tượng', () => {
    assert.equal(normalizeOrderInfo(null).customer, '');
    assert.equal(normalizeOrderInfo(undefined).containerLoadingDate, '');
  });
});

describe('selectFieldsToWrite — luật chung', () => {
  it('giá trị RỖNG từ đơn không bao giờ ghi, kể cả khi QC đang có giá trị (không xoá)', () => {
    const empty = { customer: '', productName: '', specification: '', poQuantity: '', unit: '', supplier: '', containerNo: '', sealNo: '', containerLoadingDate: '' };
    assert.deepEqual(selectFieldsToWrite(FILLED, empty, { onlyFillEmpty: false }), {});
    assert.deepEqual(selectFieldsToWrite(FILLED, empty, { onlyFillEmpty: true }), {});
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, empty), {});
  });
  it('rỗng ở mọi dạng: undefined, null, toàn khoảng trắng/tab/xuống dòng', () => {
    const info = { customer: undefined, productName: null, specification: '   ', unit: '\t\n ', supplier: ' ' };
    assert.deepEqual(selectFieldsToWrite(FILLED, info), {});
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, info), {});
  });
  it('trim giá trị trước khi ghi', () => {
    const w = selectFieldsToWrite(EMPTY_ROW, { containerNo: '  MSKU999  ', supplier: '\tXưởng B\n' });
    assert.deepEqual(w, { container_no: 'MSKU999', supplier: 'Xưởng B' });
  });
  it('không giữ khoảng trắng bên trong chuỗi bị đổi (chỉ trim hai đầu)', () => {
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, { specification: ' Loại  1 ' }), { specification: 'Loại  1' });
  });
  it('ghi đủ 9 ô khi hồ sơ trống hoàn toàn, đúng tên cột', () => {
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, SAME), FILLED);
  });
  it('ô lạ trong info (po_no, contract_no...) bị bỏ', () => {
    const w = selectFieldsToWrite(EMPTY_ROW, { poNo: 'AGO1', contractNo: 'C1', estFinishDate: '2026-12-01', qcStaff: 'Lan', unit: 'kg' });
    assert.deepEqual(w, { unit: 'kg' });
  });
  it('không sửa đối tượng đầu vào', () => {
    const cur = { ...FILLED };
    const info = { ...SAME, customer: '  Khách B ' };
    selectFieldsToWrite(cur, info);
    assert.deepEqual(cur, FILLED);
    assert.equal(info.customer, '  Khách B ');
  });
  it('current null/undefined coi như hồ sơ trống', () => {
    assert.deepEqual(selectFieldsToWrite(null, { unit: 'kg' }), { unit: 'kg' });
    assert.deepEqual(selectFieldsToWrite(undefined, { unit: 'kg' }, { onlyFillEmpty: true }), { unit: 'kg' });
  });
});

describe('selectFieldsToWrite — chế độ ghi đè (onlyFillEmpty=false)', () => {
  it('ghi đúng ô KHÁC giá trị hiện tại, bỏ ô giống', () => {
    const w = selectFieldsToWrite(FILLED, { ...SAME, customer: 'Khách B', sealNo: 'S2' });
    assert.deepEqual(w, { customer: 'Khách B', seal_no: 'S2' });
  });
  it('trùng giá trị -> không ghi gì (để KHÔNG chạy UPDATE / bump updated_at)', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, SAME), {});
  });
  it('trùng sau khi trim -> không ghi', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, { ...SAME, customer: '  Khách A  ', containerNo: '\tMSKU1 ' }), {});
  });
  it('khác biệt chỉ ở hoa/thường hoặc khoảng trắng của dữ liệu QC cũ vẫn tính là khác (đơn thắng)', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, { customer: 'khách a' }), { customer: 'khách a' });
    assert.deepEqual(selectFieldsToWrite({ ...FILLED, customer: 'Khách A ' }, { customer: 'Khách A' }), { customer: 'Khách A' });
  });
  it('hiện NULL hoặc rỗng hoặc toàn khoảng trắng -> ghi', () => {
    for (const cur of [null, undefined, '', '   ']) {
      assert.deepEqual(selectFieldsToWrite({ ...FILLED, supplier: cur }, { supplier: 'Xưởng B' }), { supplier: 'Xưởng B' }, JSON.stringify(cur));
    }
  });
  it('onlyFillEmpty mặc định là false', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, { customer: 'Khách B' }), { customer: 'Khách B' });
    assert.deepEqual(selectFieldsToWrite(FILLED, { customer: 'Khách B' }, {}), { customer: 'Khách B' });
  });
});

describe('selectFieldsToWrite — only_fill_empty (lần đồng bộ đầu)', () => {
  const opts = { onlyFillEmpty: true };
  it('KHÔNG đè ô QC đã có giá trị, dù khác', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, { ...SAME, customer: 'Khách B', containerLoadingDate: '2026-11-11' }, opts), {});
  });
  it('chỉ điền ô đang NULL', () => {
    const w = selectFieldsToWrite({ ...FILLED, seal_no: null, container_loading_date: null }, { ...SAME, customer: 'Khách B', sealNo: 'S9', containerLoadingDate: '2026-10-05' }, opts);
    assert.deepEqual(w, { seal_no: 'S9', container_loading_date: '2026-10-05' });
  });
  it("chỉ điền ô đang ''", () => {
    const w = selectFieldsToWrite({ ...FILLED, supplier: '', unit: '' }, { ...SAME, supplier: 'Xưởng B', unit: 'thùng' }, opts);
    assert.deepEqual(w, { supplier: 'Xưởng B', unit: 'thùng' });
  });
  it('ô toàn khoảng trắng coi là trống -> điền', () => {
    assert.deepEqual(selectFieldsToWrite({ ...FILLED, supplier: '  ' }, { supplier: 'Xưởng B' }, opts), { supplier: 'Xưởng B' });
  });
  it('ô trống mà đơn cũng rỗng -> không ghi', () => {
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, { supplier: '  ' }, opts), {});
  });
  it("khoảng trắng đầu/cuối giá trị gốc không làm ô 'có chữ' thành trống", () => {
    assert.deepEqual(selectFieldsToWrite({ ...FILLED, supplier: ' Xưởng A ' }, { supplier: 'Xưởng B' }, opts), {});
  });
});

describe('selectFieldsToWrite — ngày đóng cont', () => {
  it('ngày hợp lệ được ghi dạng yyyy-MM-dd', () => {
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, { containerLoadingDate: '2026-10-05' }), { container_loading_date: '2026-10-05' });
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, { containerLoadingDate: ' 2026-10-05 ' }), { container_loading_date: '2026-10-05' });
  });
  it('trùng ngày hiện tại -> không ghi; khác -> ghi', () => {
    assert.deepEqual(selectFieldsToWrite({ ...FILLED }, { containerLoadingDate: '2026-10-01' }), {});
    assert.deepEqual(selectFieldsToWrite({ ...FILLED }, { containerLoadingDate: '2026-10-02' }), { container_loading_date: '2026-10-02' });
  });
  it('ngày rỗng không xoá ngày hiện có', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, { containerLoadingDate: '' }), {});
  });
  it('sai định dạng / không có thật -> InvalidOrderInfoError, mã INVALID_ARGUMENT (3)', () => {
    for (const bad of ['2026-02-30', '05/10/2026', '2026-1-5', 'hôm qua', '2026-10-05T10:00:00Z', '0000-01-01']) {
      assert.throws(() => selectFieldsToWrite(EMPTY_ROW, { containerLoadingDate: bad }), (e) => {
        assert.ok(e instanceof InvalidOrderInfoError, bad);
        assert.equal(e.grpcCode, 3);
        assert.match(e.message, /container_loading_date/);
        return true;
      }, bad);
    }
  });
  it('ngày sai vẫn bị từ chối dù only_fill_empty và ô đã có giá trị (không nuốt lỗi)', () => {
    assert.throws(() => selectFieldsToWrite(FILLED, { containerLoadingDate: '2026-02-30' }, { onlyFillEmpty: true }), InvalidOrderInfoError);
  });
  it('ngày sai làm hỏng cả lần gọi: không ô nào khác được trả về', () => {
    assert.throws(() => selectFieldsToWrite(EMPTY_ROW, { customer: 'A', containerLoadingDate: 'x' }), InvalidOrderInfoError);
  });
});

describe('stripOrderOwnedKeys', () => {
  it('bỏ đúng 9 khoá, giữ phần còn lại, không sửa payload gốc', () => {
    const payload = {
      qcFileId: 'id-1', poNo: 'AGO1', qcStaff: 'Lan', contractNo: 'C1', estFinishDate: '', status: 'DRAFT',
      customer: 'A', productName: 'B', specification: 'C', poQuantity: '1', unit: 'kg', supplier: 'S',
      containerNo: 'N', sealNo: 'L', containerLoadingDate: '2026-10-05',
    };
    const copy = { ...payload };
    const out = stripOrderOwnedKeys(payload);
    assert.deepEqual(out, { qcFileId: 'id-1', poNo: 'AGO1', qcStaff: 'Lan', contractNo: 'C1', estFinishDate: '', status: 'DRAFT' });
    assert.deepEqual(payload, copy);
    assert.notEqual(out, payload);
  });
});

describe('isLocked — luật khoá một chỗ', () => {
  it('khoá khi qc_done_at có giá trị', () => {
    assert.equal(isLocked({ qc_done_at: '2026-10-05 10:00:00' }), true);
    assert.equal(isLocked({ qc_done_at: new Date() }), true);
  });
  it('không khoá khi qc_done_at trống hoặc không có hồ sơ', () => {
    for (const f of [{ qc_done_at: null }, { qc_done_at: undefined }, {}, null, undefined]) {
      assert.equal(isLocked(f), false);
    }
  });
});

// (b) qcFiles.service kéo theo config/db/storage: đặt biến giả TRƯỚC khi nạp. Pool nối lười nên
// test thuần không bao giờ chạm DB; biến thật (nếu có .env) không bị đọc vì dotenv không đè biến đã đặt.
describe('buildFileUpdates — HTTP updateQCFile lọc khoá theo order_id', () => {
  let buildFileUpdates;
  before(async () => {
    process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';
    process.env.SUPABASE_URL = 'https://unused.invalid';
    process.env.SUPABASE_SERVICE_KEY = 'unused';
    ({ buildFileUpdates } = await import('../src/services/qcFiles.service.js'));
  });

  const FORM = {
    qcFileId: 'id-1',
    contractNo: 'C1', poNo: 'AGO1', productionOrder: 'PO-9', standardAppendix: 'AP', supplierCode: 'SC',
    startDate: '2026-10-01', estFinishDate: '', qcStaff: 'Lan', status: 'DRAFT',
    customer: 'Khách A', productName: 'Thanh long', specification: 'Loại 1', poQuantity: '100', unit: 'kg',
    supplier: 'Xưởng A', containerNo: 'MSKU1', sealNo: 'S1', containerLoadingDate: '2026-10-05',
  };

  it('hồ sơ CÓ order_id: 9 ô do đơn sở hữu bị bỏ, các ô khác vẫn ghi', () => {
    const u = buildFileUpdates(FORM, true);
    assert.deepEqual(u, {
      contract_no: 'C1', po_no: 'AGO1', production_order: 'PO-9', standard_appendix: 'AP', supplier_code: 'SC',
      start_date: '2026-10-01', est_finish_date: null, qc_staff: 'Lan', status: 'DRAFT',
    });
    for (const f of ORDER_OWNED_FIELDS) assert.ok(!(f.col in u), f.col);
  });
  it('hồ sơ TẠO TAY (không order_id): giữ nguyên hành vi cũ, ghi cả 9 ô', () => {
    const u = buildFileUpdates(FORM, false);
    for (const f of ORDER_OWNED_FIELDS) assert.ok(f.col in u, f.col);
    assert.equal(u.customer, 'Khách A');
    assert.equal(u.container_loading_date, '2026-10-05');
    assert.equal(u.est_finish_date, null); // '' -> null như cũ
    assert.equal(Object.keys(u).length, 18);
  });
  it('ngày rỗng của ô QC tự quản vẫn đổi thành null như cũ', () => {
    assert.equal(buildFileUpdates({ startDate: '' }, true).start_date, null);
    assert.equal(buildFileUpdates({ startDate: '' }, false).start_date, null);
  });
  it('payload chỉ có ô do đơn sở hữu + hồ sơ có order_id -> không có gì để ghi', () => {
    assert.deepEqual(buildFileUpdates({ qcFileId: 'id-1', customer: 'X', supplier: 'Y', containerLoadingDate: '' }, true), {});
  });
  it('snapshot cũ của frontend (ô trống) không xoá được giá trị đơn đã đẩy sang', () => {
    const stale = { qcFileId: 'id-1', customer: '', supplier: '', containerNo: '', sealNo: '', containerLoadingDate: '', productName: '', specification: '', poQuantity: '', unit: '', qcStaff: 'Lan' };
    assert.deepEqual(buildFileUpdates(stale, true), { qc_staff: 'Lan' });
  });
  it('không sửa payload gốc', () => {
    const copy = { ...FORM };
    buildFileUpdates(FORM, true);
    assert.deepEqual(FORM, copy);
  });
});
