// Test SQL THẬT + gRPC THẬT cho đồng bộ đơn -> hồ sơ QC (PLAN-0043):
//   - qcFiles.service.syncOrderInfo / updateQCFile trên một Postgres thật;
//   - server gRPC (startGrpc) trên cổng tạm, gọi bằng client @grpc/grpc-js nạp cùng file .proto.
//
// CHỈ chạy khi đặt TEST_DATABASE_URL (vd postgresql://USER:PASS@localhost:5432/qc_sync_test) và tên DB
// có chữ "test" — test sẽ TRUNCATE bảng qc_files, nên tuyệt đối không trỏ vào DB thật. Không đặt thì BỎ QUA
// (không fail). Không cần Supabase hay mạng: SUPABASE_* là giá trị giả, pool nối lười.
// Test tự nạp db/schema.sql (idempotent). Postgres local thường không bật SSL -> tắt SSL của pool trong test
// (đặt TEST_DATABASE_SSL=1 nếu DB test của bạn có SSL).
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

function skipReason() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return 'không đặt TEST_DATABASE_URL — bỏ qua test DB thật';
  let dbName = '';
  try { dbName = new URL(url).pathname.replace(/^\//, ''); } catch { return 'TEST_DATABASE_URL không phải URL hợp lệ'; }
  if (!/test/i.test(dbName)) return `tên DB "${dbName}" không chứa "test" — từ chối chạy (test TRUNCATE bảng)`;
  return false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

describe('PLAN-0043 — đồng bộ đơn sang hồ sơ QC (DB thật)', { skip: skipReason() }, () => {
  let pool, svc, completion;

  before(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; // GHI ĐÈ trước khi nạp config (dotenv không đè biến đã đặt)
    process.env.SUPABASE_URL = 'https://unused.invalid';
    process.env.SUPABASE_SERVICE_KEY = 'unused';
    ({ pool } = await import('../src/lib/db.js'));
    if (process.env.TEST_DATABASE_SSL !== '1') pool.options.ssl = false; // pool mặc định ép SSL cho Supabase
    await pool.query(fs.readFileSync(path.join(ROOT, 'db/schema.sql'), 'utf8'));
    svc = await import('../src/services/qcFiles.service.js');
    completion = await import('../src/services/completion.service.js');
  });
  after(async () => { if (pool) await pool.end(); });
  beforeEach(async () => { await pool.query('TRUNCATE qc_files CASCADE'); });

  // ---- tiện ích ----
  const create = (orderId, extra = {}) => svc.findOrCreateForOrder({ orderId, poNo: 'AGO1', ...extra }).then((r) => r.qcFile);
  const row = async (orderId) => (await pool.query(
    `SELECT id, customer, product_name, specification, po_quantity, unit, supplier, container_no, seal_no,
            container_loading_date::text AS container_loading_date, qc_staff, po_no, qc_done_at, updated_at::text AS updated_at
       FROM qc_files WHERE order_id = $1`, [orderId])).rows[0];
  const OLD = '2000-01-01 00:00:00+00';
  const age = (orderId) => pool.query("UPDATE qc_files SET updated_at = $2 WHERE order_id = $1", [orderId, OLD]);
  const lock = (orderId) => pool.query('UPDATE qc_files SET qc_done_at = now(), qc_done_by = $2 WHERE order_id = $1', [orderId, 'QC']);

  const FULL = {
    customer: 'Khách A', productName: 'Thanh long', specification: 'Loại 1', poQuantity: '100', unit: 'kg',
    supplier: 'Xưởng A', containerNo: 'MSKU1234567', sealNo: 'SEAL01', containerLoadingDate: '2026-10-05',
  };

  describe('syncOrderInfo (service + SQL)', () => {
    it('chưa có hồ sơ cho order_id -> fileFound=false, không lỗi, không tạo gì', async () => {
      assert.deepEqual(await svc.syncOrderInfo(999, FULL), { fileFound: false, locked: false, updated: false });
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM qc_files')).rows[0].n, 0);
    });

    it('lần đầu (only_fill_empty): điền ô trống, KHÔNG đè ô QC đã gõ tay', async () => {
      await create(1, { customer: 'Gõ tay', productName: '' });
      const r = await svc.syncOrderInfo(1, FULL, { onlyFillEmpty: true });
      assert.deepEqual(r, { fileFound: true, locked: false, updated: true });
      const f = await row(1);
      assert.equal(f.customer, 'Gõ tay');          // giữ
      assert.equal(f.product_name, 'Thanh long');  // điền
      assert.equal(f.supplier, 'Xưởng A');
      assert.equal(f.container_no, 'MSKU1234567');
      assert.equal(f.seal_no, 'SEAL01');
      assert.equal(f.container_loading_date, '2026-10-05');
      assert.equal(f.po_quantity, '100');
      assert.equal(f.unit, 'kg');
    });

    it('lần sau (ghi đè): đơn thắng với ô khác giá trị', async () => {
      await create(1, { customer: 'Gõ tay' });
      await svc.syncOrderInfo(1, FULL, { onlyFillEmpty: true });
      const r = await svc.syncOrderInfo(1, { ...FULL, customer: 'Khách B', sealNo: 'SEAL02', containerLoadingDate: '2026-10-06' });
      assert.equal(r.updated, true);
      const f = await row(1);
      assert.equal(f.customer, 'Khách B');
      assert.equal(f.seal_no, 'SEAL02');
      assert.equal(f.container_loading_date, '2026-10-06');
      assert.equal(f.supplier, 'Xưởng A');
    });

    it('đồng bộ lặp lại y hệt: updated=false và KHÔNG bump updated_at', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      const r = await svc.syncOrderInfo(1, FULL);
      assert.deepEqual(r, { fileFound: true, locked: false, updated: false });
      assert.equal((await row(1)).updated_at, '2000-01-01 00:00:00+00');
    });

    it('khác giá trị thì BUMP updated_at', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      await svc.syncOrderInfo(1, { ...FULL, unit: 'thùng' });
      assert.notEqual((await row(1)).updated_at, '2000-01-01 00:00:00+00');
    });

    it('giá trị trùng sau trim cũng không ghi', async () => {
      await create(1);
      await svc.syncOrderInfo(1, FULL);
      await age(1);
      const r = await svc.syncOrderInfo(1, { ...FULL, customer: '  Khách A ', containerNo: '\tMSKU1234567' });
      assert.equal(r.updated, false);
      assert.equal((await row(1)).updated_at, '2000-01-01 00:00:00+00');
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
      assert.equal(f.updated_at, '2000-01-01 00:00:00+00');
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
      assert.equal(f.updated_at, '2000-01-01 00:00:00+00');

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
  });

  describe('HTTP updateQCFile — ô do đơn sở hữu là chỉ-đọc với hồ sơ có order_id', () => {
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
      assert.equal((await row(1)).updated_at, OLD);
    });

    it('hồ sơ TẠO TAY (không order_id): giữ nguyên hành vi cũ, sửa được cả 9 ô', async () => {
      const made = await svc.createQCFile({ poNo: 'TAY1' }); // không orderId
      const id = made.qcFile.ID;
      assert.equal((await pool.query('SELECT order_id FROM qc_files WHERE id = $1', [id])).rows[0].order_id, null);
      await svc.updateQCFile({ qcFileId: id, ...FULL });
      let f = (await pool.query("SELECT customer, supplier, container_no, seal_no, container_loading_date::text AS d, po_quantity, unit, product_name, specification FROM qc_files WHERE id = $1", [id])).rows[0];
      assert.equal(f.customer, 'Khách A');
      assert.equal(f.supplier, 'Xưởng A');
      assert.equal(f.container_no, 'MSKU1234567');
      assert.equal(f.d, '2026-10-05');
      assert.equal(f.unit, 'kg');
      await svc.updateQCFile({ qcFileId: id, customer: '', containerLoadingDate: '' }); // xoá được như cũ
      f = (await pool.query("SELECT customer, container_loading_date::text AS d FROM qc_files WHERE id = $1", [id])).rows[0];
      assert.equal(f.customer, '');
      assert.equal(f.d, null);
    });

    it('updateQCFile với id không có hồ sơ vẫn báo lỗi như cũ', async () => {
      await assert.rejects(() => svc.updateQCFile({ qcFileId: crypto.randomUUID(), poNo: 'X' }), /Không tìm thấy hồ sơ QC/);
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
      assert.equal((await row(10)).updated_at, OLD);

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

    it('only_fill_empty=true không đè ô QC đã gõ tay', async () => {
      await create(12, { customer: 'Gõ tay', unit: 'cont' });
      const { res } = await sync({ orderId: 12, ...FULL, onlyFillEmpty: true });
      assert.equal(res.updated, true);
      const f = await row(12);
      assert.equal(f.customer, 'Gõ tay');
      assert.equal(f.unit, 'cont');
      assert.equal(f.supplier, 'Xưởng A');
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
