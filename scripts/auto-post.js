/**
 * auto-post.js
 * 每日自動新聞抓取 + AI 文章生成 + Supabase 發布
 *
 * 環境變數（在 GitHub Actions Secrets 設定）：
 *   SUPABASE_URL        - Supabase 專案 URL
 *   SUPABASE_SERVICE_KEY - Supabase service_role key（繞過 RLS）
 *   ANTHROPIC_API_KEY   - Claude API Key
 */

const Anthropic = require('@anthropic-ai/sdk');
const Parser = require('rss-parser');

// ── 環境變數檢查 ────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ 缺少必要的環境變數：SUPABASE_URL、SUPABASE_SERVICE_KEY、ANTHROPIC_API_KEY');
  process.exit(1);
}

// ── 初始化 ──────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const rssParser = new Parser({ timeout: 15000 });

// ── 新聞來源（Google News RSS，免費無需 API Key）─────────────────
const NEWS_SOURCES = [
  {
    category: 'AI',
    url: 'https://news.google.com/rss/search?q=人工智慧+AI+大型語言模型&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
  },
  {
    category: '雲端',
    url: 'https://news.google.com/rss/search?q=雲端運算+AWS+Azure+GCP&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
  },
  {
    category: '資安',
    url: 'https://news.google.com/rss/search?q=資訊安全+網路攻擊+cybersecurity&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
  },
];

// ── 抓取單一類別的新聞 ──────────────────────────────────────────
async function fetchNews(source) {
  try {
    const feed = await rssParser.parseURL(source.url);
    const articles = feed.items.slice(0, 3).map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      snippet: (item.contentSnippet || item.content || '').slice(0, 300),
    }));
    console.log(`  ✓ [${source.category}] 取得 ${articles.length} 則新聞`);
    return { category: source.category, articles };
  } catch (err) {
    console.warn(`  ✗ [${source.category}] 抓取失敗：${err.message}`);
    return { category: source.category, articles: [] };
  }
}

// ── 用 Claude 生成繁體中文部落格文章 ────────────────────────────
async function generatePost(newsData) {
  const newsContext = newsData
    .filter((n) => n.articles.length > 0)
    .map((n) => {
      const items = n.articles
        .map((a, i) => `  ${i + 1}. ${a.title}${a.snippet ? '\n     ' + a.snippet : ''}`)
        .join('\n');
      return `【${n.category}】\n${items}`;
    })
    .join('\n\n');

  if (!newsContext) throw new Error('所有類別的新聞均抓取失敗，無法生成文章');

  const today = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `你是一位專業的科技部落格作者，專注於 AI、雲端運算、資訊安全領域。今天（${today}）的最新科技新聞如下：

${newsContext}

請從以上新聞中，選出最具話題性、對台灣讀者最有參考價值的一則，撰寫一篇專業繁體中文部落格文章。

**請以純 JSON 格式回傳（不要包含其他文字或 Markdown 代碼區塊）：**
{
  "category": "AI" 或 "雲端" 或 "資安",
  "title": "吸引人的文章標題（25字以內）",
  "excerpt": "文章摘要，說明本文重點（80-120字）",
  "body": "文章正文（HTML格式）"
}

**body 格式要求：**
- 使用 <h2>、<p>、<ul>/<li> 等 HTML 標籤
- 600-900 字
- 結構：新聞背景 → 技術深度分析 → 對台灣/亞太地區的影響 → 結論與建議
- 語氣：專業但易讀，避免過度術語`,
      },
    ],
  });

  const raw = response.content[0].text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude 回應格式錯誤：${raw.slice(0, 300)}`);

  return JSON.parse(jsonMatch[0]);
}

// ── 寫入 Supabase ────────────────────────────────────────────────
async function publishPost(article) {
  const today = new Date().toISOString().split('T')[0];

  const post = {
    title: article.title,
    category: article.category,
    date: today,
    status: 'published',
    excerpt: article.excerpt,
    image: '',
    body: article.body,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(post),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase 寫入失敗 (HTTP ${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data[0];
}

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`\n📰 每日新聞自動發文 — ${now}\n`);

  // 步驟 1：並行抓取三類新聞
  console.log('步驟 1：抓取新聞...');
  const newsData = await Promise.all(NEWS_SOURCES.map(fetchNews));

  // 步驟 2：用 Claude 生成文章
  console.log('\n步驟 2：AI 生成文章...');
  const article = await generatePost(newsData);
  console.log(`  ✓ 文章標題：[${article.category}] ${article.title}`);

  // 步驟 3：發布到 Supabase
  console.log('\n步驟 3：發布到 Supabase...');
  const published = await publishPost(article);
  console.log(`  ✓ 文章已發布！ID: ${published?.id}`);

  console.log('\n✅ 完成！\n');
}

main().catch((err) => {
  console.error('\n❌ 執行失敗：', err.message);
  process.exit(1);
});
