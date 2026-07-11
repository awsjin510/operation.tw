/**
 * photo-cover.js — 從 Pexels 免費圖庫搜尋「與文章內容相關」的示意圖當封面。
 * 授權：Pexels License（免費商用、毋須署名、可修改）。
 *
 * 用法：fetchPhotoCover(postId, query, fallbackQuery) → '/images/posts/post-<id>.jpg' 或 null
 * 未設 PEXELS_API_KEY、搜不到圖或下載失敗時回傳 null，呼叫端應 fallback 至 SVG 範本封面。
 *
 * pexels-used.json 記錄每篇文章用掉的照片 id，避免不同文章撞同一張圖（冪等：
 * 同一篇重跑會沿用已記錄的照片）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = process.env.PEXELS_API_KEY;
const IMG_DIR = path.join(__dirname, '..', '..', 'images', 'posts');
const USED_PATH = path.join(IMG_DIR, 'pexels-used.json');

function loadUsed() {
  try { return JSON.parse(fs.readFileSync(USED_PATH, 'utf8')); } catch { return {}; }
}
function saveUsed(map) {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.writeFileSync(USED_PATH, JSON.stringify(map, null, 0));
}

function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function searchPhotos(query) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=landscape&size=large&per_page=15`;
  const res = await fetchWithTimeout(url, { headers: { Authorization: API_KEY } });
  if (!res.ok) throw new Error(`Pexels API ${res.status}`);
  const data = await res.json();
  return data.photos || [];
}

// 底部漸層 + 站名浮水印，讓真實照片與全站深色視覺保持一致
function brandOverlay() {
  return Buffer.from(`<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
<stop offset="55%" stop-color="#050510" stop-opacity="0"/>
<stop offset="100%" stop-color="#050510" stop-opacity="0.82"/>
</linearGradient></defs>
<rect width="1200" height="630" fill="url(#fade)"/>
<text x="60" y="585" font-family="monospace" font-size="24" fill="#ffffff" opacity="0.85" letter-spacing="2">operation.tw</text>
</svg>`);
}

/**
 * 搜圖 → 下載 → 裁 1200x630 + 品牌壓字 → 存 images/posts/post-<id>.jpg。
 * 依序嘗試 query、fallbackQuery；全部失敗回傳 null。
 */
async function fetchPhotoCover(postId, query, fallbackQuery) {
  if (!API_KEY) { console.log('  ⚠ 未設定 PEXELS_API_KEY，改用範本封面'); return null; }
  const used = loadUsed();
  const usedIds = new Set(Object.values(used));

  for (const q of [query, fallbackQuery].filter(Boolean)) {
    let photos;
    try { photos = await searchPhotos(q); }
    catch (e) { console.warn(`  ⚠ Pexels 搜尋失敗（${q}）：${e.message}`); continue; }

    // 冪等：同一篇重跑優先沿用已記錄的照片；否則挑第一張還沒被其他文章用過的
    const prevId = used[String(postId)];
    const pick = photos.find((p) => p.id === prevId)
      || photos.find((p) => !usedIds.has(p.id))
      || photos[0];
    if (!pick) continue;

    try {
      const src = pick.src.landscape || pick.src.large2x || pick.src.original;
      const res = await fetchWithTimeout(src);
      if (!res.ok) throw new Error(`下載 ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      fs.mkdirSync(IMG_DIR, { recursive: true });
      const out = path.join(IMG_DIR, `post-${postId}.jpg`);
      await sharp(buf)
        .resize(1200, 630, { fit: 'cover' })
        .composite([{ input: brandOverlay() }])
        .jpeg({ quality: 82 })
        .toFile(out);
      const webp = path.join(IMG_DIR, `post-${postId}.webp`);
      if (fs.existsSync(webp)) fs.unlinkSync(webp); // 舊 webp 作廢，build-static 會重產

      used[String(postId)] = pick.id;
      saveUsed(used);
      console.log(`  ✓ Pexels #${pick.id}「${q}」by ${pick.photographer}`);
      return `/images/posts/post-${postId}.jpg`;
    } catch (e) {
      console.warn(`  ⚠ 圖片處理失敗（${q}）：${e.message}`);
    }
  }
  return null;
}

// 各分類的保底搜尋詞（cover_query 沒中時退用）
const CATEGORY_QUERIES = {
  'AI': 'artificial intelligence technology circuit',
  '雲端': 'cloud computing data center servers',
  '資安': 'cybersecurity hacker code screen',
  '閱讀': 'open book reading library',
  '成長': 'sunrise mountain climbing achievement',
};

module.exports = { fetchPhotoCover, CATEGORY_QUERIES };
