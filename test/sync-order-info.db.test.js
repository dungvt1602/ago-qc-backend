// Test SQL THẬT + gRPC THẬT cho đồng bộ đơn -> hồ sơ QC (PLAN-0043):
//   - qcFiles.service.syncOrderInfo / updateQCFile trên một Postgres thật (cả hai trạng thái của cờ
//     QC_ORDER_FIELDS_READONLY);
//   - server gRPC (startGrpc) trên cổng tạm, gọi bằng client @grpc/grpc-js nạp cùng file .proto.
//
// CHỈ chạy khi đặt TEST_DATABASE_URL (vd postgresql://USER:PASS@localhost:5432/qc_sync_test) và tên DB có
// "test" thành một đoạn riêng (qc_sync_test, test_db, qc-test...) — test sẽ TRUNCATE bảng qc_files, nên tuyệt
// đối không trỏ vào DB thật. Không đặt thì BỎ QUA (không fail). Không cần Supabase hay mạng: SUPABASE_* là
// giá trị giả, pool nối lười.
// Test tự nạp db/schema.sql (idempotent). Postgres local thường không bật SSL -> tắt SSL của pool trong test
// (đặt TEST_DATABASE_SSL=1 nếu DB test của bạn có SSL). Không phụ thuộc múi giờ của phiên kết nối.
//
// Tạo DB tạm:  docker exec <container> psql -U <user> -d postgres -c "CREATE DATABASE qc_sync_test"
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Trả lý do TỪ CHỐI chạy (chuỗi) hoặc false nếu URL an toàn để TRUNCATE. "test" phải là một đoạn riêng
// (đầu/cuối tên, hoặc kẹp giữa _ hoặc -): "contest", "latest", "ago_order" đều bị từ chối.
function dbNameGuard(url) {
  if (!url) return 'không đặt TEST_DATABASE_URL — bỏ qua test DB thật';
  let dbName = '';
  try { dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch { return 'TEST_DATABASE_URL không phải URL hợp lệ'; }
  if (!/(^|[_-])test($|[_-])/i.test(dbName)) return `tên DB "${dbName}" không có "test" thành một đoạn riêng — từ chối chạy (test TRUNCATE bảng)`;
  return false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

// Luôn chạy (không cần DB): bảo vệ tên DB là chốt chặn cuối cùng trước lệnh TRUNCATE.
describe('bảo vệ tên DB của test DB thật', () => {
  const at = (name) => `postgresql://u:p@localhost:5432/${name}`;
  it('TỪ CHỐI DB không phải DB test (đặc biệt ago_order)', () => {
    for (const n of ['ago_order', 'ago_order_local', 'ago_order_nv', 'postgres', 'qc', 'qc_files', 'production', 'contest', 'latest', 'testing', 'attest', 'qc_sync_testing', 'protest_db', 'supabase']) {
      assert.ok(dbNameGuard(at(n)), n);
    }
  });
  it('CHẤP NHẬN DB có "test" là một đoạn riêng', () => {
    for (const n of ['qc_sync_test', 'qc_sync_test_2', 'test', 'test_qc', 'test-qc', 'qc-test', 'QC_SYNC_TEST', 'ago_eta_test']) {
      assert.equal(dbNameGuard(at(n)), false, n);
    }
  });
  it('thiếu URL hoặc URL hỏng -> từ chối', () => {
    assert.ok(dbNameGuard(undefined));
    assert.ok(dbNameGuard(''));
    assert.ok(dbNameGuard('không phải url'));
    assert.ok(dbNameGuard('postgresql://u:p@localhost:5432')); // không có tên DB
  });
  it('chỉ xét TÊN DB, không xét chữ "test" ở user/host/mật khẩu', () => {
    assert.ok(dbNameGuard('postgresql://test:test@test.local:5432/ago_order'));
    assert.ok(dbNameGuard('postgresql://u:p@localhost:5432/ago_order?application_name=test'));
  });
});

describe('PLAN-0043 — đồng bộ đơn sang hồ sơ QC (DB thật)', { skip: dbNameGuard(process.env.TEST_DATABASE_URL) }, () => {
  let pool, svc, completion, config;
  let flagBefore;

  before(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // GHI ĐÈ trước khi nạp config (dotenv không đè biến đã đặt)
    process.env.SUPABASE_URL = 'https://unused.invalid';
    process.env.SUPABASE_SERVICE_KEY = 'unused';
    ({ pool } = await import('../src/lib/db.js'));
    if (process.env.TEST_DATABASE_SSL !== '1') pool.options.ssl = false; // pool mặc định ép SSL cho Supabase
    await pool.query(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
    svc = await import('../src/services/qcFiles.service.js');
    completion = await import('../src/services/completion.service.js');
    ({ config } = await import('../src/config/env.js'));
    flagBefore = config.orderFieldsReadonly;
  });
  after(async () => {
    if (config) config.orderFieldsReadonly = flagBefore;
    if (pool) await pool.end();
  });
  beforeEach(async () => {
    config.orderFieldsReadonly = false; // mặc định của cờ; từng nhóm test tự bật khi cần
    await pool.query('TRUNCATE qc_files CASCADE');
  });

  // ---- tiện ích ----
  const create = (orderId, extra = {}) => svc.findOrCreateForOrder({ orderId, poNo: 'AGO1', ...extra }).then((r) => r.qcFile);
  // updated_epoch (giây, float8) thay vì updated_at::text: không phụ thuộc múi giờ phiên kết nối.
  const row = async (orderId) => (await pool.query(
    `SELECT id, customer, product_name, specification, po_quantity, unit, supplier, container_no, seal_no,
            container_loading_date::text AS container_loading_date, qc_staff, po_no, qc_done_at,
            EXTRACT(EPOCH FROM updated_at)::float8 AS updated_epoch
       FROM qc_files WHERE order_id = $1`, [orderId])).rows[0];
  const OLD = '2000-01-01 00:00:00+00';        // offset tường minh nên múi giờ phiên không ảnh hưởng
  const OLD_EPOCH = Date.UTC(2000, 0, 1) / 1000; // 946684800
  const age = (orderId) => pool.query('UPDATE qc_files SET updated_at = $2 WHERE order_id = $1', [orderId, OLD]);
  const lock = (orderId) => pool.query('UPDATE qc_files SET qc_done_at = now(), qc_done_by = $2 WHERE order_id = $1', [orderId, 'QC']);
  const NINE = ['customer', 'product_name', 'specification', 'po_quantity', 'unit', 'supplier', 'container_no', 'seal_no', 'container_loading_date'];

  const FULL = {
    customer: 'Khách A', productName: 'Thanh long', specification: 'Loại 1', poQuantity: '100', unit: 'kg',
    supplier: 'Xưởng A', containerNo: 'MSKU1234567', sealNo: 'SEAL01', containerLoadingDate: '2026-10-05',
  };

  describe('syncOrderInfo (service + SQL)', () => {
    it('chưa có hồ sơ cho order_id -> fileFound=false, không lỗi, không tạo gì', async () => {
      assert.deepEqual(await svc.syncOrderInfo(999, FULL), { fileFound: false, locked: false, updated: false });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qc_files')).rows[0].n, 0);
    });

    it('lần đầu (only_fill_empty): 4 ô QC có thể gõ tay chỉ điền khi trống, 5 ô còn lại luôn làm tươi', async () => {
      await create(1, {
        customer: 'Khách cũ', productName: 'SP cũ', specification: 'QC cũ', poQuantity: '1', unit: 'cont', // do đơn gieo lúc CreateQC, nay đã cũ
        supplier: 'QC gõ tay', sealNo: 'TAY',                                                              // QC tự gõ
      });
      const r = await svc.syncOrderInfo(1, FULL, { onlyFillEmpty: true });
      assert.deepEqual(r, { fileFound: true, locked: false, updated: true });
      const f = await row(1);
      assert.equal(f.supplier, 'QC gõ tay');       // giữ
      assert.equal(f.seal_no, 'TAY');              // giữ
      assert.equal(f.container_no, 'MSKU1234567'); // trống -> điền
      assert.equal(f.container_loading_date, '2026-10-05'); // trống -> điền
      assert.equal(f.customer, 'Khách A');         // làm tươi
      assert.equal(f.product_name, 'Thanh long');
      assert.equal(f.specification, 'Loại 1');
      assert.equal(f.po_quantity, '100');
      assert.equal(f.unit, 'kg');
    });

    it('lần sau (ghi đè): đơn thắng ở cả 9 ô khi khác giá trị', async () => {
      await create(1, { supplier: 'QC gõ tay' });
      await svc.syncOrderInfo(1, FULL, { onlyFillEmpty: true });
      assert.equal((await row(1)).supplier, 'QC gõ tay');
      const r = await svc.syncOrderInfo(1, { ...FULL, customer: 'Khách B', supplier: 'Xưởng B', sealNo: 'SEAL02', containerLoadingDate: '2026-10-06' });
      assert.equal(r.updated, true);
      const f = await row(1);
      assert.equal(f.customer, 'Khách B');
      assert.equal(f.supplier, 'Xưởng B'); // từ lần sau đơn đè cả chữ QC gõ tay
      assert.equal(f.seal_no, 'SEAL02');
      assert.equal(f.container_loading_date, '2026-10-06');
      assert.equal(f.container_no, 'MSKU1234567');
    });

    it('đồng bộ lặp lại y hệt: updated=false và KHÔNG bump updated_at', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      const r = await svc.syncOrderInfo(1, FULL);
      assert.deepEqual(r, { fileFound: true, locked: false, updated: false });
      assert.equal((await row(1)).updated_epoch, OLD_EPOCH);
    });

    it('lần đầu mà không có gì khác: cũng KHÔNG bump updated_at', async () => {
      await create(1, { ...FULL, poQuantity: '100' });
      await age(1);
      const r = await svc.syncOrderInfo(1, FULL, { onlyFillEmpty: true });
      assert.equal(r.updated, false);
      assert.equal((await row(1)).updated_epoch, OLD_EPOCH);
    });

    it('khác giá trị thì BUMP updated_at', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      await svc.syncOrderInfo(1, { ...FULL, unit: 'thùng' });
      assert.notEqual((await row(1)).updated_epoch, OLD_EPOCH);
    });

    it('giá trị trùng sau trim cũng không ghi', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      const r = await svc.syncOrderInfo(1, { ...FULL, customer: '  Khách A ', containerNo: '\tMSKU1234567' });
      assert.equal(r.updated, false);
      assert.equal((await row(1)).updated_epoch, OLD_EPOCH);
    });

    it('giá trị rỗng từ đơn KHÔNG BAO GIỜ xoá ô bên QC (cả hai chế độ)', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      const empty = Object.fromEntries(Object.keys(FULL).map((k) => [k, '']));
      for (const onlyFillEmpty of [true, false]) {
        const r = await svc.syncOrderInfo(1, empty, { onlyFillEmpty });
        assert.equal(r.updated, false);
      }
      const f = await row(1);
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.container_no, 'MSKU1234567');
      assert.equal(f.container_loading_date, '2026-10-05');
      assert.equal(f.updated_epoch, OLD_EPOCH);
    });

    it('ô chưa từng có (NULL ở cột ngày, rỗng ở cột chữ) đều điền được ở lần đầu', async () => {
      await create(1);
      assert.equal((await row(1)).container_loading_date, null);
      assert.equal((await svc.syncOrderInfo(1, { containerLoadingDate: '2026-02-28', sealNo: 'X' }, { onlyFillEmpty: true })).updated, true);
      const f = await row(1);
      assert.equal(f.container_loading_date, '2026-02-28');
      assert.equal(f.seal_no, 'X');
    });

    it('ngày sai -> InvalidOrderInfoError (INVALID_ARGUMENT), không ghi gì — kể cả khi chưa có hồ sơ', async () => {
      await create(1);
      const bad = { ...FULL, containerLoadingDate: '2026-02-30' };
      await assert.rejects(() => svc.syncOrderInfo(1, bad), (e) => e.grpcCode === grpc.status.INVALID_ARGUMENT);
      await assert.rejects(() => svc.syncOrderInfo(404, bad), (e) => e.grpcCode === grpc.status.INVALID_ARGUMENT);
      const f = await row(1);
      assert.equal(f.customer ?? '', '');
      assert.equal(f.supplier ?? '', '');
    });

    it('chuỗi chứa NUL -> InvalidOrderInfoError TRƯỚC khi đụng DB, không ghi gì (Postgres sẽ từ chối NUL)', async () => {
      await create(1);
      for (const key of Object.keys(FULL)) {
        await assert.rejects(() => svc.syncOrderInfo(1, { ...FULL, [key]: 'a\u0000b' }), (e) => e.grpcCode === grpc.status.INVALID_ARGUMENT, key);
      }
      await assert.rejects(() => svc.syncOrderInfo(404, { customer: 'x\u0000' }), (e) => e.grpcCode === grpc.status.INVALID_ARGUMENT);
      const f = await row(1);
      assert.equal(f.customer ?? '', '');
      assert.equal(f.unit ?? '', '');
    });

    it('hồ sơ đã Hoàn tất (khoá): locked=true, KHÔNG ghi; Mở lại thì ghi', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      await lock(1);
      const r = await svc.syncOrderInfo(1, { ...FULL, customer: 'Khách B', supplier: 'Xưởng B' });
      assert.deepEqual(r, { fileFound: true, locked: true, updated: false });
      let f = await row(1);
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.supplier, 'Xưởng A');
      assert.equal(f.updated_epoch, OLD_EPOCH);

      const id = f.id;
      await completion.reopenQC({ qcFileId: id });
      const r2 = await svc.syncOrderInfo(1, { ...FULL, customer: 'Khách B' });
      assert.deepEqual(r2, { fileFound: true, locked: false, updated: true });
      f = await row(1);
      assert.equal(f.customer, 'Khách B');
    });

    it('CÙNG luật khoá với assertEditable: hồ sơ nào assertEditable chặn thì sync cũng chặn, và ngược lại', async () => {
      const file = await create(1);
      assert.equal(await completion.assertEditable({ qcFileId: file.ID }), undefined); // chưa khoá: không ném
      assert.equal((await svc.syncOrderInfo(1, FULL)).locked, false);
      await lock(1);
      await assert.rejects(() => completion.assertEditable({ qcFileId: file.ID }), /KHÓA/);
      assert.equal((await svc.syncOrderInfo(1, { ...FULL, unit: 'thùng' })).locked, true);
    });

    it('chỉ hồ sơ đúng order_id đổi, hồ sơ khác nguyên vẹn', async () => {
      await create(1);
      await create(2);
      await svc.syncOrderInfo(1, FULL);
      assert.equal((await row(1)).supplier, 'Xưởng A');
      assert.equal((await row(2)).supplier ?? '', '');
    });

    it('không đụng ô QC tự quản (po_no, qc_staff, est_finish_date...)', async () => {
      await create(1, { qcStaff: 'Lan' });
      await svc.syncOrderInfo(1, { ...FULL, poNo: 'HACK', qcStaff: 'HACK', contractNo: 'HACK' });
      const f = await row(1);
      assert.equal(f.po_no, 'AGO1');
      assert.equal(f.qc_staff, 'Lan');
    });

    it('SyncOrderInfo KHÔNG bị cờ QC_ORDER_FIELDS_READONLY chi phối (tắt hay bật đều ghi)', async () => {
      await create(1);
      config.orderFieldsReadonly = false;
      assert.equal((await svc.syncOrderInfo(1, FULL)).updated, true);
      config.orderFieldsReadonly = true;
      assert.equal((await svc.syncOrderInfo(1, { ...FULL, unit: 'thùng' })).updated, true);
      assert.equal((await row(1)).unit, 'thùng');
    });
  });

  describe('HTTP updateQCFile — cờ QC_ORDER_FIELDS_READONLY BẬT: ô do đơn sở hữu là chỉ-đọc với hồ sơ có order_id', () => {
    beforeEach(() => { config.orderFieldsReadonly = true; });

    it('bỏ âm thầm 9 ô, vẫn ghi ô khác; snapshot trống của FE không xoá giá trị đơn đẩy sang', async () => {
      const file = await create(1);
      await svc.syncOrderInfo(1, FULL);
      const stale = Object.fromEntries(Object.keys(FULL).map((k) => [k, '']));
      await svc.updateQCFile({ qcFileId: file.ID, ...stale, poNo: 'AGO-MOI', qcStaff: 'Lan', startDate: '2026-10-02' });
      const f = await row(1);
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.supplier, 'Xưởng A');
      assert.equal(f.container_no, 'MSKU1234567');
      assert.equal(f.container_loading_date, '2026-10-05');
      assert.equal(f.po_quantity, '100');
      assert.equal(f.po_no, 'AGO-MOI');
      assert.equal(f.qc_staff, 'Lan');
    });

    it('cố ghi giá trị khác vào ô do đơn sở hữu cũng bị bỏ', async () => {
      const file = await create(1);
      await svc.syncOrderInfo(1, FULL);
      await svc.updateQCFile({ qcFileId: file.ID, customer: 'Sửa tay', sealNo: 'TAY', containerLoadingDate: '2027-01-01' });
      const f = await row(1);
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.seal_no, 'SEAL01');
      assert.equal(f.container_loading_date, '2026-10-05');
    });

    it('payload chỉ gồm ô do đơn sở hữu -> không chạy UPDATE (updated_at giữ nguyên)', async () => {
      const file = await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      await svc.updateQCFile({ qcFileId: file.ID, customer: 'x', supplier: 'y' });
      assert.equal((await row(1)).updated_epoch, OLD_EPOCH);
    });

    it('hồ sơ TẠO TAY (không order_id): giữ nguyên hành vi cũ, sửa được cả 9 ô', async () => {
      const made = await svc.createQCFile({ poNo: 'TAY1' }); // không orderId
      const id = made.qcFile.ID;
      assert.equal((await pool.query('SELECT order_id FROM qc_files WHERE id = $1', [id])).rows[0].order_id, null);
      await svc.updateQCFile({ qcFileId: id, ...FULL });
      let f = (await pool.query('SELECT customer, supplier, container_no, seal_no, container_loading_date::text AS d, po_quantity, unit, product_name, specification FROM qc_files WHERE id = $1', [id])).rows[0];
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.supplier, 'Xưởng A');
      assert.equal(f.container_no, 'MSKU1234567');
      assert.equal(f.d, '2026-10-05');
      assert.equal(f.unit, 'kg');
      await svc.updateQCFile({ qcFileId: id, customer: '', containerLoadingDate: '' }); // xoá được như cũ
      f = (await pool.query('SELECT customer, container_loading_date::text AS d FROM qc_files WHERE id = $1', [id])).rows[0];
      assert.equal(f.customer, '');
      assert.equal(f.d, null);
    });

    it('updateQCFile với id không có hồ sơ vẫn báo lỗi như cũ', async () => {
      await assert.rejects(() => svc.updateQCFile({ qcFileId: crypto.randomUUID(), poNo: 'X' }), /Không tìm thấy hồ sơ QC/);
    });

    it('cờ BẬT mới phát truy vấn tra order_id của hồ sơ', async () => {
      const file = await create(1);
      const spy = mock.method(pool, 'query');
      try { await svc.updateQCFile({ qcFileId: file.ID, poNo: 'X' }); } finally { spy.mock.restore(); }
      const sqls = spy.mock.calls.map((c) => String(c.arguments[0]));
      assert.ok(sqls.some((s) => /SELECT order_id FROM qc_files WHERE id/.test(s)));
    });
  });

  describe('HTTP updateQCFile — cờ TẮT (mặc định): y hệt trước PLAN-0043 cho MỌI hồ sơ', () => {
    beforeEach(() => { config.orderFieldsReadonly = false; });

    it('hồ sơ CÓ order_id vẫn ghi cả 9 ô như trước (kể cả ô trống từ snapshot cũ)', async () => {
      const file = await create(1);
      await svc.syncOrderInfo(1, FULL);
      await svc.updateQCFile({ qcFileId: file.ID, customer: 'Sửa tay', supplier: 'Tay', sealNo: '', containerLoadingDate: '', poNo: 'AGO-MOI' });
      const f = await row(1);
      assert.equal(f.customer, 'Sửa tay');
      assert.equal(f.supplier, 'Tay');
      assert.equal(f.seal_no, '');
      assert.equal(f.container_loading_date, null);
      assert.equal(f.po_no, 'AGO-MOI');
    });

    it('payload chỉ gồm ô do đơn sở hữu: vẫn UPDATE (bump updated_at) như trước', async () => {
      const file = await create(1);
      await age(1);
      await svc.updateQCFile({ qcFileId: file.ID, customer: 'x' });
      const f = await row(1);
      assert.equal(f.customer, 'x');
      assert.notEqual(f.updated_epoch, OLD_EPOCH);
    });

    it('KHÔNG phát thêm truy vấn tra order_id (không đổi số truy vấn so với trước)', async () => {
      const file = await create(1);
      const spy = mock.method(pool, 'query');
      try { await svc.updateQCFile({ qcFileId: file.ID, poNo: 'X' }); } finally { spy.mock.restore(); }
      const sqls = spy.mock.calls.map((c) => String(c.arguments[0]));
      assert.ok(!sqls.some((s) => /SELECT order_id FROM qc_files WHERE id/.test(s)), sqls.join('\n'));
    });

    it('hồ sơ tạo tay: như cũ', async () => {
      const made = await svc.createQCFile({ poNo: 'TAY1' });
      await svc.updateQCFile({ qcFileId: made.qcFile.ID, ...FULL });
      const f = (await pool.query('SELECT customer, supplier FROM qc_files WHERE id = $1', [made.qcFile.ID])).rows[0];
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.supplier, 'Xưởng A');
    });

    it('id không có hồ sơ vẫn báo lỗi như cũ', async () => {
      await assert.rejects(() => svc.updateQCFile({ qcFileId: crypto.randomUUID(), poNo: 'X' }), /Không tìm thấy hồ sơ QC/);
    });

    it('cả 9 cột do đơn sở hữu đều sửa được qua HTTP khi cờ tắt', async () => {
      const file = await create(1);
      await svc.updateQCFile({ qcFileId: file.ID, ...FULL });
      const f = await row(1);
      for (const col of NINE) assert.ok(f[col] !== null && f[col] !== '', col);
    });
  });

  describe('gRPC SyncOrderInfo (server thật, cổng tạm)', () => {
    const API_KEY = `test-${crypto.randomBytes(8).toString('hex')}`;
    let server, client, stopGrpc, logMock;

    before(async () => {
      logMock = mock.method(console, 'log', () => {}); // server ghi log mỗi call: bớt ồn
      const mod = await import('../src/grpc/server.js');
      stopGrpc = mod.stopGrpc;
      const port = await freePort();
      server = await mod.startGrpc({ apiKey: API_KEY, port });
      const def = protoLoader.loadSync(path.join(ROOT, 'proto/qc/v1/qc.proto'), { keepCase: false, longs: Number, defaults: true, oneofs: true });
      const QCService = grpc.loadPackageDefinition(def).ago.qc.v1.QCService;
      client = new QCService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
    });
    after(async () => {
      if (client) client.close();
      await stopGrpc?.(server);
      logMock?.mock.restore();
    });

    // Gọi một RPC, trả { err, res } (không ném) để test kiểm cả mã lỗi lẫn nội dung.
    function call(method, req, { key = API_KEY } = {}) {
      const md = new grpc.Metadata();
      if (key !== null) md.set('x-api-key', key);
      return new Promise((resolve) => client[method](req, md, { deadline: Date.now() + 10000 }, (err, res) => resolve({ err, res })));
    }
    const sync = (req, opts) => call('SyncOrderInfo', req, opts);

    it('thiếu hoặc sai x-api-key -> UNAUTHENTICATED', async () => {
      assert.equal((await sync({ orderId: 1 }, { key: null })).err.code, grpc.status.UNAUTHENTICATED);
      assert.equal((await sync({ orderId: 1 }, { key: 'sai' })).err.code, grpc.status.UNAUTHENTICATED);
    });

    it('order_id <= 0 hoặc thiếu -> INVALID_ARGUMENT', async () => {
      assert.equal((await sync({ orderId: 0 })).err.code, grpc.status.INVALID_ARGUMENT);
      assert.equal((await sync({})).err.code, grpc.status.INVALID_ARGUMENT);
      assert.equal((await sync({ orderId: -3 })).err.code, grpc.status.INVALID_ARGUMENT);
    });

    it('đơn chưa có hồ sơ -> OK với file_found=false', async () => {
      const { err, res } = await sync({ orderId: 4242, customer: 'A' });
      assert.equal(err, null);
      assert.deepEqual({ ...res }, { fileFound: false, locked: false, updated: false });
    });

    it('hồ sơ có sẵn: điền, lặp lại không đổi, ghi đè khi khác', async () => {
      await create(10);
      const req = { orderId: 10, ...FULL, onlyFillEmpty: true };
      let r = await sync(req);
      assert.equal(r.err, null);
      assert.deepEqual({ ...r.res }, { fileFound: true, locked: false, updated: true });
      assert.equal((await row(10)).container_no, 'MSKU1234567');
      assert.equal((await row(10)).container_loading_date, '2026-10-05');

      await age(10);
      r = await sync({ ...req, onlyFillEmpty: false });
      assert.deepEqual({ ...r.res }, { fileFound: true, locked: false, updated: false });
      assert.equal((await row(10)).updated_epoch, OLD_EPOCH);

      r = await sync({ ...req, onlyFillEmpty: false, sealNo: 'SEAL99' });
      assert.equal(r.res.updated, true);
      assert.equal((await row(10)).seal_no, 'SEAL99');
    });

    it('trường proto bỏ trống (chuỗi rỗng mặc định) KHÔNG xoá dữ liệu QC', async () => {
      await create(11);
      await sync({ orderId: 11, ...FULL });
      const { err, res } = await sync({ orderId: 11 }); // mọi trường rỗng
      assert.equal(err, null);
      assert.equal(res.updated, false);
      assert.equal((await row(11)).customer, 'Khách A');
      assert.equal((await row(11)).container_loading_date, '2026-10-05');
    });

    it('only_fill_empty=true: 4 ô QC gõ tay giữ nguyên, 5 ô còn lại làm tươi', async () => {
      await create(12, { customer: 'Khách cũ', unit: 'cont', supplier: 'QC gõ tay', sealNo: 'TAY' });
      const { res } = await sync({ orderId: 12, ...FULL, onlyFillEmpty: true });
      assert.equal(res.updated, true);
      const f = await row(12);
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.unit, 'kg');
      assert.equal(f.supplier, 'QC gõ tay');
      assert.equal(f.seal_no, 'TAY');
      assert.equal(f.container_no, 'MSKU1234567');
    });

    it('hồ sơ khoá -> locked=true, không ghi', async () => {
      await create(13);
      await lock(13);
      const { err, res } = await sync({ orderId: 13, ...FULL });
      assert.equal(err, null);
      assert.deepEqual({ ...res }, { fileFound: true, locked: true, updated: false });
      assert.equal((await row(13)).supplier ?? '', '');
    });

    it('ngày sai -> INVALID_ARGUMENT kèm lý do, không ghi gì', async () => {
      await create(14);
      for (const bad of ['2026-02-30', '05/10/2026', 'abc', '2026-10-05 10:00']) {
        const { err } = await sync({ orderId: 14, ...FULL, containerLoadingDate: bad });
        assert.equal(err.code, grpc.status.INVALID_ARGUMENT, bad);
        assert.match(err.details, /container_loading_date/);
      }
      const f = await row(14);
      assert.equal(f.customer ?? '', '');
      assert.equal(f.container_loading_date, null);
    });

    it('chuỗi chứa NUL -> INVALID_ARGUMENT (không phải INTERNAL), câu lỗi cố định không in lại dữ liệu', async () => {
      await create(16);
      const errMock = mock.method(console, 'error', () => {});
      try {
        const { err } = await sync({ orderId: 16, ...FULL, customer: 'BÍ-MẬT\u0000' });
        assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
        assert.match(err.details, /NUL/);
        assert.ok(!err.details.includes('BÍ-MẬT'));
        assert.equal(errMock.mock.callCount(), 0); // lỗi dữ liệu không phải lỗi hệ thống: không in stack
      } finally { errMock.mock.restore(); }
      assert.equal((await row(16)).customer ?? '', '');
    });

    it('lỗi bất ngờ (DB hỏng) vẫn là INTERNAL và KHÔNG lộ chi tiết', async () => {
      await create(15);
      const errMock = mock.method(console, 'error', () => {});
      await pool.query('ALTER TABLE qc_files RENAME TO qc_files_tmp');
      let out;
      try { out = await sync({ orderId: 15, ...FULL }); }
      finally {
        await pool.query('ALTER TABLE qc_files_tmp RENAME TO qc_files');
        errMock.mock.restore();
      }
      assert.equal(out.err.code, grpc.status.INTERNAL);
      assert.equal(out.err.details, 'lỗi nội bộ App QC');
      assert.ok(!/qc_files|relation/i.test(out.err.details));
    });

    it('lỗi LẠ tình cờ mang .grpcCode (không phải InvalidOrderInfoError, không expose) vẫn là INTERNAL, không lộ message', async () => {
      await create(17);
      const errMock = mock.method(console, 'error', () => {});
      const boom = Object.assign(new Error('chi-tiet-noi-bo-nhay-cam'), { grpcCode: grpc.status.INVALID_ARGUMENT });
      const poolMock = mock.method(pool, 'query', async () => { throw boom; });
      let out;
      try { out = await sync({ orderId: 17, ...FULL }); }
      finally { poolMock.mock.restore(); errMock.mock.restore(); }
      assert.equal(out.err.code, grpc.status.INTERNAL);
      assert.equal(out.err.details, 'lỗi nội bộ App QC');
      assert.ok(!out.err.details.includes('nhay-cam'));
    });

    it('lỗi đánh dấu expose=true kèm .grpcCode -> trả đúng mã và câu của lỗi', async () => {
      await create(18);
      const errMock = mock.method(console, 'error', () => {});
      const known = Object.assign(new Error('câu-công-khai'), { grpcCode: grpc.status.FAILED_PRECONDITION, expose: true });
      const poolMock = mock.method(pool, 'query', async () => { throw known; });
      let out;
      try { out = await sync({ orderId: 18, ...FULL }); }
      finally { poolMock.mock.restore(); errMock.mock.restore(); }
      assert.equal(out.err.code, grpc.status.FAILED_PRECONDITION);
      assert.equal(out.err.details, 'câu-công-khai');
    });

    it('luồng thật: CreateQC rồi SyncOrderInfo rồi GetStatus (RPC cũ không hỏng)', async () => {
      const created = await call('CreateQC', { orderId: 20, poNo: 'AGO20', customer: 'Khách A', productName: 'Thanh long', createdByName: 'Lan' });
      assert.equal(created.err, null);
      assert.equal(created.res.created, true);
      const s = await sync({ orderId: 20, supplier: 'Xưởng A', customer: 'Khách đổi tên', containerNo: 'MSKU7654321' });
      assert.deepEqual({ ...s.res }, { fileFound: true, locked: false, updated: true });
      const f = await row(20);
      assert.equal(f.customer, 'Khách đổi tên');
      assert.equal(f.product_name, 'Thanh long'); // đơn rỗng -> giữ
      assert.equal(f.qc_staff, 'Lan');
      const st = await call('GetStatus', { orderId: 20 });
      assert.equal(st.err, null);
      assert.equal(st.res.done, false);
    });
  });
});
