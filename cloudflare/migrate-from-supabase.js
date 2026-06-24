/**
 * migrate-from-supabase.js
 * 從 Supabase 匯出全部資料，產生可直接灌進 D1 的 SQL 檔（cloudflare/seed.sql）。
 *
 * 用法：
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node cloudflare/migrate-from-supabase.js
 * 然後：
 *   wrangler d1 execute operation-tw --remote --file=cloudflare/seed.sql
 *
 * 匯出 posts（含 body）、settings、site_stats、subscribers。
 * 用 service key 才能連草稿與訂閱名單一起搬。
 */
'use strict';

const fs = require('fs').promises;
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

// PostgREST 分頁拉全表（避免預設 1000 筆上限）
async function fetchAll(table, select = '*') {
  const out = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const to = from + step - 1;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}`, {
      headers: { ...headers, Range: `${from}-${to}`, Prefer: 'count=exact' },
    });
    if (!res.ok) throw new Error(`${table} HTTP ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < step) break;
  }
  return out;
}

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object') v = JSON.stringify(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
};

function insertStmt(table, cols, rows) {
  if (!rows.length) return `-- ${table}: 無資料\n`;
  const lines = rows.map((r) => `(${cols.map((c) => q(r[c])).join(',')})`);
  return `insert into ${table} (${cols.join(',')}) values\n${lines.join(',\n')};\n`;
}

async function main() {
  console.log('🔄 從 Supabase 匯出…');

  const posts = await fetchAll('posts', 'id,title,category,date,status,excerpt,image,body,views,slug,created_at');
  console.log(`  posts: ${posts.length}`);
  const settings = await fetchAll('settings', 'key,value');
  console.log(`  settings: ${settings.length}`);
  const stats = await fetchAll('site_stats', 'id,count,updated_at');
  console.log(`  site_stats: ${stats.length}`);
  let subs = [];
  try { subs = await fetchAll('subscribers', 'id,email,source,created_at'); } catch (_) {}
  console.log(`  subscribers: ${subs.length}`);

  let sql = '-- operation.tw seed（由 migrate-from-supabase.js 產生）\n';
  sql += 'PRAGMA foreign_keys=OFF;\n';
  sql += 'delete from posts;\ndelete from settings;\ndelete from site_stats;\ndelete from subscribers;\n\n';

  sql += insertStmt('posts',
    ['id', 'title', 'category', 'date', 'status', 'excerpt', 'image', 'body', 'views', 'slug', 'created_at'],
    posts) + '\n';
  // settings.value 在 Supabase 是 jsonb → 轉成字串存進 D1 的 text 欄位
  sql += insertStmt('settings', ['key', 'value'],
    settings.map((s) => ({ key: s.key, value: typeof s.value === 'string' ? s.value : JSON.stringify(s.value) }))) + '\n';
  sql += insertStmt('site_stats', ['id', 'count', 'updated_at'], stats) + '\n';
  sql += insertStmt('subscribers', ['id', 'email', 'source', 'created_at'], subs) + '\n';

  const outPath = path.join(__dirname, 'seed.sql');
  await fs.writeFile(outPath, sql);
  console.log(`✅ 已寫出 ${outPath}（${posts.length} 篇文章）`);
  console.log('   接著執行：wrangler d1 execute operation-tw --remote --file=cloudflare/seed.sql');
}

main().catch((e) => { console.error('❌ 失敗：', e.message); process.exit(1); });
