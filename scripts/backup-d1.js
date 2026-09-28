/**
 * backup-d1.js — D1 全站資料備份 / 還原解密。
 *
 * 備份（GitHub Actions 每日跑）：
 *     CF_API_BASE=... CF_SERVICE_TOKEN=... node scripts/backup-d1.js
 *   → 從 Worker /api/admin/backup 匯出 posts / settings / site_stats / subscribers，
 *     gzip + AES-256-GCM 加密後寫入 backups/d1-latest.json.gz.enc，
 *     由 workflow 上傳成 Actions artifact（不再 commit 進公開 repo）。
 *
 * 金鑰：有 BACKUP_KEY 就用它（scrypt 衍生，v2 格式）；沒有才退回 SHA-256(CF_SERVICE_TOKEN)（v1 舊格式）。
 *   BACKUP_KEY 應與 CF_SERVICE_TOKEN 分開、並另存一份在密碼管理器，否則無法在本機解密。
 *
 * 解密（災難還原時，v1/v2 自動判斷）：
 *     BACKUP_KEY=... node scripts/backup-d1.js --decrypt d1-latest.json.gz.enc > restore.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const CF_API_BASE = (process.env.CF_API_BASE || '').replace(/\/+$/, '');
const SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN || '';
const BACKUP_KEY = process.env.BACKUP_KEY || '';
const OUT = path.resolve(__dirname, '..', 'backups', 'd1-latest.json.gz.enc');

// v2 格式：'OTB2'(4B) | salt 16B | iv 12B | tag 16B | payload，金鑰 = scrypt(BACKUP_KEY, salt)
// v1 格式（舊）：iv 12B | tag 16B | payload，金鑰 = SHA-256(CF_SERVICE_TOKEN)
const MAGIC = Buffer.from('OTB2');
const v1Key = () => crypto.createHash('sha256').update(SERVICE_TOKEN).digest();

function encrypt(buf) {
  const iv = crypto.randomBytes(12);
  if (!BACKUP_KEY) {
    const c = crypto.createCipheriv('aes-256-gcm', v1Key(), iv);
    const enc = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  }
  const salt = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(BACKUP_KEY, salt, 32), iv);
  const enc = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}

function decrypt(buf) {
  let k, rest;
  if (buf.subarray(0, 4).equals(MAGIC)) {
    if (!BACKUP_KEY) throw new Error('這是 v2 備份，需要 BACKUP_KEY');
    k = crypto.scryptSync(BACKUP_KEY, buf.subarray(4, 20), 32);
    rest = buf.subarray(20);
  } else {
    k = v1Key();
    rest = buf;
  }
  const iv = rest.subarray(0, 12), tag = rest.subarray(12, 28), enc = rest.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}

async function main() {
  if (!SERVICE_TOKEN && !BACKUP_KEY) { console.error('❌ 缺 BACKUP_KEY 或 CF_SERVICE_TOKEN'); process.exit(1); }

  if (process.argv[2] === '--decrypt') {
    const file = process.argv[3];
    if (!file) { console.error('用法：node backup-d1.js --decrypt <file>'); process.exit(1); }
    process.stdout.write(zlib.gunzipSync(decrypt(fs.readFileSync(file))));
    return;
  }

  if (!CF_API_BASE || !SERVICE_TOKEN) { console.error('❌ 缺 CF_API_BASE 或 CF_SERVICE_TOKEN'); process.exit(1); }
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
  console.log(`✅ 已寫入 ${path.relative(process.cwd(), OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(0)} KB，AES-256-GCM ${BACKUP_KEY ? 'v2/BACKUP_KEY' : 'v1/CF_SERVICE_TOKEN'}）`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
