/**
 * regen-covers.js — 用新版合成參數重生「Podcast 文章」封面。
 * 從 RSS 取各單集 artwork，依集數碼配對文章，覆寫 images/posts/post-<id>.jpg，
 * 並刪除對應舊 .webp（build-static 會自動重產）。冪等、只動 Podcast 文。
 *
 * 環境變數：CF_API_BASE、CF_SERVICE_TOKEN
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cfdb = require('./lib/cf-db');
const { episodeCode, fetchEpisodes, saveCoverFromArt } = require('./podcast-to-post');

const IMG_DIR = path.join(__dirname, '..', 'images', 'posts');

async function main() {
  console.log('\n🎨 重生 Podcast 封面（新版合成）\n');
  const posts = await cfdb.getPublishedPosts();
  const episodes = await fetchEpisodes();
  const artByCode = {};
  for (const ep of episodes) {
    const code = episodeCode(ep.title);
    if (code && ep.art && !artByCode[code]) artByCode[code] = ep.art;
  }

  let done = 0, skip = 0;
  for (const p of posts) {
    const code = episodeCode(p.title);
    if (!code || !artByCode[code]) { continue; }
    const made = await saveCoverFromArt(p.id, artByCode[code]);
    if (!made) { skip++; continue; }
    const webp = path.join(IMG_DIR, `post-${p.id}.webp`);
    if (fs.existsSync(webp)) fs.unlinkSync(webp); // 舊 webp 作廢，build-static 會重產
    console.log(`  ✓ #${p.id} ${code} ${p.title.slice(0, 26)}`);
    done++;
  }
  console.log(`\n✅ 完成：重生 ${done} 張${skip ? `、失敗 ${skip} 張（保留舊圖）` : ''}`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
