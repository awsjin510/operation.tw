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

// 5 cover image templates — selected by postId % 5
const SVG_TEMPLATES = [
  // 0: Typography (大字排版)
  (c, l, d) => {
    const bw = l.length * 17 + 50;
    return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs>
<pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="${c}" stroke-width="0.5" opacity="0.12"/></pattern>
<filter id="gw" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="sg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="50"/></filter>
</defs>
<rect width="1200" height="630" fill="#050510"/>
<rect width="1200" height="630" fill="url(#g)"/>
<circle cx="960" cy="140" r="280" fill="${c}" filter="url(#sg)" opacity="0.14"/>
<circle cx="180" cy="500" r="150" fill="${c}" filter="url(#sg)" opacity="0.07"/>
<rect x="0" y="0" width="5" height="630" fill="${c}" filter="url(#gw)"/>
<rect x="0" y="0" width="1200" height="2" fill="${c}" opacity="0.35"/>
<rect x="0" y="628" width="1200" height="2" fill="${c}" opacity="0.18"/>
<rect x="58" y="76" width="${bw}" height="44" rx="3" fill="transparent" stroke="${c}" stroke-width="2" filter="url(#gw)"/>
<text x="78" y="107" font-family="monospace" font-size="22" fill="${c}" font-weight="bold" letter-spacing="4">${l}</text>
<text x="60" y="360" font-family="monospace" font-size="220" fill="${c}" opacity="0.04" font-weight="bold">${l[0]}</text>
<line x1="60" y1="148" x2="460" y2="148" stroke="${c}" stroke-width="1" opacity="0.2"/>
<line x1="900" y1="200" x2="1140" y2="440" stroke="${c}" stroke-width="1" opacity="0.1"/>
<text x="60" y="563" font-family="monospace" font-size="28" fill="#ffffff" opacity="0.55" letter-spacing="2">operation.tw</text>
<text x="60" y="598" font-family="monospace" font-size="16" fill="${c}" opacity="0.5">// ${d}</text>
<line x1="1120" y1="590" x2="1180" y2="590" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
<line x1="1180" y1="590" x2="1180" y2="530" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
<circle cx="1180" cy="530" r="3" fill="${c}" opacity="0.7"/>
</svg>`;
  },

  // 1: Terminal (代碼終端)
  (c, l, d) => `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs><filter id="sg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="50"/></filter></defs>
<rect width="1200" height="630" fill="#050510"/>
<circle cx="600" cy="315" r="350" fill="${c}" filter="url(#sg)" opacity="0.07"/>
<rect x="80" y="80" width="780" height="440" rx="8" fill="#0a0a1a" stroke="${c}" stroke-width="1.5" stroke-opacity="0.3"/>
<rect x="80" y="80" width="780" height="38" rx="8" fill="#0d0d22"/>
<rect x="80" y="106" width="780" height="12" fill="#0d0d22"/>
<circle cx="112" cy="99" r="7" fill="#ff5f56" opacity="0.8"/>
<circle cx="135" cy="99" r="7" fill="#ffbd2e" opacity="0.8"/>
<circle cx="158" cy="99" r="7" fill="#27c93f" opacity="0.8"/>
<text x="470" y="105" font-family="monospace" font-size="13" fill="#404070" text-anchor="middle">─ ${l.toLowerCase()} ─</text>
<text x="112" y="162" font-family="monospace" font-size="15" fill="#6060a0">$ </text>
<text x="136" y="162" font-family="monospace" font-size="15" fill="${c}">cat ${l.toLowerCase()}.md</text>
<text x="112" y="194" font-family="monospace" font-size="14" fill="#6060a0"># ${l} — operation.tw</text>
<rect x="112" y="210" width="520" height="10" rx="2" fill="#ffffff" opacity="0.04"/>
<rect x="112" y="229" width="400" height="10" rx="2" fill="#ffffff" opacity="0.04"/>
<rect x="112" y="248" width="560" height="10" rx="2" fill="#ffffff" opacity="0.04"/>
<rect x="112" y="267" width="320" height="10" rx="2" fill="#ffffff" opacity="0.04"/>
<rect x="112" y="286" width="480" height="10" rx="2" fill="#ffffff" opacity="0.03"/>
<rect x="112" y="305" width="240" height="10" rx="2" fill="#ffffff" opacity="0.03"/>
<text x="112" y="352" font-family="monospace" font-size="13" fill="${c}" opacity="0.6">// ${d} · operation.tw</text>
<rect x="112" y="367" width="10" height="18" fill="${c}" opacity="0.85"/>
<text x="1060" y="345" font-family="monospace" font-size="110" fill="${c}" opacity="0.05" font-weight="bold">${l[0]}</text>
<text x="60" y="578" font-family="monospace" font-size="22" fill="#ffffff" opacity="0.5" letter-spacing="2">operation.tw</text>
<text x="1140" y="578" font-family="monospace" font-size="14" fill="${c}" opacity="0.45" text-anchor="end">${d}</text>
</svg>`,

  // 2: Geometric Brackets (幾何角落)
  (c, l, d) => `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs>
<pattern id="dots" width="80" height="80" patternUnits="userSpaceOnUse"><circle cx="40" cy="40" r="1.5" fill="${c}" opacity="0.1"/></pattern>
<filter id="sg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
</defs>
<rect width="1200" height="630" fill="#050510"/>
<rect width="1200" height="630" fill="url(#dots)"/>
<circle cx="380" cy="280" r="300" fill="${c}" filter="url(#sg)" opacity="0.1"/>
<path d="M55 55 L55 115 M55 55 L115 55" stroke="${c}" stroke-width="3" fill="none"/>
<path d="M1145 55 L1145 115 M1145 55 L1085 55" stroke="${c}" stroke-width="3" fill="none"/>
<path d="M55 575 L55 515 M55 575 L115 575" stroke="${c}" stroke-width="3" fill="none"/>
<path d="M1145 575 L1145 515 M1145 575 L1085 575" stroke="${c}" stroke-width="3" fill="none"/>
<polygon points="600,155 710,215 710,315 600,375 490,315 490,215" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.15"/>
<polygon points="600,180 688,228 688,292 600,342 512,292 512,228" fill="none" stroke="${c}" stroke-width="0.8" opacity="0.07"/>
<line x1="582" y1="265" x2="618" y2="265" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
<line x1="600" y1="247" x2="600" y2="283" stroke="${c}" stroke-width="1.5" opacity="0.5"/>
<circle cx="600" cy="265" r="5" fill="none" stroke="${c}" stroke-width="1.5" opacity="0.6"/>
<text x="600" y="450" font-family="monospace" font-size="76" fill="${c}" opacity="0.07" font-weight="bold" text-anchor="middle">${l}</text>
<rect x="${600 - l.length * 9 - 30}" y="460" width="${l.length * 18 + 60}" height="38" rx="2" fill="transparent" stroke="${c}" stroke-width="1.5" opacity="0.55"/>
<text x="600" y="486" font-family="monospace" font-size="18" fill="${c}" font-weight="bold" letter-spacing="5" text-anchor="middle">${l}</text>
<text x="600" y="545" font-family="monospace" font-size="24" fill="#ffffff" opacity="0.45" letter-spacing="2" text-anchor="middle">operation.tw</text>
<text x="600" y="572" font-family="monospace" font-size="14" fill="${c}" opacity="0.35" text-anchor="middle">${d}</text>
</svg>`,

  // 3: Quote / Minimal (極簡引言)
  (c, l, d) => `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs><filter id="sg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="70"/></filter></defs>
<rect width="1200" height="630" fill="#050510"/>
<circle cx="200" cy="200" r="350" fill="${c}" filter="url(#sg)" opacity="0.08"/>
<circle cx="1000" cy="450" r="250" fill="${c}" filter="url(#sg)" opacity="0.06"/>
<text x="85" y="310" font-family="Georgia,serif" font-size="340" fill="${c}" opacity="0.06">"</text>
<line x1="80" y1="375" x2="600" y2="375" stroke="${c}" stroke-width="2" opacity="0.15"/>
<line x1="80" y1="385" x2="380" y2="385" stroke="${c}" stroke-width="1" opacity="0.08"/>
<text x="80" y="458" font-family="monospace" font-size="52" fill="${c}" opacity="0.9" font-weight="bold" letter-spacing="6">${l}</text>
<text x="80" y="502" font-family="monospace" font-size="16" fill="${c}" opacity="0.4" letter-spacing="3">OPERATION.TW / ${d}</text>
<line x1="80" y1="516" x2="480" y2="516" stroke="${c}" stroke-width="1" opacity="0.12"/>
<text x="1140" y="380" font-family="monospace" font-size="160" fill="${c}" opacity="0.04" text-anchor="end">${l[0]}</text>
</svg>`,

  // 4: Circuit Nodes (電路節點)
  (c, l, d) => `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
<defs>
<pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0L0 0 0 40" fill="none" stroke="${c}" stroke-width="0.4" opacity="0.08"/></pattern>
<filter id="sg" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="50"/></filter>
<filter id="gw" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="1200" height="630" fill="#050510"/>
<rect width="1200" height="630" fill="url(#g)"/>
<circle cx="700" cy="250" r="300" fill="${c}" filter="url(#sg)" opacity="0.08"/>
<line x1="180" y1="180" x2="420" y2="180" stroke="${c}" stroke-width="1.5" opacity="0.3"/>
<line x1="420" y1="180" x2="420" y2="320" stroke="${c}" stroke-width="1.5" opacity="0.3"/>
<line x1="420" y1="320" x2="680" y2="320" stroke="${c}" stroke-width="1.5" opacity="0.3"/>
<line x1="680" y1="320" x2="680" y2="180" stroke="${c}" stroke-width="1.5" opacity="0.3"/>
<line x1="680" y1="180" x2="900" y2="180" stroke="${c}" stroke-width="1.5" opacity="0.3"/>
<line x1="900" y1="180" x2="900" y2="420" stroke="${c}" stroke-width="1.5" opacity="0.2"/>
<line x1="180" y1="420" x2="680" y2="420" stroke="${c}" stroke-width="1.5" opacity="0.2"/>
<circle cx="180" cy="180" r="6" fill="${c}" opacity="0.6" filter="url(#gw)"/>
<circle cx="420" cy="180" r="4" fill="${c}" opacity="0.5"/>
<circle cx="420" cy="320" r="4" fill="${c}" opacity="0.5"/>
<circle cx="680" cy="320" r="4" fill="${c}" opacity="0.5"/>
<circle cx="680" cy="180" r="4" fill="${c}" opacity="0.5"/>
<circle cx="900" cy="180" r="4" fill="${c}" opacity="0.4"/>
<circle cx="900" cy="420" r="4" fill="${c}" opacity="0.4"/>
<circle cx="180" cy="420" r="4" fill="${c}" opacity="0.4"/>
<rect x="528" y="218" width="24" height="24" fill="none" stroke="${c}" stroke-width="2" opacity="0.5"/>
<rect x="530" y="220" width="20" height="20" fill="${c}" opacity="0.04"/>
<text x="80" y="518" font-family="monospace" font-size="44" fill="${c}" opacity="0.9" font-weight="bold" letter-spacing="5">${l}</text>
<text x="80" y="558" font-family="monospace" font-size="16" fill="#ffffff" opacity="0.45" letter-spacing="2">operation.tw</text>
<text x="80" y="580" font-family="monospace" font-size="14" fill="${c}" opacity="0.4">${d}</text>
<text x="1100" y="460" font-family="monospace" font-size="130" fill="${c}" opacity="0.04" font-weight="bold" text-anchor="end">${l[0]}</text>
</svg>`,
];

function generateSVG(category, postId) {
  const color = CAT_COLORS[category] || '#00f5ff';
  const label = CAT_LABELS[category] || category;
  const today = new Date().toISOString().split('T')[0];
  const idx = (postId || 0) % 5;
  return SVG_TEMPLATES[idx](color, label, today);
}

async function generateCoverImage(postId, category) {
  const svg = generateSVG(category, postId);
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

  // 步驟 6：更新本地 posts.json（含最新 views 數字）
  console.log('\n步驟 6：更新 posts.json...');
  const postsJsonPath = path.join(__dirname, '..', 'posts.json');
  const allPostsRes = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/posts?select=id,title,category,date,status,excerpt,image,views&status=eq.published&order=date.desc`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!allPostsRes.ok) throw new Error(`posts fetch failed: ${allPostsRes.status}`);
  const allPosts = await allPostsRes.json();
  const leanPosts = allPosts.map(p => ({
    ...p,
    image: (p.image && p.image.startsWith('/')) ? p.image : '',
  }));
  const postsData = { generated: new Date().toISOString(), posts: leanPosts };
  await fs.writeFile(postsJsonPath, JSON.stringify(postsData, null, 0));
  console.log(`  ✓ posts.json 已更新（${postsData.posts.length} 篇文章，含最新 views）`);

  console.log('\n✅ 完成！\n');
}

main().catch((err) => {
  console.error('\n❌ 執行失敗：', err.message);
  process.exit(1);
});
