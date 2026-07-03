/**
 * fix-listen-links.js — 修正既有文章的收聽連結（一次性、冪等）。
 * 問題：文末「在 Apple Podcast 收聽這集」實際連到 SoundOn（RSS item.link）。
 * 修法：該連結改標籤為「在 SoundOn 收聽這集」，並在其前補一個真正的
 *       Apple Podcast 節目連結。已修過的文章（標籤已不存在）自動跳過。
 *
 * 環境變數：CF_API_BASE、CF_SERVICE_TOKEN
 */
'use strict';

const cfdb = require('./lib/cf-db');

const APPLE_SHOW_URL = 'https://podcasts.apple.com/podcast/1620760720';
const RE = /<li><a href="([^"]+)"([^>]*)>在 Apple Podcast 收聽這集<\/a><\/li>/g;

async function main() {
  console.log('\n🔗 修正收聽連結（Apple 標籤 → 實際目的地）\n');
  const posts = await cfdb.getAllPostsWithBody();
  let fixed = 0;
  for (const p of posts) {
    if (!p.body || !p.body.includes('在 Apple Podcast 收聽這集')) continue;
    const body = p.body.replace(RE, (m, href, attrs) =>
      `<li><a href="${APPLE_SHOW_URL}"${attrs}>在 Apple Podcast 收聽</a></li>\n` +
      `<li><a href="${href}"${attrs}>在 SoundOn 收聽這集</a></li>`
    );
    if (body === p.body) { console.log(`  ⚠ #${p.id} 樣式不符，略過`); continue; }
    await cfdb.updatePost(p.id, { body });
    fixed++;
    if (fixed % 25 === 0) console.log(`  …已修 ${fixed} 篇`);
  }
  console.log(`\n✅ 完成，共修正 ${fixed} 篇`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
