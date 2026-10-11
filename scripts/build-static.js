/**
 * build-static.js
 * 靜態建置腳本：
 * 1. 為每篇文章產生 /post/{id}/index.html（含正確 meta/JSON-LD + 摘要文字）
 * 2. 更新 sitemap.xml（含全部 98 篇文章）
 * 3. 更新 llms.txt（加入前 20 篇文章連結）
 */

const fs = require('fs');
const path = require('path');
const cfdb = require('./lib/cf-db');

const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://operation.tw';

// Cloudflare Web Analytics beacon（注入所有產生的頁面）
const CF_BEACON = `<!-- Cloudflare Web Analytics --><script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "81a9db35d0634ee983873f7de67c6c4f"}'></script>`;

// 分類色：與 theme.css 同一套柔和色（舊霓虹色 #bf00ff/#00f5ff… 在深底上過亮、和首頁不一致）
const CAT_COLOR = { AI: '#a78bfa', 雲端: '#62a8ff', 資安: '#ff6b9a', 閱讀: '#f5c451', 成長: '#4ade9a' };
const CAT_ICON  = { AI: '🤖', 雲端: '☁️', 資安: '🔐', 閱讀: '📚', 成長: '🌱' };
const PODCAST_SHOW_URL = 'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl';
// 分類主題頁（Hub）的描述文案，供 /category/{類} 的 meta / H1 副標使用
const CAT_DESC = {
  雲端: 'AWS、Azure、GCP 架構實戰與雲端策略',
  資安: '零信任、滲透測試、資安觀念與威脅情報',
  AI: 'LLM 工具、Prompt、AI 工作流程與趨勢',
  閱讀: '書評、讀書心得與知識管理',
  成長: '個人成長、習慣養成與自媒體經營'
};

const { episodeCode } = require('./lib/episode');
// 讀 episodes.json，建「集數碼 → 單集」對照（供文章頁加 PodcastEpisode 結構化資料）
function loadEpisodes() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'episodes.json'), 'utf8')); } catch (e) { return { episodes: [] }; }
}
function buildEpisodeMap(eps) {
  const map = {};
  for (const e of eps) { const c = episodeCode(e.title); if (c) (map[c] = map[c] || []).push(e); }
  return map;
}

// 延伸閱讀：同主題但「不是同一則新聞」的文章 2 篇＋相關 Podcast 文章 1 篇（不足用同分類最新補）
const { titleSimilarity, textJaccard, fullText } = require('./lib/similarity');
function relatedFor(post, visible, mainId) {
  const scored = [];
  for (const c of visible) {
    if (c.id === post.id || String(c.id) === String(mainId)) continue;
    if (isDuplicate(post, c)) continue; // 同一則新聞的另一篇不算「延伸」
    const sc = textJaccard(fullText(post), fullText(c)) + titleSimilarity(post.title, c.title) * 0.3;
    if (sc > 0.02) scored.push({ c, sc });
  }
  scored.sort((a, b) => b.sc - a.sc);
  const out = [];
  const add = (c) => { if (c && !out.includes(c) && out.length < 3) out.push(c); };
  scored.filter((x) => x.c.category === post.category && !episodeCode(x.c.title)).slice(0, 2).forEach((x) => add(x.c));
  const pod = scored.find((x) => episodeCode(x.c.title));
  if (pod) add(pod.c);
  for (const c of visible) { if (out.length >= 3) break; if (c.category === post.category && c.id !== post.id && String(c.id) !== String(mainId)) add(c); }
  return out;
}

// 同一集數碼可能對到多集（RSS 曾把兩集都編成 AI36）→ 挑發布日最接近文章日期的那集
function pickEpisode(list, postDate) {
  if (!list || !list.length) return null;
  if (list.length === 1 || !postDate) return list[0];
  const t = Date.parse(postDate);
  return list.reduce((best, e) =>
    Math.abs(Date.parse(e.date) - t) < Math.abs(Date.parse(best.date) - t) ? e : best);
}

// ── 術語庫：錨點與文章內自動連結 ─────────────────────────────────
const glossaryAnchor = (t) => 'term-' + String(t.en || t.term).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
function loadGlossary() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'glossary.json'), 'utf8')).terms || []; } catch (e) { return []; }
}
// 每個術語做成 {re, href}：中文術語直接比對；英文縮寫（≥3 字元）用字邊界比對，避免把 "AI" 這種太泛的詞也連
const GLOSSARY_LINKS = loadGlossary().flatMap((t) => {
  const href = `/glossary/#${glossaryAnchor(t)}`;
  const out = [{ en: 0, key: t.term, re: new RegExp(t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), href, title: t.term }];
  if (t.en && t.en.length >= 3) out.push({ en: 1, key: t.term, re: new RegExp(`\\b${t.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`), href, title: t.term });
  return out;
}).sort((a, b) => (a.en - b.en) || (b.re.source.length - a.re.source.length)); // 中文術語優先、長詞優先
// 只改內文段落／清單裡「不在連結、標題、程式碼中」的文字；同一術語只連第一次、整篇最多 5 個
function linkGlossaryTerms(html) {
  if (!GLOSSARY_LINKS.length || !html) return html;
  html = html.replace(/<a class="gl"[^>]*>([\s\S]*?)<\/a>/g, '$1'); // 先拿掉上次加的（本機建置會沿用既有靜態頁內文）
  const done = new Set();
  let budget = 5, skip = 0;
  return html.split(/(<[^>]+>)/).map((part) => {
    if (part.startsWith('<')) {
      const m = part.match(/^<(\/?)(a|h[1-6]|code|pre|summary|figcaption)\b/i);
      if (m) skip += m[1] ? -1 : 1;
      return part;
    }
    if (skip > 0 || budget <= 0 || !part.trim()) return part;
    for (const g of GLOSSARY_LINKS) {
      if (budget <= 0) break;
      if (done.has(g.key)) continue;
      const m = part.match(g.re);
      if (!m) continue;
      done.add(g.key);
      budget--;
      part = part.slice(0, m.index) + `<a class="gl" href="${g.href}" title="術語庫：${g.title}">${m[0]}</a>` + part.slice(m.index + m[0].length);
    }
    return part;
  }).join('');
}

// ── 重複主題文章自動分群 ─────────────────────────────────────────
// 自動新聞常把同一則新聞寫好幾篇（Neoclouds 11 篇、AWS 20 週年 15 篇）。
// 同分類、彼此高度相似（標題重疊 ≥0.5 或標題＋摘要 Jaccard ≥0.2，比 auto-post 擋新文的門檻更嚴）
// 的文章歸成一群，群裡「最早發布」的是主文（固定不變，不會因瀏覽數變動而換）；
// 其餘：canonical 指向主文、不進 sitemap／RSS／分類頁／首頁／延伸閱讀，文首放主文連結。
// canonical-map.json 可人工覆寫：map 指定 {重複文 id: 主文 id}，keep 列出不要被歸群的 id。
const { isDuplicate } = require('./lib/similarity');
let CANONICAL_MAP = {};
const isDupPost = (p) => !!CANONICAL_MAP[p.id];
function computeCanonicalMap(posts) {
  let manual = { map: {}, keep: [] };
  try { manual = Object.assign(manual, JSON.parse(fs.readFileSync(path.join(ROOT, 'canonical-map.json'), 'utf8'))); } catch (e) {}
  const keep = new Set((manual.keep || []).map(String));
  const pool = posts.filter((p) => !episodeCode(p.title) && !keep.has(String(p.id))); // Podcast 衍生文不歸群
  const parent = new Map(pool.map((p) => [p.id, p.id]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      if (a.category === b.category && isDuplicate(a, b, 0.5, 0.2)) parent.set(find(a.id), find(b.id));
    }
  }
  const groups = {};
  for (const p of pool) (groups[find(p.id)] = groups[find(p.id)] || []).push(p);
  const map = {};
  for (const g of Object.values(groups)) {
    if (g.length < 2) continue;
    g.sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id));
    for (const p of g.slice(1)) map[p.id] = g[0].id;
  }
  for (const [k, v] of Object.entries(manual.map || {})) map[k] = v;
  return map;
}

const chrome = require('./lib/chrome');
const { FAVICON_TAGS, siteHeader, SITE_FOOTER, newsletterBox, catHref, topicArt } = chrome;
const pages = require('./lib/pages');

// 內容日期：以文章的 updated_at（沒有就用發文日）為準，讓 sitemap lastmod 與 JSON-LD dateModified 一致
const postModified = (p) => ((p.updated_at || '').slice(0, 10) || p.date || '');
const latestDate = (posts) => posts.reduce((m, p) => { const d = postModified(p); return d > m ? d : m; }, '');

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
// 從內文「常見問題」段落擷取 Q&A（<h2>常見問題</h2> 後成對的 <h3>問</h3><p>答</p>）
function extractFaq(body) {
  if (!body) return [];
  const i = body.search(/<h2[^>]*>\s*常見問題/);
  if (i < 0) return [];
  const seg = body.slice(i);
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/g;
  const out = [];
  let m;
  while ((m = re.exec(seg)) && out.length < 8) {
    const q = stripTags(m[1]), a = stripTags(m[2]);
    if (q && a) out.push({ q, a });
  }
  return out;
}

function loadPosts() {
  const raw = fs.readFileSync(path.join(ROOT, 'posts.json'), 'utf8');
  const data = JSON.parse(raw);
  return (data.posts || [])
    .filter(p => p.status === 'published')
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// ── 從 h2/h3 自動產生文章目錄（錨點）；少於 3 個標題就不顯示 ──────────
function buildToc(body) {
  const items = [];
  let i = 0;
  const withIds = String(body).replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (m, lvl, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text) return m;
    i++;
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/);
    if (idMatch) { items.push({ lvl: Number(lvl), id: idMatch[1], text }); return m; }
    const id = `sec-${i}`;
    items.push({ lvl: Number(lvl), id, text });
    return `<h${lvl}${attrs} id="${id}">${inner}</h${lvl}>`;
  });
  if (items.length < 3) return { body, toc: '' };
  const lis = items.map(it => `<li class="toc-l${it.lvl}"><a href="#${it.id}">${esc(it.text)}</a></li>`).join('');
  const toc = `<nav class="toc" aria-label="文章目錄"><div class="toc-h">📑 目錄</div><ul>${lis}</ul></nav>`;
  return { body: withIds, toc };
}

// ── 產生個別文章 stub 頁 ────────────────────────────────────────────
function generatePostPage(post, body, episode, neighbors, mainPost, related = []) {
  body = body || '';
  // 文末收聽區塊是發文當下寫進 D1 的：Apple 只連到節目頁、Spotify 是用「當時的單集標題」搜尋。
  // 這裡依 episodes.json 的最新資料改寫成該集的 Apple 單集頁與目前標題，不必回頭改 D1。
  body = linkGlossaryTerms(body);
  if (episode) {
    if (episode.apple) body = body.replace(/https:\/\/podcasts\.apple\.com\/podcast\/1620760720(?=["'])/g, episode.apple);
    if (episode.spot) body = body.replace(/https:\/\/open\.spotify\.com\/search\/[^"'\s]+/g, episode.spot);
  }
  const { body: bodyWithToc, toc } = buildToc(body);
  body = bodyWithToc;
  const L = neighbors && neighbors.newer, R = neighbors && neighbors.older;
  const postNav = (L || R) ? `<nav class="post-nav">
      ${L ? `<a class="pn" href="/post/${encodeURIComponent(L.slug || L.id)}/"><span>← 上一篇</span><b>${esc(L.title)}</b></a>` : '<span></span>'}
      ${R ? `<a class="pn pn-r" href="/post/${encodeURIComponent(R.slug || R.id)}/"><span>下一篇 →</span><b>${esc(R.title)}</b></a>` : '<span></span>'}
    </nav>` : '';
  const slug  = post.slug || post.id;
  const url   = `${SITE_URL}/post/${encodeURIComponent(slug)}/`;
  const img   = post.image ? `${SITE_URL}${post.image}` : `${SITE_URL}/default.png`;
  const imgWebp = post.image ? `${SITE_URL}${post.image.replace(/\.(jpe?g|png)$/i, '.webp')}` : '';
  const desc  = post.excerpt || post.title;
  const catColor = CAT_COLOR[post.category] || '#aaa';
  const catIcon  = CAT_ICON[post.category]  || '📄';

  const graph = [
    {
      '@type': 'BlogPosting',
      '@id': url,
      headline: post.title,
      description: post.excerpt || '',
      datePublished: post.date,
      dateModified: (post.updated_at || '').slice(0, 10) || post.date,
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
        { '@type': 'ListItem', position: 1, name: '首頁',         item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: post.category,  item: `${SITE_URL}/category/${encodeURIComponent(post.category)}/` },
        { '@type': 'ListItem', position: 3, name: post.title,     item: url }
      ]
    }
  ];
  // 從內文的「常見問題」段落抽出 Q&A → FAQPage 結構化資料（SEO 問答 rich result + AI 引用）
  const faqs = extractFaq(body);
  if (faqs.length) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faqs.map(f => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a }
      }))
    });
  }
  // Podcast 衍生文章 → PodcastEpisode 結構化資料（吃 Podcast rich result、釐清實體供 AI 引用）
  if (episode) {
    const code = episodeCode(post.title);
    const num = code ? parseInt(code.replace(/\D/g, ''), 10) : null;
    const ep = {
      '@type': 'PodcastEpisode',
      '@id': `${url}#episode`,
      name: post.title,
      url,
      datePublished: episode.date || post.date,
      description: post.excerpt || '',
      image: img,
      partOfSeries: { '@type': 'PodcastSeries', name: '操作一下', url: PODCAST_SHOW_URL }
    };
    if (num) ep.episodeNumber = num;
    if (episode.dur) ep.duration = `PT${episode.dur}M`;
    if (episode.url) ep.associatedMedia = { '@type': 'MediaObject', contentUrl: episode.url, encodingFormat: 'audio/mpeg' };
    graph.push(ep);
  }
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FAVICON_TAGS}
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<title>${esc(post.title)} | 操作一下</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${mainPost ? `${SITE_URL}/post/${encodeURIComponent(mainPost.slug || mainPost.id)}/` : url}">
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
${chrome.THEME_CSS}
${CF_BEACON}
</head>
<body class="st" data-post-id="${esc(String(post.id))}">
${siteHeader(post.category)}
<main id="main" class="st-narrow st-post">
  <nav class="st-crumb" aria-label="麵包屑"><a href="/">操作一下</a> › <a href="/category/${encodeURIComponent(post.category)}/">${esc(post.category)}</a></nav>
  <article>
    <div class="badge" style="color:${catColor};background:${catColor}1a"><img src="${topicArt(post.category)}" alt="" width="20" height="20">${esc(post.category)}</div>
    <h1>${esc(post.title)}</h1>
    <div class="byline">作者 <a href="/#about" rel="author">Jin</a> · <time datetime="${esc(post.date)}">${esc(post.date)}</time>${(post.updated_at || '').slice(0, 10) > post.date ? ` · 最後更新 ${esc(post.updated_at.slice(0, 10))}` : ''}<span id="pv"></span></div>
    ${post.image ? `<picture><source type="image/webp" srcset="${esc(imgWebp)}"><img class="cover" src="${esc(img)}" alt="${esc(post.title)}" width="1200" height="630"></picture>` : ''}
    <div class="excerpt"><p>${esc(post.excerpt || '')}</p></div>
    ${episode ? `<aside class="st-listen" aria-label="收聽這一集"><span>🎧 這篇整理自 Podcast<strong>${esc(episode.title)}</strong></span><span class="st-listen-btns">${episode.apple ? `<a class="pf pf-apple" href="${esc(episode.apple)}" target="_blank" rel="noopener">Apple Podcasts</a>` : ''}${episode.spot ? `<a class="pf pf-spotify" href="${esc(episode.spot)}" target="_blank" rel="noopener">Spotify</a>` : ''}<a class="pf pf-ghost" href="/podcast.html">所有單集</a></span></aside>` : ''}
    ${mainPost ? `<p class="st-main-note">這個主題有更完整的整理：<a href="/post/${encodeURIComponent(mainPost.slug || mainPost.id)}/">${esc(mainPost.title)} →</a></p>` : ''}
    ${toc}
    <div class="post-body"><!--BODY:START-->${body}<!--BODY:END--></div>
    ${postNav}
    ${related.length ? `<section class="st-related" aria-labelledby="rel-t"><h2 id="rel-t">延伸閱讀</h2><ul>${related.map((r) => `<li><a href="/post/${encodeURIComponent(r.slug || r.id)}/"><span class="h-meta"><span class="h-cat">${esc(r.category)}</span>${episodeCode(r.title) ? '<span>🎙 Podcast</span>' : ''}</span><b>${esc(r.title)}</b></a></li>`).join('')}</ul></section>` : ''}
    ${newsletterBox({ id: 'newsletter', source: 'post' })}
  </article>
</main>
${SITE_FOOTER}
${chrome.SITE_JS}
</body>
</html>`;
}

// ── 產生分類主題頁 /category/{類}/index.html（Pillar–Cluster 彙整頁）──
// 把同一主題的所有文章互連在一起，建立主題權重、讓長尾文章更易被索引與引用。
function generateCategoryPage(cat, posts) {
  const url    = `${SITE_URL}/category/${encodeURIComponent(cat)}/`;
  const icon   = CAT_ICON[cat]  || '📂';
  const color  = CAT_COLOR[cat] || '#00f5ff';
  const lead   = CAT_DESC[cat]  || `操作一下「${cat}」主題文章`;
  const desc   = `${lead}。操作一下「${cat}」主題共 ${posts.length} 篇文章彙整。`;
  const sorted = posts.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const itemList = {
    '@type': 'ItemList',
    numberOfItems: sorted.length,
    itemListElement: sorted.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}/post/${encodeURIComponent(p.slug || p.id)}/`,
      name: p.title
    }))
  };
  const graph = [
    {
      '@type': 'CollectionPage',
      '@id': url,
      url,
      name: `${cat}文章彙整 | 操作一下`,
      description: lead,
      inLanguage: 'zh-TW',
      isPartOf: { '@type': 'WebSite', name: '操作一下', url: SITE_URL },
      mainEntity: itemList
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: cat,   item: url }
      ]
    }
  ];
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  const otherCats = Object.keys(CAT_ICON)
    .filter(c => c !== cat)
    .map(c => `<a href="/category/${encodeURIComponent(c)}/">${CAT_ICON[c]} ${esc(c)}</a>`)
    .join('');

  const list = sorted.map(p => {
    const slug = p.slug || p.id;
    const href = `/post/${encodeURIComponent(slug)}/`;
    const thumb = thumbWebp(p.image);
    const img = p.image
      ? `<a class="ci-img" href="${href}" tabindex="-1" aria-hidden="true">${thumb ? `<picture><source type="image/webp" srcset="${esc(thumb)}">` : ''}<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" width="480" height="320">${thumb ? '</picture>' : ''}</a>`
      : `<span class="ci-img"></span>`;
    return `<li class="ci">${img}<div><a class="ci-t" href="${href}">${esc(p.title)}</a>`
      + `<div class="ci-meta"><time datetime="${esc(p.date)}">${esc(p.date)}</time><span data-views-id="${esc(String(p.id))}"></span></div>`
      + (p.excerpt ? `<p class="ci-exc">${esc(p.excerpt)}</p>` : '')
      + `</div></li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FAVICON_TAGS}
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<title>${esc(cat)}文章彙整（共 ${posts.length} 篇）| 操作一下</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type"        content="website">
<meta property="og:title"       content="${esc(cat)}文章彙整 | 操作一下">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url"         content="${url}">
<meta property="og:image"       content="${SITE_URL}/default.png">
<meta property="og:locale"      content="zh_TW">
<meta name="twitter:card"        content="summary">
<meta name="twitter:title"       content="${esc(cat)}文章彙整 | 操作一下">
<meta name="twitter:description" content="${esc(desc)}">
<script type="application/ld+json">${schema}</script>
${chrome.THEME_CSS}
${CF_BEACON}
</head>
<body class="st">
${siteHeader(cat)}
<main id="main" class="st-shell" style="--cat:${color}">
  <nav class="st-crumb" aria-label="麵包屑"><a href="/">操作一下</a> › ${esc(cat)}</nav>
  <header class="st-cat-hero">
    <img class="st-cat-art" src="${topicArt(cat)}" alt="" aria-hidden="true" width="220" height="220">
    <h1>${esc(cat)}</h1>
    <p>${esc(lead)}</p>
    <p style="margin-top:10px;">共 <span class="count">${posts.length}</span> 篇文章</p>
  </header>
  <div class="list-tools"><label class="sr-only" for="cat-q">在${esc(cat)}裡搜尋</label><input id="cat-q" type="search" placeholder="在「${esc(cat)}」裡找文章…" data-filter-for="cat" autocomplete="off" enterkeyhint="search"><p class="list-status" data-status-for="cat" role="status" aria-live="polite"></p></div>
  <ul class="st-cat-list" data-list="cat" data-item=".ci" data-page="30">
${list}
  </ul>
  <div class="list-more"><button type="button" class="btn btn-ghost" data-more-for="cat" hidden>顯示更多文章</button></div>
  ${newsletterBox({ id: 'newsletter', compact: true, source: `category-${cat}` })}
  <nav class="st-catnav" aria-label="其他主題">${otherCats}</nav>
</main>
${SITE_FOOTER}
${chrome.SITE_JS}
</body>
</html>`;
}

// 本站封面 /images/posts/post-N.jpg → 卡片用的 480 寬 WebP（檔案存在才用）
function thumbWebp(image) {
  if (!image || !/^\/images\/posts\/[^/]+\.jpe?g$/i.test(image)) return '';
  const t = image.replace(/\.jpe?g$/i, '-480.webp');
  return fs.existsSync(path.join(ROOT, t)) ? t : '';
}


// ── 取得文章完整內文 ────────────────────────────────────────────────
// CI（有 Supabase 金鑰）時直接從 Supabase 拉；否則沿用「已烤入現有頁面」的內文，
// 避免在沒有金鑰的環境 build 時把內文洗成只有摘要。
const BODY_RE = /<!--BODY:START-->([\s\S]*?)<!--BODY:END-->/;
function existingBody(post) {
  try {
    const slug = String(post.slug || post.id);
    const html = fs.readFileSync(path.join(ROOT, 'post', encodeURIComponent(slug), 'index.html'), 'utf8');
    const m = html.match(BODY_RE);
    return (m && m[1]) ? m[1] : '';
  } catch (e) { return ''; }
}
async function loadBodies(posts) {
  const map = {};
  if (process.env.CF_API_BASE && process.env.CF_SERVICE_TOKEN) {
    try {
      const rows = await cfdb.getAllPostsWithBody();
      for (const r of rows) if (r && r.status === 'published' && r.body) map[r.id] = r.body;
      console.log(`  ✓ 從 Worker 取得 ${Object.keys(map).length} 篇內文`);
    } catch (e) { console.warn(`  ⚠ 取內文失敗（沿用既有靜態內文）：${e.message}`); }
  } else {
    console.log('  ℹ 無 CF_API_BASE/CF_SERVICE_TOKEN，沿用既有靜態頁內文');
  }
  for (const p of posts) {
    if (!map[p.id]) { const b = existingBody(p); if (b) map[p.id] = b; }
  }
  return map;
}

// ── 更新 sitemap.xml ────────────────────────────────────────────────
function updateSitemap(posts) {
  // lastmod 用內容實際的最後更新日，不用 build 當天：每次 build 都寫今天會讓 lastmod 失去可信度，也會製造空 commit
  const today = latestDate(posts) || new Date().toISOString().split('T')[0];
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';
  xml += `  <url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;
  xml += `  <url>\n    <loc>${SITE_URL}/podcast.html</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
  xml += `  <url>\n    <loc>${SITE_URL}/faq/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
  if (fs.existsSync(path.join(ROOT, 'glossary', 'index.html'))) {
    xml += `  <url>\n    <loc>${SITE_URL}/glossary/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
  }
  // 分類主題頁（只列出實際有文章的分類）
  const catSet = new Set(posts.map((p) => p.category).filter((c) => CAT_ICON[c]));
  let catUrls = 0;
  for (const cat of Object.keys(CAT_ICON)) {
    if (!catSet.has(cat)) continue;
    const catLast = latestDate(posts.filter((p) => p.category === cat)) || today;
    xml += `  <url>\n    <loc>${SITE_URL}/category/${encodeURIComponent(cat)}/</loc>\n    <lastmod>${catLast}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    catUrls++;
  }
  for (const p of posts) {
    if (CANONICAL_MAP[p.id]) continue; // canonical 指向別篇的重複文，不列入 sitemap
    const slug = p.slug || p.id;
    const imageTag = (p.image && p.image.startsWith('/'))
      ? `\n    <image:image><image:loc>${SITE_URL}${p.image}</image:loc></image:image>` : '';
    xml += `  <url>\n    <loc>${SITE_URL}/post/${encodeURIComponent(slug)}/</loc>\n    <lastmod>${postModified(p) || today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>${imageTag}\n  </url>\n`;
  }
  xml += '</urlset>\n';
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
  console.log(`  ✓ sitemap.xml 更新（${(xml.match(/<url>/g) || []).length} URLs，含 ${catUrls} 分類頁；略過 ${posts.filter((p) => CANONICAL_MAP[p.id]).length} 篇重複文）`);
}

// ── 更新 feed.xml ────────────────────────────────────────────────────
function updateFeed(posts) {
  const top20 = posts.slice(0, 20);
  // lastBuildDate 用最新文章日期：內容沒變就不產生 diff
  const now = new Date(latestDate(posts) || Date.now()).toUTCString();
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n';
  xml += `  <title>操作一下</title>\n  <link>${SITE_URL}</link>\n`;
  xml += `  <description>專注雲端、資安、AI領域的自媒體創作者，提供深度技術內容與知識分享</description>\n`;
  xml += `  <language>zh-TW</language>\n  <lastBuildDate>${now}</lastBuildDate>\n`;
  xml += `  <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>\n`;
  for (const p of top20) {
    const slug = p.slug || p.id;
    const link = `${SITE_URL}/post/${encodeURIComponent(slug)}/`;
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
    return `- [${p.title}](${SITE_URL}/post/${encodeURIComponent(slug)}/) — ${p.category} · ${p.date}`;
  }).join('\n');

  const content = `# 操作一下 | Operation.tw

> 專注雲端、資安、AI領域的自媒體創作者，提供深度技術文章與知識分享
> Self-media creator focusing on cloud, security, AI with in-depth articles

操作一下是專注於雲端、資安與 AI 的中文科技自媒體，由喜歡探索新趨勢、學習新事物的 PM Jin 獨立創作與維護。Jin 將碎片化的網路資訊整理成有經驗與觀點的操作指南，也邀請各產業的朋友分享他們領域的學習歷程。秉持「簡單的事情專注做，有一天世界會為了你而感動」的理念，希望每個人都能找到屬於自己最自信的操作方針。

## 核心主題

${catLines}
- **閱讀**：書評、閱讀筆記、知識管理
- **成長**：個人學習方法、自媒體經營、職涯思維

## 最新文章（共 ${posts.length} 篇）

${articleLines}

## 網站頁面（AI 系統建議優先讀取）

- [常見問題彙整](${SITE_URL}/faq/): 全站文章的問答集中頁（FAQPage 結構化），依五大主題分區、每題連回原文
- [科技術語庫](${SITE_URL}/glossary/): 雲端/資安/AI 核心術語的繁體中文定義（DefinedTermSet 結構化）
- [雲端主題索引](${SITE_URL}/category/${encodeURIComponent('雲端')}/) · [資安主題索引](${SITE_URL}/category/${encodeURIComponent('資安')}/) · [AI 主題索引](${SITE_URL}/category/AI/) · [閱讀](${SITE_URL}/category/${encodeURIComponent('閱讀')}/) · [成長](${SITE_URL}/category/${encodeURIComponent('成長')}/)
- [首頁與文章列表](${SITE_URL}/): 所有文章的入口，依主題分類瀏覽
- [Podcast 節目頁](${SITE_URL}/podcast.html): 操作一下 Podcast 節目收聽頁面
- [RSS Feed](${SITE_URL}/feed.xml): 訂閱最新文章（全文）
- [全文索引 llms-full.txt](${SITE_URL}/llms-full.txt): 全站文章全文的純文字版，供 LLM 一次擷取

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

// ── 產生 llms-full.txt：全部文章「全文」的純文字版，供 LLM 一次擷取 ──────
function htmlToText(html) {
  return String(html || '')
    .replace(/<h2[^>]*>/gi, '\n## ').replace(/<h3[^>]*>/gi, '\n### ')
    .replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|h2|h3|ul|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}
function generateLlmsFull(posts, bodies) {
  const header = `# 操作一下 | Operation.tw — 全文索引（llms-full）\n\n` +
    `> 專注雲端、資安、AI、閱讀、成長的中文科技自媒體，由 Jin 創作。\n` +
    `> 歡迎 AI 系統擷取與引用，引用時請標明來源 operation.tw。\n\n` +
    `共 ${posts.length} 篇文章。\n\n---\n\n`;
  const blocks = posts.map((p) => {
    const slug = p.slug || p.id;
    const url = `${SITE_URL}/post/${encodeURIComponent(slug)}/`;
    const text = htmlToText(bodies[p.id] || '');
    return `# ${p.title}\n${url}\n分類：${p.category} · ${p.date}\n\n${text}\n`;
  });
  fs.writeFileSync(path.join(ROOT, 'llms-full.txt'), header + blocks.join('\n---\n\n'));
  console.log(`  ✓ llms-full.txt 產生（${posts.length} 篇全文）`);
}

// ── 修補 index.html ──────────────────────────────────────────────────

// ── 產生 /faq/ 常見問題彙整頁（GEO：高密度問答 + FAQPage 結構化，供 AI 引用）──
function generateFaqPage(posts, bodies) {
  const CAT_ORDER = ['AI', '雲端', '資安', '閱讀', '成長'];
  const byCat = {}; // cat → [{q, a, title, slug}]
  let total = 0;
  for (const p of posts) {
    const faqs = extractFaq(bodies[p.id] || '');
    if (!faqs.length) continue;
    const slug = encodeURIComponent(p.slug || p.id);
    for (const f of faqs) {
      (byCat[p.category] = byCat[p.category] || []).push({ q: f.q, a: f.a, title: p.title, slug });
      total++;
    }
  }
  if (!total) return 0;

  const url = `${SITE_URL}/faq/`;
  const allQa = Object.values(byCat).flat();
  const graph = [
    {
      '@type': 'FAQPage', '@id': `${url}#faq`, url,
      name: '常見問題彙整 | 操作一下',
      inLanguage: 'zh-TW',
      mainEntity: allQa.map(x => ({
        '@type': 'Question', name: x.q,
        acceptedAnswer: { '@type': 'Answer', text: x.a }
      }))
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: '常見問題', item: url }
      ]
    }
  ];
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  const sections = CAT_ORDER.filter(c => byCat[c]).map(cat => {
    const color = CAT_COLOR[cat] || '#00f5ff';
    const items = byCat[cat].map(x =>
      `<details class="qa"><summary>${esc(x.q)}</summary><p class="a">${esc(x.a)}</p>`
      + `<a class="src" href="/post/${x.slug}/">出自：${esc(x.title)} →</a></details>`
    ).join('\n');
    return `<section class="faq-cat" id="faq-${encodeURIComponent(cat)}" data-group><h2 style="--cat:${color}">${CAT_ICON[cat] || ''} ${esc(cat)} <small>${byCat[cat].length} 題</small></h2>${items}</section>`;
  }).join('\n');

  const desc = `操作一下五大主題（AI、雲端、資安、閱讀、成長）常見問題彙整，共 ${total} 則問答，每題連回原文。`;
  const html = `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FAVICON_TAGS}
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<title>常見問題彙整（${total} 則問答）| 操作一下</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="常見問題彙整 | 操作一下">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/default.png">
<script type="application/ld+json">${schema}</script>
${chrome.THEME_CSS}
${CF_BEACON}
</head>
<body class="st">
${siteHeader('faq')}
<main id="main" class="st-narrow s-page">
  <nav class="st-crumb" aria-label="麵包屑"><a href="/">操作一下</a> › 常見問題</nav>
  <h1>常見問題彙整</h1>
  <p class="pg-lead">五大主題共 <strong>${total}</strong> 則問答，點問題展開答案，每題都連回完整文章。</p>
  <nav class="jump" aria-label="跳到主題">${CAT_ORDER.filter(c => byCat[c]).map(c => `<a href="#faq-${encodeURIComponent(c)}">${CAT_ICON[c] || ''} ${esc(c)}</a>`).join('')}</nav>
  <div class="list-tools"><label class="sr-only" for="faq-q">搜尋問題</label><input id="faq-q" type="search" placeholder="搜尋問題或答案，例如：零信任" data-filter-for="faq" autocomplete="off" enterkeyhint="search"><p class="list-status" data-status-for="faq" role="status" aria-live="polite"></p></div>
  <div data-list="faq" data-item=".qa">${sections}</div>
  ${newsletterBox({ id: 'newsletter', compact: true, source: 'faq' })}
</main>
${SITE_FOOTER}
${chrome.SITE_JS}
</body>
</html>`;

  const dir = path.join(ROOT, 'faq');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return total;
}

// ── 產生 /glossary/ 術語庫頁（GEO：定義型內容 + DefinedTermSet 結構化）────
function generateGlossaryPage(posts) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(ROOT, 'glossary.json'), 'utf8')); }
  catch (e) { return 0; } // 尚未生成 glossary.json → 略過
  const terms = (data.terms || []).slice().sort((a, b) => a.term.localeCompare(b.term, 'zh-Hant'));
  if (!terms.length) return 0;

  const byId = {};
  posts.forEach((p) => { byId[p.id] = p; });
  const url = `${SITE_URL}/glossary/`;
  // 錨點用術語本身（穩定，新增術語不會讓既有錨點位移；文章內文會連到這些錨點）
  const anchor = (t) => glossaryAnchor(t);

  const CAT_ORDER = ['AI', '雲端', '資安', '成長', '通用'];
  const byCat = {};
  terms.forEach((t) => { (byCat[t.category] = byCat[t.category] || []).push({ ...t, _a: anchor(t) }); });

  const graph = [
    {
      '@type': 'DefinedTermSet',
      '@id': `${url}#set`,
      name: '操作一下科技術語庫',
      description: '雲端、資安、AI 領域核心術語的繁體中文定義',
      url,
      inLanguage: 'zh-TW',
      hasDefinedTerm: terms.map((t, i) => ({
        '@type': 'DefinedTerm',
        name: t.term,
        ...(t.en ? { alternateName: t.en } : {}),
        description: t.def,
        url: `${url}#${anchor(t)}`,
        inDefinedTermSet: `${url}#set`
      }))
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: '首頁', item: `${SITE_URL}/` },
        { '@type': 'ListItem', position: 2, name: '術語庫', item: url }
      ]
    }
  ];
  const schema = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });

  const sections = CAT_ORDER.filter((c) => byCat[c]).map((cat) => {
    const color = CAT_COLOR[cat] || '#00f5ff';
    const items = byCat[cat].map((t) => {
      const rel = (t.related || []).map((id) => byId[id])
        .filter(Boolean)
        .map((p) => `<a href="/post/${encodeURIComponent(p.slug || p.id)}/">${esc(p.title)}</a>`)
        .join('、');
      return `<div class="gt" id="${t._a}" data-cat="${esc(cat)}">
        <h3 class="gt-t">${esc(t.term)}${t.en ? ` <span class="gt-en">${esc(t.en)}</span>` : ''}</h3>
        <p class="gt-d">${esc(t.def)}</p>
        ${rel ? `<div class="gt-r">延伸閱讀：${rel}</div>` : ''}
      </div>`;
    }).join('\n');
    return `<section class="faq-cat" id="g-${encodeURIComponent(cat)}" data-group><h2 style="--cat:${color}">${CAT_ICON[cat] || '📎'} ${esc(cat)} <small>${byCat[cat].length} 條</small></h2>${items}</section>`;
  }).join('\n');

  const desc = `雲端、資安、AI 核心術語的繁體中文定義，共 ${terms.length} 條，每條附延伸閱讀。`;
  const html = `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FAVICON_TAGS}
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<title>科技術語庫（${terms.length} 條定義）| 操作一下</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:title" content="科技術語庫 | 操作一下">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE_URL}/default.png">
<script type="application/ld+json">${schema}</script>
${chrome.THEME_CSS}
${CF_BEACON}
</head>
<body class="st">
${siteHeader('glossary')}
<main id="main" class="st-narrow s-page">
  <nav class="st-crumb" aria-label="麵包屑"><a href="/">操作一下</a> › 術語庫</nav>
  <h1>科技術語庫</h1>
  <p class="pg-lead">雲端、資安、AI 核心術語的白話定義，共 <strong>${terms.length}</strong> 條，每條附站內延伸閱讀。文章裡第一次出現的術語也會連到這裡。</p>
  <nav class="jump" aria-label="跳到分類">${CAT_ORDER.filter(c => byCat[c]).map(c => `<a href="#g-${encodeURIComponent(c)}">${CAT_ICON[c] || '📎'} ${esc(c)}</a>`).join('')}</nav>
  <div class="list-tools"><label class="sr-only" for="g-q">搜尋術語</label><input id="g-q" type="search" placeholder="搜尋術語，例如：RAG、零信任" data-filter-for="glossary" autocomplete="off" enterkeyhint="search"><p class="list-status" data-status-for="glossary" role="status" aria-live="polite"></p></div>
  <div data-list="glossary" data-item=".gt">${sections}</div>
</main>
${SITE_FOOTER}
${chrome.SITE_JS}
</body>
</html>`;

  const dir = path.join(ROOT, 'glossary');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  return terms.length;
}

// ── 主流程 ──────────────────────────────────────────────────────────
// ── 為封面 JPG 產生 WebP（缺檔才轉；sharp 未安裝則略過，不影響建置）──────
function ensureCoverWebp() {
  let sharp;
  try { sharp = require('sharp'); } catch { console.log('  ⚠ 未安裝 sharp，略過 WebP 產生'); return Promise.resolve(); }
  const dir = path.join(ROOT, 'images', 'posts');
  if (!fs.existsSync(dir)) return Promise.resolve();
  const jpgs = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f));
  // 兩種尺寸：原尺寸 .webp（文章頁封面）、480 寬 -480.webp（首頁／分類頁卡片縮圖，卡片實際只顯示約 150～400px）
  const jobs = [];
  for (const f of jpgs) {
    const full = path.join(dir, f.replace(/\.jpe?g$/i, '.webp'));
    const thumb = path.join(dir, f.replace(/\.jpe?g$/i, '-480.webp'));
    if (!fs.existsSync(full)) jobs.push(() => sharp(path.join(dir, f)).webp({ quality: 82 }).toFile(full));
    if (!fs.existsSync(thumb)) jobs.push(() => sharp(path.join(dir, f)).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumb));
  }
  if (!jobs.length) { console.log(`  ✓ 封面 WebP 已齊（${jpgs.length} 張 × 2 尺寸）`); return Promise.resolve(); }
  return Promise.all(jobs.map((job) => job().catch((e) => console.warn(`  ✗ WebP 轉檔失敗：${e.message}`))))
    .then(() => console.log(`  ✓ 新產生 ${jobs.length} 張封面 WebP`));
}

async function main() {
  console.log('\n🔨 operation.tw 靜態建置開始\n');

  const posts = loadPosts();
  console.log(`  📚 已載入 ${posts.length} 篇已發布文章`);
  CANONICAL_MAP = computeCanonicalMap(posts);
  const visible = posts.filter((p) => !isDupPost(p));
  console.log(`  ✓ 重複主題文章：${posts.length - visible.length} 篇 canonical 指向主文（不進首頁／分類／RSS／sitemap）\n`);

  // 0. 封面 WebP（效能：文章頁封面 <picture> 用）
  console.log('🖼️  確保封面 WebP...');
  await ensureCoverWebp();
  console.log();

  // 1. 產生個別文章頁（含完整內文，供搜尋引擎 / AI 爬蟲索引）
  console.log('📄 產生個別文章頁面...');
  const bodies = await loadBodies(posts);
  const epData = loadEpisodes();
  const episodes = epData.episodes || [];
  const epMap = buildEpisodeMap(episodes);
  // 單集 ↔ 文章：每集記下對應的重點整理文章（Podcast 頁、首頁、搜尋用）
  for (const e of episodes) delete e.post;
  for (const p of [...posts].reverse()) { // 由舊到新：同一集若有多篇，保留最早那篇
    const ep = pickEpisode(epMap[episodeCode(p.title)], p.date);
    if (ep && !ep.post && !isDupPost(p)) ep.post = `/post/${encodeURIComponent(p.slug || p.id)}/`;
  }
  // 同分類的「上一篇（較新）／下一篇（較舊）」，提升 pages/session（跳過重複文）
  const nbr = {};
  const byCatN = {};
  visible.forEach(p => (byCatN[p.category] = byCatN[p.category] || []).push(p));
  for (const cat in byCatN) {
    const arr = byCatN[cat]; // posts 已由新到舊
    arr.forEach((p, i) => { nbr[p.id] = { newer: arr[i - 1] || null, older: arr[i + 1] || null }; });
  }
  const postDir = path.join(ROOT, 'post');
  if (!fs.existsSync(postDir)) fs.mkdirSync(postDir);
  let generated = 0, withBody = 0, withEp = 0;
  for (const post of posts) {
    const slug = String(post.slug || post.id);
    const dir  = path.join(postDir, encodeURIComponent(slug));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const body = bodies[post.id] || '';
    if (body) withBody++;
    const episode = pickEpisode(epMap[episodeCode(post.title)], post.date);
    if (episode) withEp++;
    const mainId = CANONICAL_MAP[post.id];
    const mainPost = mainId ? posts.find((p) => String(p.id) === String(mainId)) : null;
    const related = relatedFor(post, visible, mainId);
    fs.writeFileSync(path.join(dir, 'index.html'), generatePostPage(post, body, episode, nbr[post.id] || (mainId && nbr[mainId]), mainPost, related));
    generated++;
  }
  console.log(`  ✓ 其中含完整內文：${withBody}/${generated} 篇、含 PodcastEpisode：${withEp} 篇`);
  console.log(`  ✓ 已產生 ${generated} 篇文章頁（/post/{id}/index.html）\n`);

  // 1b. 清掉已不存在（已刪除）文章的殘留靜態頁，避免孤兒頁殘留
  const validSlugs = new Set(posts.map((p) => encodeURIComponent(String(p.slug || p.id))));
  let pruned = 0;
  for (const name of fs.readdirSync(postDir)) {
    const full = path.join(postDir, name);
    if (!fs.statSync(full).isDirectory()) continue;
    if (!validSlugs.has(name)) {
      fs.rmSync(full, { recursive: true, force: true });
      pruned++;
    }
  }
  if (pruned) console.log(`  ✓ 已清除 ${pruned} 個已刪除文章的殘留靜態頁\n`);

  // 1c. 產生分類主題頁 /category/{類}/index.html（互連同主題文章，建立主題權重）
  console.log('📂 產生分類主題頁...');
  const byCat = {};
  for (const p of visible) (byCat[p.category] = byCat[p.category] || []).push(p);
  const catDir = path.join(ROOT, 'category');
  if (!fs.existsSync(catDir)) fs.mkdirSync(catDir);
  let catCount = 0;
  for (const cat of Object.keys(CAT_ICON)) {
    const list = byCat[cat] || [];
    if (!list.length) continue;
    // 目錄用「原始 UTF-8 分類名」（非 %xx 編碼）：瀏覽器請求 /category/雲端 會被解碼後對應到此檔。
    const dir = path.join(catDir, cat);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), generateCategoryPage(cat, list));
    catCount++;
  }
  console.log(`  ✓ 已產生 ${catCount} 個分類主題頁\n`);

  // 1.9 常見問題彙整頁（GEO：高密度問答供 AI 引用）
  const faqCount = generateFaqPage(posts, bodies);
  console.log(faqCount ? `  ✓ /faq/ 常見問題彙整（${faqCount} 則問答）\n` : '  · 無 FAQ 內容，略過 /faq/\n');

  // 1.95 術語庫頁（GEO：定義型內容 + DefinedTermSet）
  const glossaryCount = generateGlossaryPage(posts);
  console.log(glossaryCount ? `  ✓ /glossary/ 術語庫（${glossaryCount} 條）\n` : '  · 無 glossary.json，略過 /glossary/（先跑 Generate Glossary workflow）\n');

  // 2. 更新 sitemap.xml & feed.xml
  console.log('🗺️  更新 sitemap.xml & feed.xml...');
  updateSitemap(posts);
  updateFeed(visible);
  console.log();

  // 3. 更新 llms.txt + llms-full.txt（全文版）
  console.log('🤖 更新 llms.txt / llms-full.txt...');
  updateLlms(visible);
  generateLlmsFull(visible, bodies);
  console.log();

  // 4. 入口頁：首頁、Podcast、搜尋、404（全部靜態輸出，共用 theme.css 與 lib/chrome.js）
  console.log('🏠 產生首頁／Podcast／搜尋／404...');
  const ctx = { posts: visible, episodes, thumbWebp, CAT_ICON, CAT_DESC, CF_BEACON };
  fs.writeFileSync(path.join(ROOT, 'index.html'), pages.generateHomePage(ctx));
  fs.writeFileSync(path.join(ROOT, 'podcast.html'), pages.generatePodcastPage(ctx));
  fs.mkdirSync(path.join(ROOT, 'search'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'search', 'index.html'), pages.generateSearchPage(ctx));
  fs.writeFileSync(path.join(ROOT, '404.html'), pages.generate404(ctx));
  // 單集資料：episodes.json 補上對應文章；episodes-lite.json 給首頁／Podcast 頁（不含完整簡介）
  fs.writeFileSync(path.join(ROOT, 'episodes.json'), JSON.stringify({ ...epData, episodes }));
  fs.writeFileSync(path.join(ROOT, 'episodes-lite.json'), JSON.stringify({ episodes: pages.episodesLite(episodes) }));
  fs.writeFileSync(path.join(ROOT, 'search-index.json'), JSON.stringify(pages.searchIndex(visible, episodes)));
  console.log(`  ✓ 首頁、Podcast（${episodes.length} 集，${episodes.filter((e) => e.post).length} 集有對應文章）、搜尋、404\n`);

  console.log('✅ 建置完成！\n');
}

main().catch(err => {
  console.error('\n❌ 建置失敗：', err.message);
  console.error(err.stack);
  process.exit(1);
});
