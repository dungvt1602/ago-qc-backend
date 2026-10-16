// Bản PDF mà gRPC ExportPDF được phép xuất (hợp đồng: proto/qc/v1/qc.proto, ExportPDFRequest.variant).
//   ""/"internal" = bản nội bộ song ngữ (hành vi cũ, mặc định — client cũ không gửi trường này nên luôn ra bản này)
//   "en"          = bản KHÁCH HÀNG tiếng Anh (checklist xin bản này để Sale chuyển tiếp cho khách, PLAN-0049)
// Giá trị khác => INVALID_ARGUMENT, KHÔNG âm thầm rơi về bản nội bộ: gõ nhầm "EN"/"vi" mà trả nhầm file nội bộ thì
// file nội bộ (có giá nội bộ, ghi chú xưởng) có thể bị gửi ra cho khách.
import grpc from '@grpc/grpc-js';

export class InvalidPdfVariantError extends Error {
  constructor() {
    // Câu CỐ ĐỊNH, không in lại giá trị gửi sang (expose=true cho phép rpc() trả nguyên câu này cho client).
    super('variant phải là "", "internal" hoặc "en"');
    this.name = 'InvalidPdfVariantError';
    this.grpcCode = grpc.status.INVALID_ARGUMENT;
    this.expose = true;
  }
}

export function normalizePdfVariant(variant) {
  if (variant === undefined || variant === null || variant === '' || variant === 'internal') return 'internal';
  if (variant === 'en') return 'en';
  throw new InvalidPdfVariantError();
}
