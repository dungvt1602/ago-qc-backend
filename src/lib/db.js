// Tầng kết nối PostgreSQL.
// Dùng Pool để TÁI DÙNG kết nối — không mở/đóng mỗi request (giảm độ trễ).
import pg from 'pg';
import { config } from '../config/env.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: { rejectUnauthorized: false }, // Supabase bắt buộc SSL
  max: 10, // tối đa 10 kết nối song song
});

// Chạy 1 câu SQL, trả về MẢNG dòng.
export async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// Chạy 1 câu SQL, trả về MỘT dòng (hoặc null).
export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// Gói nhiều lệnh trong 1 transaction: hoặc thành công hết, hoặc rollback hết.
// LƯU Ý: các lệnh trong cùng transaction phải chạy TUẦN TỰ (không Promise.all trên cùng 1 client).
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
