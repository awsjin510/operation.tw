/**
 * sync-posts-json.js
 * 從 Supabase 拉取最新文章（含 views）並更新 posts.json
 * 環境變數：SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const fs = require('fs').promises;
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPosts(attempt) {
  const url = `${SUPABASE_URL}/rest/v1/posts?select=id,title,category,date,status,excerpt,image,views&status=eq.published&order=date.desc`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        // 給 Supabase 足夠的 statement timeout 空間
        'x-use-statement-timeout': '20000',
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log('🔄 同步 posts.json（含最新 views）...\n');

  let posts;
  for (let i = 1; i <= 4; i++) {
    try {
      posts = await fetchPosts(i);
      console.log(`  ✓ Supabase 回應（第 ${i} 次嘗試），取得 ${posts.length} 篇文章`);
      break;
    } catch (err) {
      console.warn(`  ⚠ 第 ${i} 次嘗試失敗：${err.message}`);
      if (i === 4) throw err;
      const wait = i * 5000;
      console.log(`  ⏳ 等待 ${wait / 1000}s 後重試（Supabase 可能正在喚醒）...`);
      await sleep(wait);
    }
  }

  const postsJsonPath = path.join(__dirname, '..', 'posts.json');

  // 保留既有的 body 欄位（auto-post 會帶 body，這裡不覆蓋）
  let existingBodies = {};
  try {
    const existing = JSON.parse(await fs.readFile(postsJsonPath, 'utf8'));
    existingBodies = Object.fromEntries(
      (existing.posts || []).filter(p => p.body).map(p => [p.id, p.body])
    );
  } catch (_) {}

  const merged = posts.map(p => ({
    ...p,
    ...(existingBodies[p.id] ? { body: existingBodies[p.id] } : {}),
  }));

  await fs.writeFile(
    postsJsonPath,
    JSON.stringify({ generated: new Date().toISOString(), posts: merged }, null, 0)
  );

  console.log(`✅ posts.json 已更新（${merged.length} 篇文章，views 已同步）`);
}

main().catch(err => {
  console.error('❌ 失敗：', err.message);
  process.exit(1);
});
