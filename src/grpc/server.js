// Server gRPC để backend checklist (Go) gọi sang. Chạy CÙNG process với Express nhưng cổng riêng.
// Cổng này chỉ mở trên mạng riêng của Render (Internet không thấy) nên dùng plaintext, không TLS.
// Hợp đồng: proto/qc/v1/qc.proto. Tài liệu bàn giao: docs/qc-app-grpc-contract.md (repo checklist).
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import * as repo from '../repositories/qcFiles.repo.js';
import { InvalidOrderInfoError } from '../lib/orderSync.js';
import { exportPDF } from '../services/pdf.service.js';
import { findOrCreateForOrder, getQCFile, syncOrderInfo as syncOrderInfoToFile } from '../services/qcFiles.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = path.resolve(__dirname, '../../proto/qc/v1/qc.proto');

// Nạp thẳng file .proto lúc chạy (không cần bước sinh code).
// keepCase:false -> order_id thành orderId, photo_count thành photoCount (đúng như tài liệu checklist).
// longs:Number   -> int64 thành số JS (ID đơn không vượt 2^53).
function loadQCService() {
  const def = protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: Number, defaults: true, oneofs: true });
  return grpc.loadPackageDefinition(def).ago.qc.v1.QCService;
}

// So sánh khóa theo thời gian cố định -> không đoán được khóa qua độ trễ phản hồi.
function keyMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lỗi handler CHỦ ĐỘNG ném cho client thấy: có .grpcCode hợp lệ (1..16; 0 = OK nên không tính) VÀ được đánh dấu
// công khai (InvalidOrderInfoError hoặc expose === true). Chỉ loại này mới được trả message nguyên văn; mọi lỗi
// khác — kể cả lỗi lạ tình cờ có .grpcCode — vẫn là INTERNAL với câu cố định, không lộ chi tiết nội bộ.
function isExposedError(err) {
  return Boolean(err)
    && (err instanceof InvalidOrderInfoError || err.expose === true)
    && Number.isInteger(err.grpcCode) && err.grpcCode >= 1 && err.grpcCode <= 16;
}

// Bọc chung cho mọi RPC: kiểm khóa -> kiểm order_id -> chạy -> ghi log -> đổi lỗi sang mã gRPC.
function rpc(name, apiKey, handler) {
  return async (call, callback) => {
    const started = Date.now();
    const orderId = Number(call.request.orderId);
    const log = (result) => console.log(`[gRPC] ${name} order=${orderId} -> ${result} (${Date.now() - started}ms)`);

    if (!keyMatches(call.metadata.get('x-api-key')[0], apiKey)) {
      log('UNAUTHENTICATED');
      return callback({ code: grpc.status.UNAUTHENTICATED, details: 'sai hoặc thiếu x-api-key' });
    }
    if (!Number.isInteger(orderId) || orderId <= 0) {
      log('INVALID_ARGUMENT');
      return callback({ code: grpc.status.INVALID_ARGUMENT, details: 'order_id phải là số nguyên > 0' });
    }
    try {
      const result = await handler(orderId, call.request);
      log(JSON.stringify(result));
      callback(null, result);
    } catch (err) {
      // Lỗi CỐ Ý của handler (vd ngày sai định dạng) -> trả đúng mã .grpcCode kèm câu của lỗi.
      // Mọi lỗi khác (DB, bug...) vẫn là INTERNAL và KHÔNG lộ chi tiết ra ngoài.
      if (isExposedError(err)) {
        log(grpc.status[err.grpcCode] ?? String(err.grpcCode)); // KHÔNG log nội dung request
        return callback({ code: err.grpcCode, details: String(err.message || '') });
      }
      console.error(`[gRPC] ${name} order=${orderId} LỖI:`, err);
      callback({ code: grpc.status.INTERNAL, details: 'lỗi nội bộ App QC' });
    }
  };
}

// Đơn chưa có hồ sơ -> {0,false,...rỗng} chứ KHÔNG báo NOT_FOUND (theo hợp đồng: checklist hiểu là "chưa bắt đầu").
// Đợt 2: thêm photo_total, file_url, done_at, done_by, groups. Tất cả tính từ getQCFile + photoProgress
// (cùng nguồn với nút Hoàn tất trong app) nên sum(groups) luôn khớp photo_count/photo_total.
async function getStatus(orderId) {
  const id = await repo.findIdByOrderId(orderId);
  if (!id) return { photoCount: 0, done: false, photoTotal: 0, fileUrl: '', doneAt: 0, doneBy: '', groups: [] };
  const data = await getQCFile(id);
  const f = data.qcFile, p = data.progress;
  const done = Boolean(f.QC_DONE_AT);
  return {
    photoCount: p.filled,
    done,
    photoTotal: p.total,
    fileUrl: `${config.qcAppUrl}/qc/${encodeURIComponent(id)}`, // route Next.js /qc/[id]
    doneAt: done ? Number(f.QC_DONE_AT_MS) || 0 : 0,
    doneBy: done ? (f.QC_DONE_BY || '') : '',
    groups: p.groups.map((g) => ({ name: g.name, count: g.count, total: g.total })),
  };
}

async function createQC(orderId, r) {
  const { qcFile, created } = await findOrCreateForOrder({
    orderId,
    poNo: r.poNo, productName: r.productName, specification: r.specification,
    poQuantity: r.quantity, unit: r.unit, customer: r.customer, contractNo: r.contractNo,
    createdBy: r.createdByName, // trường 9, đợt 2
  });
  return { qcFileId: qcFile.ID, lotCode: qcFile.LOT_CODE, created };
}

// Checklist đẩy thông tin đơn sang hồ sơ ĐÃ CÓ (một chiều đơn -> QC, PLAN-0043).
// Chuỗi rỗng = "đơn chưa có thông tin" nên không ghi đè; hồ sơ khoá vẫn ghi 9 ô thuộc đơn (locked=true chỉ để báo).
// Luật chọn ô cần ghi nằm ở lib/orderSync.js, luật khoá ở lib/lock.js.
// writes_when_locked (trường 4) = true MỖI KHI file_found: bản App QC này biết ghi cả hồ sơ khoá. Checklist dựa vào
// cờ đó để phân biệt với bản cũ (thấy khoá thì không ghi, không có trường này) — thiếu cờ mà locked thì nó KHÔNG
// coi là đã đồng bộ. Đừng bỏ cờ, và đừng đặt nó theo điều kiện nào khác.
async function syncOrderInfo(orderId, r) {
  const res = await syncOrderInfoToFile(orderId, {
    customer: r.customer, productName: r.productName, specification: r.specification,
    poQuantity: r.quantity, unit: r.unit, supplier: r.supplier,
    containerNo: r.containerNo, sealNo: r.sealNo, containerLoadingDate: r.containerLoadingDate,
  }, {
    onlyFillEmpty: r.onlyFillEmpty,
    // Hồ sơ ĐÃ KHOÁ mà vẫn nhận dữ liệu từ đơn: log TÊN cột đã ghi (KHÔNG log giá trị) để truy vết ai đổi gì.
    onWrite: ({ columns, locked }) => {
      if (locked) console.log(`[gRPC] SyncOrderInfo order=${orderId} hồ sơ ĐÃ KHOÁ nhận dữ liệu từ đơn, cột đã ghi: ${columns.join(', ')}`);
    },
  });
  return { ...res, writesWhenLocked: res.fileFound };
}

// Xuất PDF bản tiếng Việt (nội bộ) của hồ sơ và trả link (PLAN-0044: checklist gửi link này cho Sale phụ trách).
// Chưa có hồ sơ cho đơn -> file_found=false (không phải lỗi). Dựng PDF đi qua hàng đợi tuần tự của renderPdf nên
// nhiều đơn cùng lúc không làm tràn RAM; lỗi dựng thành INTERNAL để checklist thử lại.
async function exportPdf(orderId) {
  const id = await repo.findIdByOrderId(orderId);
  if (!id) return { fileFound: false, pdfUrl: '' };
  const data = await exportPDF(id, 'internal');
  return { fileFound: true, pdfUrl: data.qcFile.PDF_URL || '' };
}

// Bật server. Trả về server (để tắt gọn khi shutdown) hoặc null nếu chưa cấu hình khóa.
// opts cho phép test ghi đè cổng/khóa mà không đụng biến môi trường.
export function startGrpc(opts = {}) {
  const apiKey = opts.apiKey ?? config.qcAppApiKey;
  const port = opts.port ?? config.grpcPort;
  if (!apiKey) {
    console.warn('[gRPC] QC_APP_API_KEY trống -> KHÔNG bật gRPC (tránh mở cổng không xác thực).');
    return Promise.resolve(null);
  }

  const server = new grpc.Server();
  server.addService(loadQCService().service, {
    GetStatus: rpc('GetStatus', apiKey, getStatus),
    CreateQC: rpc('CreateQC', apiKey, createQC),
    SyncOrderInfo: rpc('SyncOrderInfo', apiKey, syncOrderInfo),
    ExportPDF: rpc('ExportPDF', apiKey, exportPdf),
  });

  return new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err, boundPort) => {
      if (err) return reject(err);
      console.log(`[gRPC] QCService đang nghe ở cổng ${boundPort} (mạng riêng, plaintext)`);
      resolve(server);
    });
  });
}

export function stopGrpc(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.tryShutdown(() => resolve()));
}
