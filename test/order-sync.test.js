// Test THUẦN (không DB, không mạng) cho đồng bộ đơn -> hồ sơ QC (PLAN-0043):
//   (a) lib/orderSync.js: hàm quyết định ô nào cần ghi + kiểm ngày / NUL;
//   (b) qcFiles.service buildFileUpdates: HTTP updateQCFile bỏ 9 ô do đơn sở hữu (khi bật cờ) với hồ sơ có order_id;
//   (c) config: đọc cờ QC_ORDER_FIELDS_READONLY.
// Chạy: npm test
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import grpc from '@grpc/grpc-js';
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
  it('đúng 4 ô QC có thể đã gõ tay mang cờ fillOnlyOnFirstSync, 5 ô còn lại thì không', () => {
    const first = ORDER_OWNED_FIELDS.filter((f) => f.fillOnlyOnFirstSync).map((f) => f.col).sort();
    assert.deepEqual(first, ['container_loading_date', 'container_no', 'seal_no', 'supplier']);
    const always = ORDER_OWNED_FIELDS.filter((f) => !f.fillOnlyOnFirstSync).map((f) => f.col).sort();
    assert.deepEqual(always, ['customer', 'po_quantity', 'product_name', 'specification', 'unit']);
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
  it('chuỗi chứa NUL (U+0000) ở BẤT KỲ ô nào -> InvalidOrderInfoError, câu lỗi cố định, không in lại dữ liệu', () => {
    const secret = 'BÍ-MẬT-KHÁCH';
    for (const f of ORDER_OWNED_FIELDS) {
      for (const bad of [`${secret}\u0000`, '\u0000', `a\u0000${secret}`]) {
        assert.throws(() => normalizeOrderInfo({ [f.key]: bad }), (e) => {
          assert.ok(e instanceof InvalidOrderInfoError, f.key);
          assert.equal(e.grpcCode, grpc.status.INVALID_ARGUMENT);
          assert.equal(e.expose, true);
          assert.ok(!e.message.includes(secret), 'không được in lại dữ liệu gửi sang');
          assert.match(e.message, /NUL/);
          return true;
        }, f.key);
      }
    }
  });
  it('NUL làm hỏng cả lần gọi qua selectFieldsToWrite (không ô nào được trả về)', () => {
    assert.throws(() => selectFieldsToWrite(EMPTY_ROW, { customer: 'A', unit: 'k\u0000g' }), InvalidOrderInfoError);
  });
  it('khoảng trắng và ký tự điều khiển khác NUL vẫn được chấp nhận', () => {
    assert.equal(normalizeOrderInfo({ unit: 'k\tg', specification: 'a\nb' }).unit, 'k\tg');
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

// only_fill_empty = lần đồng bộ ĐẦU. CHỈ áp cho 4 ô QC có thể đã gõ tay (supplier, container_no, seal_no,
// container_loading_date); 5 ô còn lại (customer, product_name, specification, po_quantity, unit) luôn đồng bộ.
describe('selectFieldsToWrite — only_fill_empty (lần đồng bộ đầu)', () => {
  const opts = { onlyFillEmpty: true };
  // Đơn có giá trị KHÁC ở cả 9 ô so với FILLED.
  const DIFFERENT = {
    customer: 'Khách B', productName: 'Xoài', specification: 'Loại 2', poQuantity: '200', unit: 'thùng',
    supplier: 'Xưởng B', containerNo: 'MSKU2', sealNo: 'S2', containerLoadingDate: '2026-11-11',
  };

  it('4 ô QC có thể đã gõ tay: KHÔNG đè khi đã có chữ, dù đơn khác', () => {
    const w = selectFieldsToWrite(FILLED, DIFFERENT, opts);
    for (const col of ['supplier', 'container_no', 'seal_no', 'container_loading_date']) assert.ok(!(col in w), col);
  });
  it('5 ô còn lại: lần đầu VẪN đồng bộ về giá trị hiện tại của đơn (làm tươi giá trị cũ)', () => {
    const w = selectFieldsToWrite(FILLED, DIFFERENT, opts);
    assert.deepEqual(w, { customer: 'Khách B', product_name: 'Xoài', specification: 'Loại 2', po_quantity: '200', unit: 'thùng' });
  });
  it('lần đầu: QC gõ tay supplier thì giữ, customer/SP/quy cách/SL/đơn vị cũ thì được làm tươi', () => {
    const row = { ...EMPTY_ROW, supplier: 'QC gõ tay', customer: 'Khách cũ', product_name: 'SP cũ', specification: 'QC cũ', po_quantity: '1', unit: 'cont' };
    const w = selectFieldsToWrite(row, DIFFERENT, opts);
    assert.deepEqual(w, {
      customer: 'Khách B', product_name: 'Xoài', specification: 'Loại 2', po_quantity: '200', unit: 'thùng',
      container_no: 'MSKU2', seal_no: 'S2', container_loading_date: '2026-11-11', // 3 ô trống thì điền
    });
    assert.ok(!('supplier' in w));
  });
  it('5 ô còn lại: giống giá trị đơn thì không ghi, lần đầu cũng vậy', () => {
    assert.deepEqual(selectFieldsToWrite(FILLED, SAME, opts), {});
    assert.deepEqual(selectFieldsToWrite(FILLED, { ...SAME, customer: '  Khách A ' }, opts), {});
  });
  it('4 ô: chỉ điền khi đang NULL', () => {
    const w = selectFieldsToWrite({ ...FILLED, seal_no: null, container_loading_date: null }, { ...SAME, sealNo: 'S9', containerLoadingDate: '2026-10-05' }, opts);
    assert.deepEqual(w, { seal_no: 'S9', container_loading_date: '2026-10-05' });
  });
  it("4 ô: chỉ điền khi đang ''", () => {
    const w = selectFieldsToWrite({ ...FILLED, supplier: '', container_no: '' }, { ...SAME, supplier: 'Xưởng B', containerNo: 'MSKU9' }, opts);
    assert.deepEqual(w, { supplier: 'Xưởng B', container_no: 'MSKU9' });
  });
  it('4 ô: toàn khoảng trắng coi là trống -> điền', () => {
    assert.deepEqual(selectFieldsToWrite({ ...FILLED, supplier: '  ' }, { supplier: 'Xưởng B' }, opts), { supplier: 'Xưởng B' });
    assert.deepEqual(selectFieldsToWrite({ ...FILLED, seal_no: '\t' }, { sealNo: 'S9' }, opts), { seal_no: 'S9' });
  });
  it('đơn rỗng không ghi gì (4 ô lẫn 5 ô), kể cả khi ô QC đang trống', () => {
    const empty = Object.fromEntries(Object.keys(SAME).map((k) => [k, '  ']));
    assert.deepEqual(selectFieldsToWrite(EMPTY_ROW, empty, opts), {});
    assert.deepEqual(selectFieldsToWrite(FILLED, empty, opts), {});
  });
  it("khoảng trắng đầu/cuối giá trị gốc không làm ô 'có chữ' thành trống", () => {
    assert.deepEqual(selectFieldsToWrite({ ...FILLED, supplier: ' Xưởng A ' }, { supplier: 'Xưởng B' }, opts), {});
  });
  it('từ lần sau (onlyFillEmpty=false): cả 9 ô được ghi khi khác', () => {
    const w = selectFieldsToWrite(FILLED, DIFFERENT, { onlyFillEmpty: false });
    assert.deepEqual(w, {
      customer: 'Khách B', product_name: 'Xoài', specification: 'Loại 2', po_quantity: '200', unit: 'thùng',
      supplier: 'Xưởng B', container_no: 'MSKU2', seal_no: 'S2', container_loading_date: '2026-11-11',
    });
  });
  it('lần đầu rồi lần sau trên cùng hồ sơ: hội tụ về giá trị của đơn, rồi không còn gì để ghi', () => {
    const row = { ...FILLED };
    const first = selectFieldsToWrite(row, DIFFERENT, opts);
    Object.assign(row, first);
    assert.equal(row.supplier, 'Xưởng A'); // lần đầu giữ chữ QC
    const second = selectFieldsToWrite(row, DIFFERENT, { onlyFillEmpty: false });
    Object.assign(row, second);
    assert.equal(row.supplier, 'Xưởng B'); // từ lần sau đơn thắng
    assert.deepEqual(selectFieldsToWrite(row, DIFFERENT, { onlyFillEmpty: false }), {});
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
  it('sai định dạng / không có thật -> InvalidOrderInfoError, mã INVALID_ARGUMENT', () => {
    for (const bad of ['2026-02-30', '05/10/2026', '2026-1-5', 'hôm qua', '2026-10-05T10:00:00Z', '0000-01-01']) {
      assert.throws(() => selectFieldsToWrite(EMPTY_ROW, { containerLoadingDate: bad }), (e) => {
        assert.ok(e instanceof InvalidOrderInfoError, bad);
        assert.equal(e.grpcCode, grpc.status.INVALID_ARGUMENT);
        assert.equal(e.expose, true);
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

// (c) Cờ QC_ORDER_FIELDS_READONLY đọc ở config/env.js. Mỗi giá trị chạy trong một tiến trình con RIÊNG
// (config chốt biến môi trường lúc nạp module) và cwd = thư mục tạm để dotenv không đọc nhầm .env của máy.
describe('config.orderFieldsReadonly — cờ QC_ORDER_FIELDS_READONLY', () => {
  const ENV_JS = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/config/env.js')).href;
  function readFlag(value) {
    const env = { ...process.env, DATABASE_URL: 'postgresql://unused', SUPABASE_URL: 'https://unused.invalid', SUPABASE_SERVICE_KEY: 'unused' };
    delete env.QC_ORDER_FIELDS_READONLY;
    if (value !== undefined) env.QC_ORDER_FIELDS_READONLY = value;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e',
      `import { config } from ${JSON.stringify(ENV_JS)}; console.log(JSON.stringify(config.orderFieldsReadonly));`,
    ], { env, cwd: os.tmpdir(), encoding: 'utf8' });
    return JSON.parse(out.trim().split('\n').pop());
  }

  it('mặc định TẮT khi không đặt biến, hoặc để trống', () => {
    assert.equal(readFlag(undefined), false);
    assert.equal(readFlag(''), false);
    assert.equal(readFlag('   '), false);
  });
  it('BẬT với true/1/yes/on (không phân biệt hoa thường, bỏ khoảng trắng hai đầu)', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', 'Yes', ' On ', 'ON']) assert.equal(readFlag(v), true, JSON.stringify(v));
  });
  it('mọi giá trị khác đều TẮT (false/0/no/off/y/2/enable...)', () => {
    for (const v of ['false', '0', 'no', 'off', 'y', '2', 'enable', 'truee', 'tru']) assert.equal(readFlag(v), false, JSON.stringify(v));
  });
});
