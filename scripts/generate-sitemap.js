/**
 * generate-sitemap.js
 * 從本地 posts.json 讀取文章列表，生成 sitemap.xml 和 feed.xml
 * （posts.json 由 auto-post.js 每日自動維護，不需再查 Supabase）
 */

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://operation.tw';

// ── 從本地 posts.json 讀取已發布文章 ───────────────────────────────
function fetchPublishedPosts() {
  const postsJsonPath = path.join(__dirname, '..', 'posts.json');
  const raw = fs.readFileSync(postsJsonPath, 'utf8');
  const data = JSON.parse(raw);
  const posts = (data.posts || []).filter(p => !p.status || p.status === 'published');
  console.log(`  ✓ 從 posts.json 載入 ${posts.length} 篇已發布文章`);
  return posts;
}

// ── 生成 sitemap.xml ────────────────────────────────────────────────
function generateSitemap(posts) {
  const today = new Date().toISOString().split('T')[0];

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  // 首頁
  xml += `  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

  // Podcast
  xml += `  <url>\n    <loc>${SITE_URL}/podcast.html</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;

  // 文章
  for (const post of posts) {
    const slug = post.slug || post.id;
    const loc = `${SITE_URL}/post/${encodeURIComponent(slug)}`;
    const lastmod = post.date || today;
    xml += `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
  }

  xml += '</urlset>\n';
  return xml;
}

// ── 生成 feed.xml（RSS 2.0）─────────────────────────────────────────
function generateFeed(posts) {
  const now = new Date().toUTCString();
  const recentPosts = posts.slice(0, 20);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n';
  xml += '<channel>\n';
  xml += `  <title>操作一下</title>\n`;
  xml += `  <link>${SITE_URL}</link>\n`;
  xml += `  <description>專注雲端、資安、AI領域的自媒體創作者，提供深度技術內容與知識分享</description>\n`;
  xml += `  <language>zh-TW</language>\n`;
  xml += `  <lastBuildDate>${now}</lastBuildDate>\n`;
  xml += `  <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>\n`;

  for (const post of recentPosts) {
    const slug = post.slug || post.id;
    const link = `${SITE_URL}/post/${encodeURIComponent(slug)}`;
    const pubDate = new Date(post.date).toUTCString();
    xml += '  <item>\n';
    xml += `    <title>${escXml(post.title)}</title>\n`;
    xml += `    <link>${link}</link>\n`;
    xml += `    <guid isPermaLink="true">${link}</guid>\n`;
    xml += `    <description>${escXml(post.excerpt || '')}</description>\n`;
    xml += `    <category>${escXml(post.category)}</category>\n`;
    xml += `    <pubDate>${pubDate}</pubDate>\n`;
    xml += '  </item>\n';
  }

  xml += '</channel>\n</rss>\n';
  return xml;
}

function escXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── 主流程 ──────────────────────────────────────────────────────────
async function main() {
  console.log('📄 生成 sitemap.xml 和 feed.xml...\n');

  const posts = fetchPublishedPosts();
  const rootDir = path.resolve(__dirname, '..');

  const sitemap = generateSitemap(posts);
  fs.writeFileSync(path.join(rootDir, 'sitemap.xml'), sitemap);
  console.log(`  ✓ sitemap.xml 已生成（${posts.length + 2} 個 URL）`);

  const feed = generateFeed(posts);
  fs.writeFileSync(path.join(rootDir, 'feed.xml'), feed);
  console.log(`  ✓ feed.xml 已生成（${Math.min(posts.length, 20)} 篇文章）`);

  console.log('\n✅ 完成！\n');
}

main().catch((err) => {
  console.error('\n❌ 生成失敗：', err.message);
  process.exit(1);
});
