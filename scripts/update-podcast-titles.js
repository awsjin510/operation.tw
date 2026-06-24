/**
 * update-podcast-titles.js
 * 把「由 Podcast 單集生成的文章」標題前面補上對應的 EP 集數碼（例如 EP54、AI33）。
 *
 * 對應方式：
 *   podcast-posts.json (guid → postId)  ×  RSS (guid → 帶 EP 碼的單集標題)
 *   → 從單集標題開頭抓出集數碼，prepend 到文章標題。
 *
 * 安全設計：
 *   - 只動「已產文（postId > 0）」且能對到集數碼的文章。
 *   - 已經有正確前綴的標題會跳過（可重複執行，idempotent）。
 *   - DRY_RUN=1 只印出將要怎麼改，不寫 Supabase。
 *
 * 環境變數：SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
'use strict';

const Parser = require('rss-parser');
const path = require('path');
const fs = require('fs').promises;

const cfdb = require('./lib/cf-db');
const CF_API_BASE = process.env.CF_API_BASE;
const CF_SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN;
const DRY_RUN = process.env.DRY_RUN === '1';
const SEP = '｜'; // 集數碼與標題之間的分隔符

const RSS_URL = 'https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml';
const STATE_PATH = path.join(__dirname, '..', 'podcast-posts.json');
const POSTS_JSON_PATH = path.join(__dirname, '..', 'posts.json');

if (!DRY_RUN && (!CF_API_BASE || !CF_SERVICE_TOKEN)) {
  console.error('❌ 缺少 CF_API_BASE 或 CF_SERVICE_TOKEN');
  process.exit(1);
}

// 從單集標題開頭抓集數碼：英數開頭（EP54 / AI33 / EP01…），後面接分隔符。
function episodeCode(title) {
  const m = (title || '').trim().match(/^([A-Za-z]{1,6}\d{1,4})\s*[_|｜\-:：．.]/);
  return m ? m[1].toUpperCase() : '';
}

function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function main() {
  console.log(`\n🏷  更新文章標題的 EP 集數 ${DRY_RUN ? '(DRY RUN)' : ''}\n`);

  // 1. RSS：guid → 集數碼
  const parser = new Parser({ timeout: 20000 });
  const feed = await parser.parseURL(RSS_URL);
  const guidToCode = {};
  for (const item of feed.items) {
    const guid = item.guid || item.id || item.link || item.title;
    guidToCode[guid] = episodeCode(item.title);
  }
  console.log(`  ✓ RSS 取得 ${feed.items.length} 集`);

  // 2. 狀態檔：guid → postId
  const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8')).processed || {};

  // 3. posts.json：id → 現有標題
  const posts = JSON.parse(await fs.readFile(POSTS_JSON_PATH, 'utf8')).posts || [];
  const idToTitle = {};
  for (const p of posts) idToTitle[p.id] = p.title;

  let updated = 0, skipped = 0, missing = 0;
  const newTitleById = {}; // postId → 新標題（成功更新的）
  for (const [guid, postId] of Object.entries(state)) {
    if (!(typeof postId === 'number' && postId > 0)) continue;
    const code = guidToCode[guid];
    const cur = idToTitle[postId];
    if (!code || !cur) { missing++; continue; }
    // 已經有這個前綴 → 跳過（可重複執行）
    if (cur.startsWith(code + SEP) || cur.startsWith(code + '｜') || cur.startsWith(code + '|')) {
      skipped++;
      continue;
    }
    const next = `${code}${SEP}${cur}`;
    if (DRY_RUN) {
      console.log(`  [DRY] #${postId}  ${cur}  →  ${next}`);
      updated++;
      continue;
    }
    try {
      await cfdb.updatePost(postId, { title: next });
    } catch (err) {
      console.warn(`  ✗ #${postId} 更新失敗：${err.message}`);
      continue;
    }
    console.log(`  ✓ #${postId} → ${next}`);
    newTitleById[postId] = next;
    updated++;
  }

  // 直接把成功的標題寫回 posts.json（不依賴可能 timeout 的 sync-posts-json）。
  if (!DRY_RUN && Object.keys(newTitleById).length) {
    const raw = JSON.parse(await fs.readFile(POSTS_JSON_PATH, 'utf8'));
    for (const p of raw.posts || []) {
      if (newTitleById[p.id]) p.title = newTitleById[p.id];
    }
    raw.generated = new Date().toISOString();
    await fs.writeFile(POSTS_JSON_PATH, JSON.stringify(raw, null, 0));
    console.log(`  ✓ 已直接更新 posts.json（${Object.keys(newTitleById).length} 篇標題）`);
  }

  console.log(`\n✅ 完成：${DRY_RUN ? '將更新' : '已更新'} ${updated} 篇，跳過（已有前綴）${skipped} 篇，無對應 ${missing} 篇`);
}

main().catch((err) => {
  console.error('\n❌ update-podcast-titles 失敗：', err.message);
  process.exit(1);
});
