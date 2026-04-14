/**
 * generate-sitemap.js
 * 從 Supabase 查詢所有已發布文章，生成 sitemap.xml 和 feed.xml
 *
 * 環境變數：
 *   SUPABASE_URL        - Supabase 專案 URL
 *   SUPABASE_SERVICE_KEY - Supabase service_role key
 */

const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL = 'https://operation.tw';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ 缺少環境變數：SUPABASE_URL、SUPABASE_SERVICE_KEY');
  process.exit(1);
}

/** fetch with AbortController timeout (default 30s) */
function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ── 查詢所有已發布文章 ─────────────────────────────────────────
async function fetchPublishedPosts() {
  const url = `${SUPABASE_URL}/rest/v1/posts?select=id,title,category,date,status,excerpt,image,views&status=eq.published&order=date.desc`;
  const res = await fetchWithTimeout(url, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Supabase 查詢失敗 (HTTP ${res.status}): ${await res.text()}`);
  }

  return res.json();
}

// ── 生成 sitemap.xml ────────────────────────────────────────────
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

// ── 生成 feed.xml（RSS 2.0）─────────────────────────────────────
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

// ── 主流程 ──────────────────────────────────────────────────────
async function main() {
  console.log('📄 生成 sitemap.xml、feed.xml 和 posts.json...\n');

  const posts = await fetchPublishedPosts();
  console.log(`  ✓ 取得 ${posts.length} 篇已發布文章`);

  const rootDir = path.resolve(__dirname, '..');

  const sitemap = generateSitemap(posts);
  fs.writeFileSync(path.join(rootDir, 'sitemap.xml'), sitemap);
  console.log(`  ✓ sitemap.xml 已生成（${posts.length + 2} 個 URL）`);

  const feed = generateFeed(posts);
  fs.writeFileSync(path.join(rootDir, 'feed.xml'), feed);
  console.log(`  ✓ feed.xml 已生成（${Math.min(posts.length, 20)} 篇文章）`);

  // 靜態文章列表：前端優先從此 CDN 檔案載入，跳過 Supabase 冷啟動
  // base64 圖片轉存為實際檔案，posts.json 僅保留路徑
  const imgDir = path.join(rootDir, 'images', 'posts');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  let imgSaved = 0;
  const postsForJson = [];
  for (const p of posts) {
    if (p.image && p.image.startsWith('data:')) {
      const m = p.image.match(/^data:image\/(\w+);base64,(.+)$/s);
      if (m) {
        const filename = `post-${p.id}.jpg`;
        const rawPath = path.join(imgDir, `post-${p.id}.raw`);
        const outPath = path.join(imgDir, filename);
        fs.writeFileSync(rawPath, Buffer.from(m[2], 'base64'));
        try {
          const sharp = require('sharp');
          await sharp(rawPath).resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(outPath);
          fs.unlinkSync(rawPath);
        } catch (e) {
          fs.renameSync(rawPath, outPath);
        }
        imgSaved++;
        postsForJson.push({ ...p, image: `/images/posts/${filename}` });
        continue;
      }
    }
    postsForJson.push({ ...p });
  }
  fs.writeFileSync(
    path.join(rootDir, 'posts.json'),
    JSON.stringify({ generated: new Date().toISOString(), posts: postsForJson }, null, 0)
  );
  console.log(`  ✓ posts.json 已生成（${posts.length} 篇文章，${imgSaved} 張圖片轉存）`);

  console.log('\n✅ 完成！\n');
}

main().catch((err) => {
  console.error('\n❌ 生成失敗：', err.message);
  process.exit(1);
});
