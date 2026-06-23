/**
 * sync-posts-json.js
 * 從 Supabase 拉取最新文章（含 views）並更新 posts.json
 * 環境變數：SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const fs = require('fs').promises;
const fsSync = require('fs');
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

  const ROOT = path.join(__dirname, '..');
  const postsJsonPath = path.join(ROOT, 'posts.json');

  // 過濾掉 data URL（舊文章可能把 base64 圖片直接存到 image 欄位，會造成 MB 級膨脹）
  const lean = posts.map(p => {
    let image = (p.image && p.image.startsWith('/')) ? p.image : '';
    // 自我修復：Supabase 沒有有效路徑、但 repo 內有對應封面檔時，補回連結。
    // 避免 sync 把「封面檔還在、但 Supabase image 欄位是空/Storage URL」的封面洗掉。
    if (!image && fsSync.existsSync(path.join(ROOT, 'images', 'posts', `post-${p.id}.jpg`))) {
      image = `/images/posts/post-${p.id}.jpg`;
    }
    return { ...p, image };
  });

  await fs.writeFile(
    postsJsonPath,
    JSON.stringify({ generated: new Date().toISOString(), posts: lean }, null, 0)
  );

  console.log(`✅ posts.json 已更新（${lean.length} 篇文章，views 已同步）`);
}

main().catch(err => {
  console.error('❌ 失敗：', err.message);
  process.exit(1);
});
