/**
 * seed-from-repo.js
 * 不靠 Supabase，直接用 repo 內的現有資料產生 D1 seed（cloudflare/seed.sql）：
 *   - 文章 metadata ← posts.json
 *   - 文章完整內文 ← post/<slug|id>/index.html 的 <!--BODY:START-->…<!--BODY:END-->
 *   - settings 留空（後台會用內建預設值；之後可在新後台重存）
 *   - site_stats.total 設為各篇 views 加總
 *
 * 用法：
 *   node cloudflare/seed-from-repo.js
 *   wrangler d1 execute operation-tw --remote --file=cloudflare/seed.sql
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BODY_RE = /<!--BODY:START-->([\s\S]*?)<!--BODY:END-->/;

function bodyFor(post) {
  try {
    const html = fs.readFileSync(
      path.join(ROOT, 'post', String(post.slug || post.id), 'index.html'), 'utf8');
    const m = html.match(BODY_RE);
    return (m && m[1]) ? m[1].trim() : '';
  } catch (_) { return ''; }
}

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
};

function rowStmts(table, cols, rows) {
  return rows.map((r) =>
    `insert into ${table} (${cols.join(',')}) values (${cols.map((c) => q(r[c])).join(',')});`
  );
}

// 文章：先 insert（不含 body），再把 body 以 ≤80KB 分段 UPDATE 串接。
// D1 單一 SQL statement 上限約 100KB，個別超長內文（如 FB 貼文）需拆段，否則 SQLITE_TOOBIG。
const META_COLS = ['id', 'title', 'category', 'date', 'status', 'excerpt', 'image', 'views', 'slug'];
function postStmts(rows, chunk = 80000) {
  const out = [];
  for (const r of rows) {
    out.push(`insert into posts (${META_COLS.join(',')}) values (${META_COLS.map((c) => q(r[c])).join(',')});`);
    const body = r.body || '';
    for (let i = 0; i < body.length; i += chunk) {
      out.push(`update posts set body = body || ${q(body.slice(i, i + chunk))} where id=${q(r.id)};`);
    }
  }
  return out;
}

// 把所有 statement 切成多個檔（每檔 < ~400KB），避免單檔超過 SQLite 的
// SQLITE_MAX_SQL_LENGTH（D1 local 會把整檔當一條 SQL 執行而觸發 SQLITE_TOOBIG）。
function writeChunks(outDir, statements, maxBytes = 400 * 1024) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  let buf = [], size = 0, idx = 0;
  const flush = () => {
    if (!buf.length) return;
    const name = String(idx).padStart(3, '0') + '.sql';
    fs.writeFileSync(path.join(outDir, name), buf.join('\n') + '\n');
    files.push(name); idx++; buf = []; size = 0;
  };
  for (const s of statements) {
    if (size + s.length > maxBytes && buf.length) flush();
    buf.push(s); size += s.length + 1;
  }
  flush();
  return files;
}

function main() {
  const posts = (JSON.parse(fs.readFileSync(path.join(ROOT, 'posts.json'), 'utf8')).posts) || [];
  console.log(`讀到 ${posts.length} 篇文章`);

  let withBody = 0;
  const rows = posts.map((p) => {
    const body = bodyFor(p);
    if (body) withBody++;
    return {
      id: p.id,
      title: p.title || '',
      category: p.category || 'AI',
      date: p.date || '',
      status: p.status || 'published',
      excerpt: p.excerpt || '',
      image: (p.image && p.image.startsWith('/')) ? p.image : '',
      body,
      views: p.views || 0,
      slug: p.slug || null,
    };
  });
  console.log(`其中 ${withBody} 篇成功帶入內文`);

  const totalViews = rows.reduce((s, r) => s + (r.views || 0), 0);

  const statements = [
    'delete from posts;', 'delete from settings;',
    'delete from site_stats;', 'delete from subscribers;',
    ...postStmts(rows),
    ...rowStmts('site_stats', ['id', 'count'], [{ id: 'total', count: totalViews }]),
  ];

  const outDir = path.join(__dirname, 'seed');
  const files = writeChunks(outDir, statements);
  console.log(`✅ 已寫出 ${files.length} 個 chunk 到 cloudflare/seed/（${rows.length} 篇文章，總瀏覽 ${totalViews}）`);
  console.log('   載入（依序，--remote 正式 / --local 測試）：');
  console.log('   for f in cloudflare/seed/*.sql; do wrangler d1 execute operation-tw --remote --file="$f"; done');
}

main();
