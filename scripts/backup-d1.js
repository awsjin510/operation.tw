/**
 * backup-d1.js — D1 全站資料備份 / 還原解密。
 *
 * 備份（GitHub Actions 每日跑）：
 *     CF_API_BASE=... CF_SERVICE_TOKEN=... node scripts/backup-d1.js
 *   → 從 Worker /api/admin/backup 匯出 posts / settings / site_stats / subscribers，
 *     gzip + AES-256-GCM 加密（金鑰＝SHA-256(CF_SERVICE_TOKEN)）後寫入
 *     backups/d1-latest.json.gz.enc（repo 是公開的，訂閱者 email 不可明文入庫）。
 *
 * 解密（災難還原時）：
 *     CF_SERVICE_TOKEN=... node scripts/backup-d1.js --decrypt backups/d1-latest.json.gz.enc > restore.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const CF_API_BASE = (process.env.CF_API_BASE || '').replace(/\/+$/, '');
const SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN || '';
const OUT = path.resolve(__dirname, '..', 'backups', 'd1-latest.json.gz.enc');

const key = () => crypto.createHash('sha256').update(SERVICE_TOKEN).digest();

function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]); // 12B iv | 16B tag | payload
}

function decrypt(buf) {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

async function main() {
  if (!SERVICE_TOKEN) { console.error('❌ 缺 CF_SERVICE_TOKEN'); process.exit(1); }

  if (process.argv[2] === '--decrypt') {
    const file = process.argv[3];
    if (!file) { console.error('用法：node backup-d1.js --decrypt <file>'); process.exit(1); }
    process.stdout.write(zlib.gunzipSync(decrypt(fs.readFileSync(file))));
    return;
  }

  if (!CF_API_BASE) { console.error('❌ 缺 CF_API_BASE'); process.exit(1); }
  const res = await fetch(`${CF_API_BASE}/api/admin/backup`, {
    headers: { Authorization: `Bearer ${SERVICE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`備份端點失敗 (HTTP ${res.status}): ${await res.text()}`);
  const data = await res.json();

  const counts = ['posts', 'settings', 'site_stats', 'subscribers']
    .map((k) => `${k}=${(data[k] || []).length}`).join(' ');
  console.log(`📦 匯出：${counts}`);
  if (!(data.posts || []).length) throw new Error('posts 為空，拒絕覆寫既有備份（疑似 API 異常）');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, encrypt(zlib.gzipSync(JSON.stringify(data))));
  console.log(`✅ 已寫入 ${path.relative(process.cwd(), OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(0)} KB，AES-256-GCM）`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
