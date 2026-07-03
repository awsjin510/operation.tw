/**
 * restore-content.js — 修復 6/30 D1 被舊 seed 重灌造成的資料損失。
 *
 * 做四件事（全部冪等，可重複執行）：
 *   1. 把被刪除的 289-295 七篇文章塞回 D1（資料來自 restore/posts-289-295.json，
 *      由 git 歷史還原；已存在的 id 會跳過）
 *   2. 刪除重複發布的 Podcast 文章（同集數碼保留最小 id，例：AI37 留 296 刪 297）
 *   3. 重建 podcast-posts.json state（用 RSS guid ↔ 文章標題集數碼配對），
 *      避免每天重複發文
 *   4. 補產遺失的封面圖檔（posts.json 有路徑但檔案不存在：Podcast 用單集 artwork、
 *      新聞文用 SVG 模板）
 *
 * 環境變數：CF_API_BASE、CF_SERVICE_TOKEN
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cfdb = require('./lib/cf-db');
const { episodeCode, fetchEpisodes, saveCoverFromArt, STATE_PATH } = require('./podcast-to-post');
const { generateCoverImage } = require('./auto-post');

const RESTORE_FILE = path.join(__dirname, '..', 'restore', 'posts-289-295.json');
const IMG_DIR = path.join(__dirname, '..', 'images', 'posts');

async function main() {
  console.log('\n🚑 修復 D1 內容\n');
  const existing = await cfdb.getAllPostsWithBody();
  const existingIds = new Set(existing.map((p) => p.id));

  // ── 1. 對帳式還原：讓 289-295 以「原本的 id」存在 ────────
  // 前一版還原因舊 Worker 不支援指定 id，內容被塞到 299+ 的新 id（舊網址 404），
  // 且其中一篇被誤判重複刪除。這裡逐篇對帳：
  //   - 正確 id 已存在 → 跳過
  //   - 同標題但 id 不對（299+ 那批）→ 刪掉錯誤的那筆，再以正確 id 重建
  const { posts: restorePosts } = JSON.parse(fs.readFileSync(RESTORE_FILE, 'utf8'));
  let restored = 0, deduped = 0;
  for (const p of restorePosts) {
    if (existingIds.has(p.id)) { console.log(`  ↪ #${p.id} 已存在，跳過`); continue; }
    const wrongIds = existing.filter((e) => e.title === p.title && e.id !== p.id);
    for (const w of wrongIds) {
      await cfdb.deletePost(w.id);
      console.log(`  ✓ 刪除錯誤 id 的同名文章 #${w.id}（${p.title.slice(0, 24)}）`);
      deduped++;
    }
    const created = await cfdb.createPost(p);
    if (!created || created.id !== p.id) {
      // Worker 尚未部署「支援指定 id」的版本 → 收拾乾淨並中止，避免再塞出新 id
      if (created && created.id) await cfdb.deletePost(created.id);
      throw new Error(`Worker 不支援指定 id（回傳 ${created && created.id}）。請先跑 Deploy Cloudflare（reseed=false）再重跑本 workflow。`);
    }
    console.log(`  ✓ 還原 #${p.id} ${p.title.slice(0, 30)}`);
    restored++;
  }

  // ── 3. 重建 podcast state（RSS guid ↔ 集數碼）───────────
  const final = (restored || deduped) ? await cfdb.getAllPostsWithBody() : existing;
  const codeToId = {};
  for (const p of final) {
    const code = episodeCode(p.title);
    if (code && !(code in codeToId)) codeToId[code] = p.id;
    else if (code) codeToId[code] = Math.min(codeToId[code], p.id);
  }
  const episodes = await fetchEpisodes();
  const processed = {};
  let matched = 0;
  for (const ep of episodes) {
    const code = episodeCode(ep.title);
    if (code && codeToId[code]) { processed[ep.guid] = codeToId[code]; matched++; }
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify({ generated: new Date().toISOString(), processed }, null, 2));
  console.log(`  ✓ state 重建：${matched}/${episodes.length} 集已配對（${path.basename(STATE_PATH)}）`);

  // ── 4. 補產遺失的封面 ───────────────────────────────────
  let covers = 0;
  for (const p of final) {
    if (!p.image || !p.image.startsWith('/images/posts/')) continue;
    const file = path.join(IMG_DIR, path.basename(p.image));
    if (fs.existsSync(file)) continue;
    const code = episodeCode(p.title);
    let made = '';
    if (code) {
      const ep = episodes.find((e) => episodeCode(e.title) === code);
      if (ep && ep.art) made = await saveCoverFromArt(p.id, ep.art);
    }
    if (!made) made = await generateCoverImage(p.id, p.category); // 新聞文/後備：SVG 模板
    if (made && made !== p.image) await cfdb.updatePost(p.id, { image: made });
    console.log(`  ✓ 補封面 #${p.id} → ${made}`);
    covers++;
  }

  console.log(`\n✅ 完成：還原 ${restored} 篇、去重 ${deduped} 篇、補封面 ${covers} 張`);
}

main().catch((err) => { console.error('❌ 修復失敗：', err.message); process.exit(1); });
