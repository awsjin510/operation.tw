/**
 * backfill-photo-covers.js — 把既有「新聞自動文」的 SVG 範本封面回填成 Pexels 真實示意圖。
 *
 * 範圍：非 Podcast 文（標題無集數碼）、封面是自動生成路徑 /images/posts/post-<id>.jpg、
 *       且尚未換過照片（不在 pexels-used.json）。由新到舊最多處理 LIMIT 篇。
 * 流程：一次 Claude 呼叫為所有目標文章產生英文搜尋詞 → 逐篇搜 Pexels 下載覆寫。
 * 圖片路徑不變，所以不需要動資料庫；workflow 會重建靜態頁（WebP 重產）後 commit。
 *
 * 環境變數：CF_API_BASE、CF_SERVICE_TOKEN、ANTHROPIC_API_KEY、PEXELS_API_KEY、
 *           LIMIT（預設 30）、DRY_RUN（'true' 時只列出目標文章，不呼叫 API）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const cfdb = require('./lib/cf-db');
const { fetchPhotoCover, CATEGORY_QUERIES } = require('./lib/photo-cover');
const { episodeCode } = require('./podcast-to-post');

const LIMIT = Math.max(1, parseInt(process.env.LIMIT || '30', 10) || 30);
const DRY_RUN = process.env.DRY_RUN === 'true';
const USED_PATH = path.join(__dirname, '..', 'images', 'posts', 'pexels-used.json');

function loadUsed() {
  try { return JSON.parse(fs.readFileSync(USED_PATH, 'utf8')); } catch { return {}; }
}

async function generateQueries(targets) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const list = targets.map((p) => `${p.id}|${p.category}|${p.title}|${(p.excerpt || '').slice(0, 60)}`).join('\n');
  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `以下是科技部落格文章清單（格式 id|分類|標題|摘要）：

${list}

請為每篇文章想一個「圖庫搜尋詞」：3-5 個英文單字，描述適合當該文封面的具象畫面（例：smartphone chip closeup、data center server racks、hacker typing laptop）。要挑 Pexels 這類圖庫真的搜得到的常見畫面，避免抽象概念詞與品牌名。

以純 JSON 陣列回傳（不要 Markdown 圍欄、不要多餘文字）：
[{"id": 123, "query": "..."}]`,
    }],
  });
  if (resp.stop_reason === 'max_tokens') throw new Error('回應被截斷，請降低 LIMIT');
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = text.trim().match(/\[[\s\S]*\]/);
  if (!m) throw new Error('搜尋詞回應格式錯誤：' + text.slice(0, 200));
  const map = {};
  for (const it of JSON.parse(m[0])) if (it && it.id && it.query) map[it.id] = String(it.query);
  return map;
}

async function main() {
  console.log(`\n🖼 回填真實示意圖封面（上限 ${LIMIT} 篇${DRY_RUN ? '、DRY RUN' : ''}）\n`);
  const posts = await cfdb.getPublishedPosts();
  const used = loadUsed();

  const targets = posts
    .filter((p) => !episodeCode(p.title))                                  // 排除 Podcast 文（用單集封面）
    .filter((p) => (p.image || '') === `/images/posts/post-${p.id}.jpg`)   // 只動自動生成封面
    .filter((p) => !used[String(p.id)])                                    // 換過照片的不重複處理
    .sort((a, b) => b.id - a.id)
    .slice(0, LIMIT);

  console.log(`  ✓ 目標 ${targets.length} 篇（全站 ${posts.length} 篇）`);
  if (!targets.length) { console.log('✅ 沒有需要回填的文章'); return; }

  if (DRY_RUN) {
    for (const p of targets) console.log(`  - #${p.id} [${p.category}] ${p.title}`);
    console.log('\n✅ DRY RUN 結束（未呼叫任何 API）');
    return;
  }
  if (!process.env.PEXELS_API_KEY) throw new Error('缺 PEXELS_API_KEY');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('缺 ANTHROPIC_API_KEY');

  console.log('\n  產生搜尋詞（Claude Haiku，一次呼叫）...');
  const queries = await generateQueries(targets);

  let ok = 0, fail = 0;
  for (const p of targets) {
    console.log(`\n#${p.id} [${p.category}] ${p.title.slice(0, 30)}`);
    const got = await fetchPhotoCover(p.id, queries[p.id], CATEGORY_QUERIES[p.category]);
    if (got) ok++; else { fail++; console.warn('  ⚠ 找不到合適照片，保留原範本封面'); }
  }
  console.log(`\n✅ 完成：更換 ${ok} 張${fail ? `、失敗 ${fail} 張（保留原圖）` : ''}`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
