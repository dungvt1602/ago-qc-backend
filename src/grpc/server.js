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
import { findOrCreateForOrder } from '../services/qcFiles.service.js';

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
      console.error(`[gRPC] ${name} order=${orderId} LỖI:`, err);
      callback({ code: grpc.status.INTERNAL, details: 'lỗi nội bộ App QC' });
    }
  };
}

// Đơn chưa có hồ sơ -> {0,false} chứ KHÔNG báo NOT_FOUND (theo hợp đồng: checklist hiểu là "chưa bắt đầu").
async function getStatus(orderId) {
  const row = await repo.getOrderStatus(orderId);
  if (!row) return { photoCount: 0, done: false };
  return { photoCount: Number(row.photo_count) || 0, done: Boolean(row.done) };
}

async function createQC(orderId, r) {
  const { qcFile, created } = await findOrCreateForOrder({
    orderId,
    poNo: r.poNo, productName: r.productName, specification: r.specification,
    poQuantity: r.quantity, unit: r.unit, customer: r.customer, contractNo: r.contractNo,
  });
  return { qcFileId: qcFile.ID, lotCode: qcFile.LOT_CODE, created };
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
