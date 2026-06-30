/**
 * backfill-faq.js
 * 為「還沒有常見問題/重點整理」的舊文，用 Claude 補上「答案先行 TL;DR + 文末 FAQ」，
 * 更新到 Cloudflare D1。之後 build-static 會自動產生 FAQPage 結構化資料。
 *
 * 安全設計：
 *  - 預設只處理 MAX 篇（依瀏覽數由高到低，優先補高流量文）。
 *  - DRY_RUN=1 只預覽、不寫入。
 *  - 只「附加」TL;DR 與 FAQ，不改寫原文，降低風險。
 *
 * 環境變數：CF_API_BASE, CF_SERVICE_TOKEN, ANTHROPIC_API_KEY
 *           MAX（預設 5）, DRY_RUN（1=預覽）, MODEL（預設 haiku）
 */
'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const cfdb = require('./lib/cf-db');
const indexnow = require('./lib/indexnow');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CF_API_BASE = process.env.CF_API_BASE;
const CF_SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN;
const MAX = parseInt(process.env.MAX || '5', 10);
const DRY_RUN = process.env.DRY_RUN === '1';
const MODEL = process.env.MODEL || 'claude-haiku-4-5-20251001';

if (!ANTHROPIC_API_KEY || !CF_API_BASE || !CF_SERVICE_TOKEN) {
  console.error('❌ 缺少 ANTHROPIC_API_KEY / CF_API_BASE / CF_SERVICE_TOKEN');
  process.exit(1);
}
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function generate(post) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `以下是「操作一下」部落格的一篇既有文章。請依文章內容，產生「重點整理」與「常見問題」兩段，補強 SEO 與 AI 引用。不要改寫原文、不要編造文章沒有的數據。

標題：${post.title}
分類：${post.category}
摘要：${post.excerpt || ''}
內文（純文字）：
${stripTags(post.body).slice(0, 4000)}

請以純 JSON 回傳（不要 Markdown 代碼區塊、不要多餘文字）：
{
  "tldr": "一段 <p><strong>重點整理</strong></p> 後接 <ul>，用 3 條 <li> 列出本文核心結論（純 HTML）",
  "faq": "<h2>常見問題</h2> 後接 3 組 <h3>真實搜尋問句？</h3><p>1-2 句直接回答</p>（純 HTML）"
}`,
    }],
  });
  const raw = (resp.content[0] && resp.content[0].text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude 回應格式錯誤');
  const parsed = JSON.parse(m[0]);
  if (!parsed.tldr || !parsed.faq) throw new Error('回應缺少 tldr/faq');
  return parsed;
}

// 在「延伸閱讀/收聽」區塊（<hr> + 📚/🎙）之前插入 FAQ；找不到就附加在最後。
function insertFaq(body, faqHtml) {
  const m = body.match(/\n?<hr>\s*<p>\s*(?:📚|🎙)/);
  if (m) return body.slice(0, m.index) + '\n' + faqHtml + '\n' + body.slice(m.index);
  return body + '\n' + faqHtml;
}

async function main() {
  console.log(`🔧 FAQ/TL;DR 回填 ${DRY_RUN ? '(DRY RUN)' : ''}｜模型 ${MODEL}｜上限 ${MAX} 篇\n`);
  const all = await cfdb.getAllPostsWithBody();
  const targets = all
    .filter((p) => p.status === 'published' && p.body && !/常見問題/.test(p.body) && stripTags(p.body).length > 300)
    .sort((a, b) => (b.views || 0) - (a.views || 0)) // 高流量優先
    .slice(0, MAX);

  console.log(`  待回填：${targets.length} 篇（全站尚缺 FAQ 的高流量文優先）\n`);
  if (!targets.length) { console.log('✅ 沒有需要回填的文章'); return; }

  const updated = [];
  for (const post of targets) {
    try {
      const { tldr, faq } = await generate(post);
      let body = post.body;
      if (!/重點整理/.test(body)) body = tldr + '\n' + body; // 答案先行
      body = insertFaq(body, faq);

      if (DRY_RUN) {
        console.log(`  [DRY] #${post.id}（${post.views || 0} 次）${post.title}`);
        continue;
      }
      await cfdb.updatePost(post.id, { body });
      updated.push(`https://operation.tw/post/${post.id}/`);
      console.log(`  ✓ #${post.id}（${post.views || 0} 次）${post.title}`);
    } catch (err) {
      console.warn(`  ✗ #${post.id} 失敗：${err.message}`);
    }
  }

  if (updated.length) await indexnow.ping([...updated, 'https://operation.tw/sitemap.xml']);
  console.log(`\n✅ 完成，回填 ${updated.length} 篇${DRY_RUN ? '（DRY RUN，未寫入）' : ''}`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
