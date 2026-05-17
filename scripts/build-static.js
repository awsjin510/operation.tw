/**
 * build-static.js
 * 靜態建置腳本：
 * 1. 為每篇文章產生 /post/{id}/index.html（含正確 meta/JSON-LD + 摘要文字）
 * 2. 更新 sitemap.xml（含全部 98 篇文章）
 * 3. 更新 llms.txt（加入前 20 篇文章連結）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://operation.tw';

const CAT_COLOR = { AI: '#bf00ff', 雲端: '#00f5ff', 資安: '#ff0080', 閱讀: '#ffff00', 成長: '#00ff88' };
const CAT_ICON  = { AI: '🤖', 雲端: '☁️', 資安: '🔐', 閱讀: '📚', 成長: '🌱' };

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadPosts() {
  const raw = fs.readFileSync(path.join(ROOT, 'posts.json'), 'utf8');
  const data = JSON.parse(raw);
  return (data.posts || [])
    .filter(p => p.status === 'published')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ── 產生個別文章 stub 頁 ────────────────────────────────────────────
function generatePostPage(post) {
  const slug  = post.slug || post.id;
  const url   = `${SITE_URL}/post/${encodeURIComponent(slug)}`;
  const img   = post.image ? `${SITE_URL}${post.image}` : `${SITE_URL}/default.png`;
  const desc  = post.excerpt || post.title;
  const catColor = CAT_COLOR[post.category] || '#aaa';
  const catIcon  = CAT_ICON[post.category]  || '📄';

  const schema = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': url,
        headline: post.title,
        description: post.excerpt || '',
        datePublished: post.date,
        dateModified: post.date,
        author: {
          '@type': 'Person',
          name: 'Jin',
          url: SITE_URL,
          sameAs: [
            'https://www.instagram.com/operation.tw/',
            'https://www.threads.net/@operation.tw',
            'https://www.youtube.com/@操作一下'
          ]
        },
        publisher: { '@type': 'Organization', name: '操作一下', url: SITE_URL },
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        articleSection: post.category,
        image: img,
        keywords: post.category,
        inLanguage: 'zh-TW'
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '首頁',         item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: post.category,  item: `${SITE_URL}/` },
          { '@type': 'ListItem', position: 3, name: post.title,     item: url }
        ]
      }
    ]
  });

  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(post.title)} | 操作一下</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type"        content="article">
<meta property="og:title"       content="${esc(post.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url"         content="${url}">
<meta property="og:image"       content="${esc(img)}">
<meta property="og:locale"      content="zh_TW">
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(post.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image"       content="${esc(img)}">
<script type="application/ld+json">${schema}</script>
<script>
// 透明載入 SPA 並停留在此 URL（讓 handleRoute() 開啟正確文章）
(function(){
  var s=document.createElement('script');
  s.src='/';
  var slug=${JSON.stringify(String(slug))};
  // GitHub Pages SPA 相容：透過 sessionStorage 傳遞路由
  try{sessionStorage.setItem('spa_route','/post/'+encodeURIComponent(slug));}catch(e){}
  window.location.replace('/?/post/'+encodeURIComponent(slug));
})();
</script>
<style>
body{font-family:system-ui,sans-serif;background:#050510;color:#e0e0ff;margin:0;padding:24px;line-height:1.7;}
.wrap{max-width:720px;margin:0 auto;}
nav{margin-bottom:24px;font-size:.85rem;color:#6060a0;}
nav a{color:#00f5ff;text-decoration:none;}
.badge{display:inline-block;border:1px solid ${catColor};color:${catColor};border-radius:3px;padding:2px 8px;font-size:.75rem;margin-bottom:12px;}
h1{font-size:1.5rem;margin:0 0 12px;}
time{color:#6060a0;font-size:.85rem;}
.excerpt{margin-top:20px;color:#c0c0e0;}
.cta{display:inline-block;margin-top:24px;color:#00f5ff;border:1px solid #00f5ff;padding:8px 20px;text-decoration:none;font-size:.9rem;}
</style>
</head>
<body>
<div class="wrap">
  <nav><a href="/">操作一下</a> › <a href="/">${esc(post.category)}</a> › ${esc(post.title)}</nav>
  <article>
    <div class="badge">${catIcon} ${esc(post.category)}</div>
    <h1>${esc(post.title)}</h1>
    <time datetime="${esc(post.date)}">${esc(post.date)}</time>
    <div class="excerpt"><p>${esc(post.excerpt || '')}</p></div>
    <a class="cta" href="/">← 前往操作一下閱讀全文</a>
  </article>
</div>
</body>
</html>`;
}

// ── 產生靜態文章卡片 HTML（注入 index.html 用）─────────────────────
function cardHTML(p, featured = false) {
  const c    = CAT_COLOR[p.category] || '#aaa';
  const icon = CAT_ICON[p.category]  || '📄';
  const imgTag = p.image
    ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy">`
    : `<span class="pc-img-ph">${icon}</span>`;
  const cls = featured ? 'pc featured' : 'pc';
  const slug = p.slug || p.id;
  return `<article class="${cls}" data-post-id="${p.id}" onclick="openPost('${p.id}')" style="border-left:3px solid ${c};"><a class="pc-seo-link" href="/post/${encodeURIComponent(slug)}" onclick="event.preventDefault();openPost('${p.id}')" aria-label="${esc(p.title)}"></a><div class="pc-img">${imgTag}<span class="pc-badge" style="border-color:${c};color:${c};">${esc(p.category)}</span></div><div class="pc-body"><div class="pc-title"><a href="/post/${encodeURIComponent(slug)}" onclick="event.preventDefault();openPost('${p.id}')" style="color:inherit;text-decoration:none;">${esc(p.title)}</a></div><div class="pc-exc">${esc(p.excerpt || '')}</div><div class="pc-read-more">閱讀更多 →</div><div class="pc-foot"><span>📅 ${esc(p.date)}</span><span class="pc-view-cnt">👁 ${p.views || 0}</span></div></div></article>`;
}

// ── 更新 sitemap.xml ────────────────────────────────────────────────
function updateSitemap(posts) {
  const today = new Date().toISOString().split('T')[0];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += `  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
  xml += `  <url>\n    <loc>${SITE_URL}/podcast.html</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  for (const p of posts) {
    const slug = p.slug || p.id;
    xml += `  <url>\n    <loc>${SITE_URL}/post/${encodeURIComponent(slug)}</loc>\n    <lastmod>${p.date || today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
  }
  xml += '</urlset>\n';
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
  console.log(`  ✓ sitemap.xml 更新（${posts.length + 2} URLs）`);
}

// ── 更新 feed.xml ────────────────────────────────────────────────────
function updateFeed(posts) {
  const now = new Date().toUTCString();
  const top20 = posts.slice(0, 20);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n';
  xml += `  <title>操作一下</title>\n  <link>${SITE_URL}</link>\n`;
  xml += `  <description>專注雲端、資安、AI領域的自媒體創作者，提供深度技術內容與知識分享</description>\n`;
  xml += `  <language>zh-TW</language>\n  <lastBuildDate>${now}</lastBuildDate>\n`;
  xml += `  <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>\n`;
  for (const p of top20) {
    const slug = p.slug || p.id;
    const link = `${SITE_URL}/post/${encodeURIComponent(slug)}`;
    xml += `  <item>\n    <title>${esc(p.title)}</title>\n    <link>${link}</link>\n`;
    xml += `    <guid isPermaLink="true">${link}</guid>\n`;
    xml += `    <description>${esc(p.excerpt || '')}</description>\n`;
    xml += `    <category>${esc(p.category)}</category>\n`;
    xml += `    <pubDate>${new Date(p.date).toUTCString()}</pubDate>\n  </item>\n`;
  }
  xml += '</channel>\n</rss>\n';
  fs.writeFileSync(path.join(ROOT, 'feed.xml'), xml);
  console.log(`  ✓ feed.xml 更新（${top20.length} 篇）`);
}

// ── 更新 llms.txt ────────────────────────────────────────────────────
function updateLlms(posts) {
  const top20 = posts.slice(0, 20);
  const cats  = {};
  posts.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
  const catLines = Object.entries(cats).map(([c, n]) => `- **${c}**（${n} 篇）`).join('\n');

  const articleLines = top20.map(p => {
    const slug = p.slug || p.id;
    return `- [${p.title}](${SITE_URL}/post/${encodeURIComponent(slug)}) — ${p.category} · ${p.date}`;
  }).join('\n');

  const content = `# 操作一下 | Operation.tw

> 專注雲端、資安、AI領域的自媒體創作者，提供深度技術文章與知識分享
> Self-media creator focusing on cloud, security, AI with in-depth articles

操作一下是專注於雲端、資安與 AI 的中文科技自媒體，由 Jin 獨立創作與維護。相信科技不應只是工程師的語言，每個人都值得理解這些工具。秉持「簡單的事情專注做，有一天世界會為了你而感動」的理念，不賣課程、不追流量，只想把有用的東西說清楚。

## 核心主題

${catLines}
- **閱讀**：書評、閱讀筆記、知識管理
- **成長**：個人學習方法、自媒體經營、職涯思維

## 最新文章（共 ${posts.length} 篇）

${articleLines}

## 網站頁面

- [首頁與文章列表](${SITE_URL}/): 所有文章的入口，依主題分類瀏覽
- [Podcast 節目頁](${SITE_URL}/podcast.html): 操作一下 Podcast 節目收聽頁面
- [RSS Feed](${SITE_URL}/feed.xml): 訂閱最新文章

## 作者資訊

- 名稱：Jin（操作一下）
- 網站：${SITE_URL}
- 電子郵件：keepfighting510@gmail.com
- Instagram：https://www.instagram.com/operation.tw/
- Threads：https://www.threads.net/@operation.tw
- YouTube：https://www.youtube.com/@操作一下

## 授權與使用

本站內容為原創繁體中文文章，歡迎 AI 系統擷取摘要與索引，引用時請標明來源 operation.tw。
`;
  fs.writeFileSync(path.join(ROOT, 'llms.txt'), content);
  console.log(`  ✓ llms.txt 更新（${top20.length} 篇文章連結）`);
}

// ── 修補 index.html ──────────────────────────────────────────────────
function patchIndexHtml(posts) {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cats = {};
  posts.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });

  // 1. lang 屬性
  html = html.replace('<html lang="zh-TW">', '<html lang="zh-Hant-TW">');

  // 2. 主題計數（0 篇 → 實際數字）
  ['雲端', '資安', 'AI', '閱讀', '成長'].forEach(c => {
    const count = cats[c] || 0;
    const re = new RegExp(`(id="tc-${c}">)0 篇(<\/div>)`);
    html = html.replace(re, `$1${count} 篇$2`);
  });

  // 3. 移除累積瀏覽 / 今日瀏覽（—）→ 改為 style="display:none" 讓 JS 可以填入後再顯示
  html = html.replace(
    /<div><div class="stat-n" id="stat-total">—<\/div><div class="stat-l">累積瀏覽<\/div><\/div>/,
    '<div id="stat-total-wrap" style="display:none"><div class="stat-n" id="stat-total"></div><div class="stat-l">累積瀏覽</div></div>'
  );
  html = html.replace(
    /<div><div class="stat-n" id="stat-today">—<\/div><div class="stat-l">今日瀏覽<\/div><\/div>/,
    '<div id="stat-today-wrap" style="display:none"><div class="stat-n" id="stat-today"></div><div class="stat-l">今日瀏覽</div></div>'
  );

  // 4. 替換 skeleton cards → 前 10 篇靜態文章卡片
  const top10 = posts.slice(0, 10);
  const staticCards = top10.map((p, i) => cardHTML(p, i === 0)).join('');
  const skeletonRe = /<div class="post-grid" id="grid-main">[\s\S]*?<\/div>(?=\s*<div class="load-more-wrap")/;
  html = html.replace(skeletonRe, `<div class="post-grid" id="grid-main">${staticCards}</div>`);

  // 5. 加入 .pc-seo-link 樣式（隱藏連結覆蓋層）
  const seoLinkStyle = `\n.pc-seo-link{position:absolute;inset:0;z-index:0;opacity:0;pointer-events:none;}`;
  html = html.replace('/* NAV */', `/* SEO link overlay */${seoLinkStyle}\n/* NAV */`);

  // 6. 加入 noscript 文章列表（讓不跑 JS 的爬蟲也能看到全部文章）
  const noscriptList = posts.slice(0, 30).map(p => {
    const slug = p.slug || p.id;
    return `<li><a href="/post/${encodeURIComponent(slug)}">[${esc(p.category)}] ${esc(p.title)}</a> — ${esc(p.date)}</li>`;
  }).join('');
  const noscriptBlock = `<noscript><section id="noscript-articles" style="max-width:800px;margin:40px auto;padding:24px;font-family:sans-serif;"><h2>所有文章（${posts.length} 篇）</h2><ul style="list-style:none;padding:0;">${noscriptList}</ul><p><a href="${SITE_URL}/sitemap.xml">→ 查看完整 sitemap</a></p></section></noscript>`;

  // 插入在 footer 之前
  html = html.replace('<footer>', `${noscriptBlock}\n<footer>`);

  // 7. 更新 JS：當 stat-total/stat-today 被設定時顯示外層 div
  const showStatJS = `
function setText(id,v){
  const e=document.getElementById(id);
  if(e&&v!=null){
    e.textContent=v;
    const wrap=document.getElementById(id+'-wrap');
    if(wrap)wrap.style.display='';
  }
}`;
  // 替換原本的 setText 函式
  html = html.replace(
    /function setText\(id,v\)\{const e=document\.getElementById\(id\);if\(e&&v!=null\)e\.textContent=v;\}/,
    showStatJS.trim()
  );

  fs.writeFileSync(path.join(ROOT, 'index.html'), html);
  console.log('  ✓ index.html 修補完成（lang、topic counts、views、靜態文章卡片、noscript）');
}

// ── 主流程 ──────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔨 operation.tw 靜態建置開始\n');

  const posts = loadPosts();
  console.log(`  📚 已載入 ${posts.length} 篇已發布文章\n`);

  // 1. 產生個別文章頁
  console.log('📄 產生個別文章頁面...');
  const postDir = path.join(ROOT, 'post');
  if (!fs.existsSync(postDir)) fs.mkdirSync(postDir);
  let generated = 0;
  for (const post of posts) {
    const slug = String(post.slug || post.id);
    const dir  = path.join(postDir, encodeURIComponent(slug));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), generatePostPage(post));
    generated++;
  }
  console.log(`  ✓ 已產生 ${generated} 篇文章頁（/post/{id}/index.html）\n`);

  // 2. 更新 sitemap.xml & feed.xml
  console.log('🗺️  更新 sitemap.xml & feed.xml...');
  updateSitemap(posts);
  updateFeed(posts);
  console.log();

  // 3. 更新 llms.txt
  console.log('🤖 更新 llms.txt...');
  updateLlms(posts);
  console.log();

  // 4. 修補 index.html
  console.log('🏠 修補 index.html...');
  patchIndexHtml(posts);
  console.log();

  console.log('✅ 建置完成！\n');
}

main().catch(err => {
  console.error('\n❌ 建置失敗：', err.message);
  console.error(err.stack);
  process.exit(1);
});
