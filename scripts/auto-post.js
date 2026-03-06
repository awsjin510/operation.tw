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
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

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

/** fetch with AbortController timeout (default 30s) */
function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ── 新聞來源（Google News RSS，免費無需 API Key）─────────────────
const NEWS_SOURCES = [
  {
    category: 'AI',
    url: 'https://news.google.com/rss/search?q=%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7+AI+%E5%A4%A7%E5%9E%8B%E8%AA%9E%E8%A8%80%E6%A8%A1%E5%9E%8B&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
  },
  {
    category: '雲端',
    url: 'https://news.google.com/rss/search?q=%E9%9B%B2%E7%AB%AF%E9%81%8B%E7%AE%97+AWS+Azure+GCP&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
  },
  {
    category: '資安',
    url: 'https://news.google.com/rss/search?q=%E8%B3%87%E8%A8%8A%E5%AE%89%E5%85%A8+%E7%B6%B2%E8%B7%AF%E6%94%BB%E6%93%8A+cybersecurity&hl=zh-TW&gl=TW&ceid=TW:zh-Hant',
  },
];

// ── 查詢近期已發布文章（用於去重）──────────────────────────────
async function fetchRecentPosts(days = 14) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  try {
    const url = `${SUPABASE_URL}/rest/v1/posts?select=title,category,date&date=gte.${sinceStr}&order=date.desc&limit=30`;
    const res = await fetchWithTimeout(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });

    if (!res.ok) {
      console.warn(`  ⚠ 無法取得近期文章，將跳過去重：${res.status}`);
      return [];
    }

    const posts = await res.json();
    console.log(`  ✓ 取得近 ${days} 天的 ${posts.length} 篇已發布文章`);
    return posts;
  } catch (err) {
    console.warn(`  ⚠ 查詢近期文章失敗：${err.message}`);
    return [];
  }
}

// ── 抓取單一類別的新聞 ──────────────────────────────────────────
async function fetchNews(source) {
  try {
    const feed = await rssParser.parseURL(source.url);
    const now = Date.now();
    const FRESHNESS_MS = 48 * 60 * 60 * 1000; // 48 小時新鮮度窗口

    const candidates = feed.items.slice(0, 10);
    const fresh = candidates.filter((item) => {
      if (!item.pubDate) return true;
      return now - new Date(item.pubDate).getTime() < FRESHNESS_MS;
    });

    // fallback：若新鮮度過濾後為空（常見於 GitHub Actions Azure IP 拿到舊快取），
    // 改取最新的 3 則，確保腳本不會因無新聞而失敗
    const selected = fresh.length > 0 ? fresh.slice(0, 5) : candidates.slice(0, 3);
    if (fresh.length === 0 && candidates.length > 0) {
      console.warn(`  ⚠ [${source.category}] 無 48h 新鮮文章，改用最新 ${selected.length} 則（可能為舊快取）`);
    }

    const articles = selected.map((item) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || '',
      snippet: (item.contentSnippet || item.content || '').slice(0, 300),
    }));
    console.log(`  ✓ [${source.category}] 取得 ${articles.length} 則新聞（原始 ${candidates.length} 則，新鮮 ${fresh.length} 則）`);
    return { category: source.category, articles };
  } catch (err) {
    console.warn(`  ✗ [${source.category}] 抓取失敗：${err.message}`);
    return { category: source.category, articles: [] };
  }
}

// ── 用 Claude 生成繁體中文部落格文章 ────────────────────────────
async function generatePost(newsData, recentPosts = []) {
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

  // 建立去重上下文：列出近期已發布的文章標題
  let dedupContext = '';
  if (recentPosts.length > 0) {
    const recentTitles = recentPosts
      .map((p) => `- [${p.category}] ${p.title} (${p.date})`)
      .join('\n');
    dedupContext = `\n\n⚠️ 以下是近期已發布的文章，請務必選擇不同的主題和角度，不要與這些文章重複或相似：\n${recentTitles}`;

    // 計算最少使用的類別，提供軟性輪替提示
    const categoryCounts = { AI: 0, 雲端: 0, 資安: 0 };
    recentPosts.forEach((p) => {
      if (categoryCounts[p.category] !== undefined) categoryCounts[p.category]++;
    });
    const leastUsed = Object.entries(categoryCounts)
      .sort((a, b) => a[1] - b[1])[0][0];
    dedupContext += `\n\n💡 近期「${leastUsed}」類別的文章較少，優先考慮此類別（但若該類別新聞確實不夠有話題性，可選其他類別）。`;
  }

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
${dedupContext}

請從以上新聞中，選出一則符合以下條件的新聞來撰寫文章：
1. 與已發布文章的主題、概念、角度都不重複、不相似
2. 時效性強，最好是近一兩天內的新聞
3. 對台灣讀者具有參考價值

撰寫一篇專業繁體中文部落格文章。

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

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`JSON 解析失敗：${e.message}\n原始內容：${jsonMatch[0].slice(0, 300)}`);
  }

  const required = ['title', 'category', 'body', 'excerpt'];
  const missing = required.filter(f => !parsed[f]);
  if (missing.length) throw new Error(`Claude 回應缺少欄位：${missing.join(', ')}`);

  return parsed;
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

  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/posts`, {
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

// ── 封面圖生成 ────────────────────────────────────────────────────
const CAT_COLORS = {
  'AI':   '#ff0080',
  '雲端': '#00f5ff',
  '資安': '#00ff88',
  '閱讀': '#f7c948',
  '成長': '#a78bfa',
};
const CAT_LABELS = {
  'AI':   'AI',
  '雲端': 'CLOUD',
  '資安': 'SECURITY',
  '閱讀': 'READING',
  '成長': 'GROWTH',
};

function generateSVG(category) {
  const color = CAT_COLORS[category] || '#00f5ff';
  const label = CAT_LABELS[category] || category;
  const badgeW = label.length * 17 + 48;
  const today = new Date().toISOString().split('T')[0];

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${color}" stroke-width="0.5" opacity="0.12"/>
    </pattern>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softglow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="40" result="blur"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="#050510"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <circle cx="980" cy="120" r="260" fill="${color}" filter="url(#softglow)" opacity="0.18"/>
  <circle cx="200" cy="520" r="160" fill="${color}" filter="url(#softglow)" opacity="0.08"/>
  <rect x="0" y="0" width="6" height="630" fill="${color}" filter="url(#glow)"/>
  <rect x="0" y="0" width="1200" height="3" fill="${color}" opacity="0.4"/>
  <rect x="0" y="627" width="1200" height="3" fill="${color}" opacity="0.2"/>
  <rect x="60" y="80" width="${badgeW}" height="46" rx="3"
        fill="transparent" stroke="${color}" stroke-width="2" filter="url(#glow)"/>
  <text x="80" y="111" font-family="monospace,Courier New" font-size="22"
        fill="${color}" font-weight="bold" letter-spacing="4">${label}</text>
  <text x="60" y="340" font-family="monospace,Courier New" font-size="220"
        fill="${color}" opacity="0.04" font-weight="bold">${label.charAt(0)}</text>
  <line x1="60" y1="150" x2="440" y2="150" stroke="${color}" stroke-width="1" opacity="0.2"/>
  <text x="60" y="560" font-family="monospace,Courier New" font-size="28"
        fill="#ffffff" opacity="0.6" letter-spacing="2">operation.tw</text>
  <text x="60" y="595" font-family="monospace,Courier New" font-size="16"
        fill="${color}" opacity="0.5">// ${today}</text>
  <line x1="1100" y1="590" x2="1170" y2="590" stroke="${color}" stroke-width="1.5" opacity="0.5"/>
  <line x1="1170" y1="590" x2="1170" y2="520" stroke="${color}" stroke-width="1.5" opacity="0.5"/>
  <circle cx="1170" cy="520" r="3" fill="${color}" opacity="0.7"/>
</svg>`;
}

async function generateCoverImage(postId, category) {
  const svg = generateSVG(category);
  const outDir = path.join(__dirname, '..', 'images', 'posts');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `post-${postId}.jpg`);
  await sharp(Buffer.from(svg))
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(outPath);
  return `/images/posts/post-${postId}.jpg`;
}

async function updatePostImage(postId, imagePath) {
  const res = await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/posts?id=eq.${postId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ image: imagePath }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase 更新圖片失敗 (HTTP ${res.status}): ${errText}`);
  }
}

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  console.log(`\n📰 每日新聞自動發文 — ${now}\n`);

  // 步驟 1：並行抓取三類新聞 + 近期已發布文章
  console.log('步驟 1：抓取新聞與近期文章...');
  const [newsData, recentPosts] = await Promise.all([
    Promise.all(NEWS_SOURCES.map(fetchNews)),
    fetchRecentPosts(14),
  ]);

  // 步驟 2：用 Claude 生成文章（傳入近期文章供去重）
  console.log('\n步驟 2：AI 生成文章...');
  const article = await generatePost(newsData, recentPosts);
  console.log(`  ✓ 文章標題：[${article.category}] ${article.title}`);

  // 步驟 3：發布到 Supabase
  console.log('\n步驟 3：發布到 Supabase...');
  const published = await publishPost(article);
  const postId = published?.id;
  console.log(`  ✓ 文章已發布！ID: ${postId}`);

  // 步驟 4：生成封面圖
  console.log('\n步驟 4：生成封面圖...');
  const imagePath = await generateCoverImage(postId, article.category);
  console.log(`  ✓ 封面圖已生成：${imagePath}`);

  // 步驟 5：更新 Supabase image 欄位
  console.log('\n步驟 5：更新 Supabase 封面圖欄位...');
  await updatePostImage(postId, imagePath);
  console.log(`  ✓ image 欄位已更新`);

  console.log('\n✅ 完成！\n');
}

main().catch((err) => {
  console.error('\n❌ 執行失敗：', err.message);
  process.exit(1);
});
