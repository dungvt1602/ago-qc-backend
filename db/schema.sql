-- AGO QC App - Schema PostgreSQL (chạy 1 lần trong Supabase SQL Editor)
-- 7 bảng thay cho 7 sheet cũ, có quan hệ khóa ngoại và ràng buộc.

-- Bảng chính: hồ sơ QC
CREATE TABLE IF NOT EXISTS qc_files (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_file_no             TEXT,
  lot_code               TEXT,
  contract_no            TEXT,
  po_no                  TEXT,
  production_order       TEXT,
  standard_appendix      TEXT,
  product_name           TEXT,
  specification          TEXT,
  supplier               TEXT,
  supplier_code          TEXT,
  po_quantity            TEXT,
  unit                   TEXT,
  start_date             DATE,
  est_finish_date        DATE,
  total_production_days  INT  DEFAULT 0,
  total_warehouses       INT  DEFAULT 0,
  container_no           TEXT,
  seal_no                TEXT,
  container_loading_date DATE,
  qc_staff               TEXT,
  qc_type                TEXT DEFAULT 'IMPORT',
  status                 TEXT DEFAULT 'DRAFT',
  pdf_url                TEXT,
  pdf_url_customer       TEXT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now()
);

-- Thống kê (1-1 với qc_files)
CREATE TABLE IF NOT EXISTS summaries (
  qc_file_id                  UUID PRIMARY KEY REFERENCES qc_files(id) ON DELETE CASCADE,
  produced_qty                TEXT,
  pending_production_qty      TEXT,
  total_passed_finished_goods TEXT,
  cumulative_pass_rate        TEXT,
  total_failed_pending        TEXT,
  cumulative_fail_rate        TEXT,
  total_delivered             TEXT,
  total_stock_on_hand         TEXT,
  difference_to_resolve       TEXT,
  handling_action             TEXT,
  fail_reason                 TEXT,
  updated_at                  TIMESTAMPTZ DEFAULT now()
);

-- Phiên QC theo ngày/kho
CREATE TABLE IF NOT EXISTS daily_qc (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_file_id  UUID REFERENCES qc_files(id) ON DELETE CASCADE,
  lot_code    TEXT,
  qc_date     DATE,
  warehouse   TEXT,
  qc_staff    TEXT,
  status      TEXT DEFAULT 'DRAFT',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Hạng mục trong 1 phiên QC ngày (6 mục)
CREATE TABLE IF NOT EXISTS daily_qc_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  daily_qc_id   UUID REFERENCES daily_qc(id) ON DELETE CASCADE,
  qc_file_id    UUID REFERENCES qc_files(id) ON DELETE CASCADE,
  item_code     TEXT,
  item_name_vi  TEXT,
  item_name_en  TEXT,
  pass_rate     TEXT,
  fail_rate     TEXT,
  remarks       TEXT,
  photo_url     TEXT,
  photo_path    TEXT,
  captured_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (daily_qc_id, item_code)
);

-- Ảnh container (21 mục)
CREATE TABLE IF NOT EXISTS container_photos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qc_file_id      UUID REFERENCES qc_files(id) ON DELETE CASCADE,
  lot_code        TEXT,
  photo_no        INT,
  item_code       TEXT,
  item_name_vi    TEXT,
  item_name_en    TEXT,
  description_vi  TEXT,
  description_en  TEXT,
  pass_rate       TEXT,
  fail_rate       TEXT,
  remarks         TEXT,
  photo_url       TEXT,
  photo_path      TEXT,
  captured_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (qc_file_id, photo_no)
);

-- Cấu hình công ty (hiện trên PDF)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT,
  note  TEXT
);

-- Nhật ký thao tác (tùy chọn, để mở rộng sau)
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action      TEXT,
  qc_file_id  UUID,
  target_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Index tăng tốc truy vấn theo hồ sơ
CREATE INDEX IF NOT EXISTS idx_daily_qc_file    ON daily_qc(qc_file_id);
CREATE INDEX IF NOT EXISTS idx_daily_items_file ON daily_qc_items(qc_file_id);
CREATE INDEX IF NOT EXISTS idx_container_file   ON container_photos(qc_file_id);

-- Cấu hình ban đầu
INSERT INTO settings (key, value, note) VALUES
  ('COMPANY_NAME', 'AGO IMPORT EXPORT CO., LTD', 'Tên công ty trên PDF'),
  ('ADDRESS',      '50 Street No 5, Linh Xuan Ward, Ho Chi Minh City', 'Địa chỉ'),
  ('WEBSITE',      'agoexim.com', 'Website'),
  ('EMAIL',        'info@agoexim.com', 'Email')
ON CONFLICT (key) DO NOTHING;
