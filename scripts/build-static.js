/**
 * build-static.js
 * 為每篇文章產生獨立靜態頁面：/post/{id}/index.html
 * 每個頁面含正確 meta / OG / JSON-LD，並透明載入完整 SPA。
 *
 * 執行：node scripts/build-static.js
 */

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const SITE_URL = 'https://operation.tw';

const CAT_COLOR = {AI:'#bf00ff',雲端:'#00f5ff',資安:'#ff0080',閱讀:'#ffff00',成長:'#00ff88'};
const CAT_ICON  = {AI:'🤖',雲端:'☁️',資安:'🔐',閱讀:'📚',成長:'🌱'};

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generatePostPage(post) {
  const slug    = post.slug || post.id;
  const url     = `${SITE_URL}/post/${encodeURIComponent(slug)}`;
  const img     = post.image ? (post.image.startsWith('http') ? post.image : SITE_URL + post.image)
                             : `${SITE_URL}/default.png`;
  const desc    = post.excerpt || post.title || '';
  const catColor = CAT_COLOR[post.category] || '#aaa';
  const catIcon  = CAT_ICON[post.category]  || '📄';

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BlogPosting',
        '@id': url,
        headline:        post.title || '',
        description:     desc,
        datePublished:   post.date  || '',
        dateModified:    post.date  || '',
        inLanguage:      'zh-TW',
        url,
        mainEntityOfPage: { '@type': 'WebPage', '@id': url },
        articleSection:  post.category || '',
        keywords:        post.category || '',
        image:           img,
        author: {
          '@type': 'Person',
          name:   'Jin',
          url:    SITE_URL,
          sameAs: [
            'https://www.instagram.com/operation.tw/',
            'https://www.threads.net/@operation.tw',
            'https://www.youtube.com/@操作一下'
          ]
        },
        publisher: {
          '@type': 'Organization',
          name:    '操作一下',
          url:     SITE_URL,
          logo:    { '@type': 'ImageObject', url: `${SITE_URL}/logo.jpg` }
        }
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
  };

  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(post.title)} | 操作一下</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="操作一下 RSS" href="${SITE_URL}/feed.xml">
<!-- Open Graph -->
<meta property="og:type"        content="article">
<meta property="og:title"       content="${esc(post.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url"         content="${url}">
<meta property="og:image"       content="${esc(img)}">
<meta property="og:locale"      content="zh_TW">
<meta property="og:site_name"   content="操作一下">
<!-- Twitter Card -->
<meta name="twitter:card"        content="summary_large_image">
<meta name="twitter:title"       content="${esc(post.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image"       content="${esc(img)}">
<!-- JSON-LD -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<!-- 透明載入完整 SPA，URL 保持 /post/${encodeURIComponent(slug)} -->
<style>body{margin:0;background:#050510;color:#e0e0ff;font-family:sans-serif;padding:40px 24px;}a{color:#00f5ff;}.loader{text-align:center;padding:60px 0;color:#6060a0;}</style>
<script>
(function(){
  var xhr = new XMLHttpRequest();
  xhr.open('GET', '/', true);
  xhr.onload = function(){
    if(xhr.status === 200){
      document.open('text/html', 'replace');
      document.write(xhr.responseText);
      document.close();
    }
  };
  xhr.onerror = function(){};
  xhr.send();
})();
</script>
</head>
<body>
<!-- 靜態備份：供不執行 JS 的爬蟲讀取 -->
<nav aria-label="breadcrumb" style="margin-bottom:16px;font-size:.85rem;color:#6060a0;">
  <a href="/">操作一下</a> › <span>${esc(post.category)}</span> › <span>${esc(post.title)}</span>
</nav>
<article>
  <p style="color:${catColor};font-size:.85rem;margin-bottom:8px;">${catIcon} ${esc(post.category)}</p>
  <h1 style="color:#e0e0ff;line-height:1.5;margin-bottom:12px;">${esc(post.title)}</h1>
  <time datetime="${esc(post.date)}" style="color:#6060a0;font-size:.85rem;">📅 ${esc(post.date)}</time>
  ${post.image ? `<img src="${esc(img)}" alt="${esc(post.title)}" style="width:100%;max-width:800px;display:block;margin:20px 0;">` : ''}
  <p style="color:#c0c0e0;line-height:1.8;margin-top:16px;">${esc(desc)}</p>
  <p style="margin-top:24px;"><a href="/">← 返回操作一下</a></p>
</article>
<div class="loader">載入完整文章中…</div>
</body>
</html>`;
}

// ── 主流程 ─────────────────────────────────────────────────────────────
function main() {
  const postsData = JSON.parse(fs.readFileSync(path.join(ROOT, 'posts.json'), 'utf8'));
  const posts = (postsData.posts || [])
    .filter(p => p.status === 'published')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  console.log(`\n📄 產生 ${posts.length} 個文章靜態頁面...\n`);

  const postDir = path.join(ROOT, 'post');
  if (!fs.existsSync(postDir)) fs.mkdirSync(postDir);

  let created = 0;
  for (const post of posts) {
    const slug   = post.slug || post.id;
    const dir    = path.join(postDir, String(slug));
    const file   = path.join(dir, 'index.html');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, generatePostPage(post), 'utf8');
    created++;
  }

  console.log(`  ✓ 已產生 ${created} 個 post 頁面（/post/*/index.html）`);
  console.log('\n✅ 完成！\n');
}

main();
