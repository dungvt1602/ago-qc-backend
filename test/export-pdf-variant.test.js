// Test (không DB, không mạng, không dựng PDF thật) cho gRPC ExportPDF.variant (PLAN-0049):
//   (a) normalizePdfVariant: ""/internal/en hợp lệ, mọi giá trị khác bị từ chối;
//   (b) server gRPC thật trên cổng tạm, DB và dựng PDF được thay bằng giả (opts.exportPdfDeps): kiểm variant
//       đi tới đúng bản PDF, link trả về lấy đúng cột của bản đó, variant lạ -> INVALID_ARGUMENT TRƯỚC khi tra DB.
// Chạy: npm test
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { InvalidPdfVariantError, normalizePdfVariant } from '../src/lib/pdfVariant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO = path.resolve(__dirname, '../proto/qc/v1/qc.proto');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

describe('normalizePdfVariant', () => {
  it('"", thiếu và "internal" -> bản nội bộ (hành vi cũ)', () => {
    for (const v of ['', undefined, null, 'internal']) assert.equal(normalizePdfVariant(v), 'internal');
  });
  it('"en" -> bản khách hàng', () => {
    assert.equal(normalizePdfVariant('en'), 'en');
  });
  it('mọi giá trị khác bị từ chối bằng lỗi công khai INVALID_ARGUMENT, câu cố định không in lại giá trị', () => {
    for (const v of ['EN', 'En', 'vi', ' en', 'en ', 'Internal', 'customer', 0, 1, true, {}]) {
      assert.throws(() => normalizePdfVariant(v), (e) => {
        assert.ok(e instanceof InvalidPdfVariantError);
        assert.equal(e.grpcCode, grpc.status.INVALID_ARGUMENT);
        assert.equal(e.expose, true);
        assert.equal(e.message, 'variant phải là "", "internal" hoặc "en"'); // câu cố định, không phản chiếu đầu vào
        return true;
      }, JSON.stringify(v));
    }
  });
});

describe('gRPC ExportPDF.variant (server thật, DB + dựng PDF giả)', () => {
  const API_KEY = 'test-key-variant';
  const process_env = { DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused', SUPABASE_URL: 'https://unused.invalid', SUPABASE_SERVICE_KEY: 'unused' };
  let server, client, stopGrpc, logMock, findId, render;

  // Hồ sơ giả có ĐỦ hai cột link để bắt lỗi lấy nhầm cột.
  const FILE = { PDF_URL: 'https://x/vn.pdf', PDF_URL_EN: 'https://x/en.pdf', QC_STAFF: 'Thái', QC_DONE_BY: 'Người khác' };

  before(async () => {
    for (const [k, v] of Object.entries(process_env)) process.env[k] ??= v; // config/env.js yêu cầu có đủ biến
    logMock = mock.method(console, 'log', () => {});
    const mod = await import('../src/grpc/server.js');
    stopGrpc = mod.stopGrpc;
    findId = mock.fn(async (orderId) => (orderId === 404 ? null : `file-${orderId}`));
    render = mock.fn(async () => ({ qcFile: FILE }));
    const port = await freePort();
    server = await mod.startGrpc({ apiKey: API_KEY, port, exportPdfDeps: { findIdByOrderId: findId, render } });
    const def = protoLoader.loadSync(PROTO, { keepCase: false, longs: Number, defaults: true, oneofs: true });
    const QCService = grpc.loadPackageDefinition(def).ago.qc.v1.QCService;
    client = new QCService(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });
  after(async () => {
    if (client) client.close();
    await stopGrpc?.(server);
    logMock?.mock.restore();
  });

  const call = (req) => new Promise((resolve) => {
    const md = new grpc.Metadata();
    md.set('x-api-key', API_KEY);
    client.ExportPDF(req, md, { deadline: Date.now() + 10000 }, (err, res) => resolve({ err, res }));
  });

  it('không gửi variant (client cũ) -> bản nội bộ + link pdf_url, đúng như trước đây', async () => {
    render.mock.resetCalls();
    const { err, res } = await call({ orderId: 7 });
    assert.equal(err, null);
    assert.deepEqual({ ...res }, { fileFound: true, pdfUrl: 'https://x/vn.pdf', qcStaff: 'Thái', variant: 'internal' });
    assert.deepEqual(render.mock.calls.at(-1).arguments, ['file-7', 'internal']);
  });

  it('variant "" và "internal" -> bản nội bộ', async () => {
    for (const variant of ['', 'internal']) {
      render.mock.resetCalls();
      const { err, res } = await call({ orderId: 7, variant });
      assert.equal(err, null);
      assert.equal(res.pdfUrl, 'https://x/vn.pdf');
      assert.equal(res.variant, 'internal'); // echo bản đã xuất: "" được chuẩn hoá thành 'internal'
      assert.deepEqual(render.mock.calls.at(-1).arguments, ['file-7', 'internal']);
    }
  });

  it('variant "en" -> dựng bản khách và trả link pdf_url_en (không phải link bản nội bộ)', async () => {
    render.mock.resetCalls();
    const { err, res } = await call({ orderId: 7, variant: 'en' });
    assert.equal(err, null);
    assert.deepEqual({ ...res }, { fileFound: true, pdfUrl: 'https://x/en.pdf', qcStaff: 'Thái', variant: 'en' });
    assert.deepEqual(render.mock.calls.at(-1).arguments, ['file-7', 'en']);
  });

  it('echo variant luôn là bản đã THỰC SỰ dựng (đối chiếu với tham số đưa vào render), không phải chuỗi client gửi', async () => {
    for (const [sent, rendered] of [[undefined, 'internal'], ['', 'internal'], ['internal', 'internal'], ['en', 'en']]) {
      render.mock.resetCalls();
      const { err, res } = await call({ orderId: 7, variant: sent });
      assert.equal(err, null);
      assert.equal(render.mock.calls.at(-1).arguments[1], rendered);
      assert.equal(res.variant, rendered);
    }
  });

  it('variant "en" mà hồ sơ chưa có link bản EN -> pdf_url rỗng, KHÔNG rơi về link bản nội bộ', async () => {
    render.mock.mockImplementationOnce(async () => ({ qcFile: { ...FILE, PDF_URL_EN: null } }));
    const { err, res } = await call({ orderId: 7, variant: 'en' });
    assert.equal(err, null);
    assert.equal(res.pdfUrl, '');
  });

  it('variant lạ -> INVALID_ARGUMENT, không tra DB, không dựng PDF', async () => {
    for (const variant of ['EN', 'vi', 'customer', ' en']) {
      findId.mock.resetCalls();
      render.mock.resetCalls();
      const { err } = await call({ orderId: 7, variant });
      assert.equal(err.code, grpc.status.INVALID_ARGUMENT, variant);
      assert.match(err.details, /variant/);
      assert.equal(findId.mock.callCount(), 0);
      assert.equal(render.mock.callCount(), 0);
    }
  });

  it('variant lạ vẫn INVALID_ARGUMENT kể cả khi đơn chưa có hồ sơ (kiểm trước khi tra DB)', async () => {
    const { err } = await call({ orderId: 404, variant: 'xx' });
    assert.equal(err.code, grpc.status.INVALID_ARGUMENT);
  });

  it('đơn chưa có hồ sơ -> file_found=false với cả hai bản, không dựng PDF', async () => {
    for (const [variant, echo] of [['', 'internal'], ['en', 'en']]) {
      render.mock.resetCalls();
      const { err, res } = await call({ orderId: 404, variant });
      assert.equal(err, null);
      assert.deepEqual({ ...res }, { fileFound: false, pdfUrl: '', qcStaff: '', variant: echo });
      assert.equal(render.mock.callCount(), 0);
    }
  });
});
