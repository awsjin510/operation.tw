/**
 * generate-glossary.js — 從全站文章萃取「科技術語庫」（GEO：定義型內容最易被 AI 引用）。
 * 產出 glossary.json；build-static 會據此產生 /glossary/ 頁（含 DefinedTermSet 結構化資料）。
 * 冪等：重跑會整份重生（可定期更新納入新文章的新術語）。
 *
 * 環境變數：ANTHROPIC_API_KEY（必要）、CF_API_BASE/CF_SERVICE_TOKEN（取文章清單）、
 *           GLOSSARY_MODEL（預設 claude-sonnet-5，品質優先；一次性成本低）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const cfdb = require('./lib/cf-db');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.GLOSSARY_MODEL || 'claude-sonnet-5';
const OUT = path.resolve(__dirname, '..', 'glossary.json');

if (!ANTHROPIC_API_KEY) { console.error('❌ 缺 ANTHROPIC_API_KEY'); process.exit(1); }
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

async function main() {
  console.log(`\n📖 生成術語庫（模型：${MODEL}）\n`);
  const posts = await cfdb.getPublishedPosts();
  const list = posts.map((p) => `${p.id}|${p.category}|${p.title}`).join('\n');
  console.log(`  ✓ 取得 ${posts.length} 篇文章清單`);

  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 32000,
    messages: [{
      role: 'user',
      content: `你是科技自媒體「操作一下」（主題：雲端、資安、AI、閱讀、成長）的編輯。以下是全站文章清單（格式 id|分類|標題）：

${list}

請從這些文章涵蓋的主題中，挑出 50-60 個「讀者最可能去搜尋定義」的核心術語，建立術語庫。選詞原則：
- 以雲端/資安/AI 技術詞為主（例：零信任、HBM、RAG、Prompt 工程、SOC、Serverless…），可搭配少量成長/生產力概念詞
- 優先挑「站上文章實際談過」的詞
- 每個詞的定義必須：第一句是「X 是……」的完整定義句（不依賴上下文、可被 AI 單獨引用）、共 2 句、每句精煉不超過 40 字、繁體中文、專業但易讀、不編造數據

請以純 JSON 陣列回傳（不要 Markdown 圍欄、不要多餘文字）：
[
  {
    "term": "術語中文常用名",
    "en": "英文原名或縮寫（沒有就空字串）",
    "category": "雲端|資安|AI|成長|通用 其中之一",
    "def": "定義（第一句 X 是…，共 2-3 句）",
    "related": [相關文章 id，最多 3 個，只從上面清單挑真的高度相關的；沒有就空陣列]
  }
]`,
    }],
  });

  if (resp.stop_reason === 'max_tokens') throw new Error('回應被截斷，請提高 max_tokens');
  const raw = (resp.content[0].text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('回應格式錯誤：' + raw.slice(0, 200));
  const terms = JSON.parse(m[0]);

  // 基本驗證 + 清洗
  const validIds = new Set(posts.map((p) => p.id));
  const clean = terms
    .filter((t) => t && t.term && t.def)
    .map((t) => ({
      term: String(t.term).trim(),
      en: String(t.en || '').trim(),
      category: ['雲端', '資安', 'AI', '成長', '通用'].includes(t.category) ? t.category : '通用',
      def: String(t.def).trim(),
      related: (Array.isArray(t.related) ? t.related : []).filter((id) => validIds.has(id)).slice(0, 3),
    }));
  if (clean.length < 30) throw new Error(`術語數量過少（${clean.length}），拒絕覆寫`);

  fs.writeFileSync(OUT, JSON.stringify({ generated: new Date().toISOString(), terms: clean }, null, 1));
  console.log(`✅ glossary.json 已寫入（${clean.length} 個術語）`);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
