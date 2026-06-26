/**
 * sync-posts-json.js
 * 從 Cloudflare Worker 拉取最新已發布文章（含 views）並更新 posts.json。
 * 環境變數：CF_API_BASE（+ 後台寫入相關 token 非必需，這裡只讀公開清單）
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cfdb = require('./lib/cf-db');

async function main() {
  console.log('🔄 同步 posts.json（含最新 views）...\n');

  const posts = await cfdb.getPublishedPosts();
  console.log(`  ✓ 取得 ${posts.length} 篇文章`);

  const ROOT = path.join(__dirname, '..');
  const postsJsonPath = path.join(ROOT, 'posts.json');

  // 過濾掉非 / 開頭的 image（舊資料可能存 data URL 或 Storage URL，會造成膨脹）；
  // 自我修復：image 欄位空、但 repo 內有對應封面檔時補回連結。
  const lean = posts.map((p) => {
    let image = (p.image && p.image.startsWith('/')) ? p.image : '';
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

main().catch((err) => {
  console.error('❌ 失敗：', err.message);
  process.exit(1);
});
