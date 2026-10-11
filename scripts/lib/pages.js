'use strict';
// 由 build-static 產生的「入口頁」：首頁、Podcast、搜尋、404。
// 全部是靜態 HTML（內容在 HTML 裡，不必等 JSON 下載才顯示），共用 theme.css 與 lib/chrome.js 的外框。
// 以前首頁是 index.html 裡的 SPA＋homepage-v2.js 重繪：要等 226KB JSON 才顯示、卡片點進去是另一套文章檢視、
// 手機選單連到不存在的區塊；Podcast 頁單集列表完全靠 JS、單集也不連文章。

const { esc, CATS, catHref, topicArt, FAVICON_TAGS, siteHeader, SITE_FOOTER, newsletterBox, SITE_JS } = require('./chrome');
const { episodeCode } = require('./episode');

const SITE = 'https://operation.tw';
const APPLE_SHOW = 'https://podcasts.apple.com/tw/podcast/id1620760720';
const SPOTIFY_SHOW = 'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl';
const RSS = 'https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml';

const ICO_APPLE = '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a9 9 0 0 0-3.6 17.25.75.75 0 0 0 .6-1.38 7.5 7.5 0 1 1 6 0 .75.75 0 1 0 .6 1.38A9 9 0 0 0 12 2Zm0 3.5a5.5 5.5 0 0 0-2.75 10.27.75.75 0 1 0 .75-1.3 4 4 0 1 1 4 0 .75.75 0 1 0 .75 1.3A5.5 5.5 0 0 0 12 5.5Zm0 3.25a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm0 5.25c-1.1 0-1.9.8-1.78 1.9l.5 4.6c.08.8.6 1.5 1.28 1.5s1.2-.7 1.28-1.5l.5-4.6c.12-1.1-.68-1.9-1.78-1.9Z"/></svg>';
const ICO_SPOT = '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.43a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.22c3.81-.87 7.09-.5 9.72 1.12.3.18.39.57.2.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.83C14.7 8.97 9.37 8.8 6.29 9.73a.94.94 0 1 1-.54-1.8c3.53-1.07 9.42-.86 13.13 1.34a.94.94 0 0 1-.96 1.61Z"/></svg>';

const date = (s) => String(s || '').slice(0, 10);
const spotHref = (e) => e.spot || `https://open.spotify.com/search/${encodeURIComponent(e.title)}`;
const postUrl = (p) => `/post/${encodeURIComponent(p.slug || p.id)}/`;
const strip = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/--\s*Hosting provided by SoundOn/i, '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { const t = strip(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// 單集系列：AI 趨勢（AI## 趨勢／雲端／資安操作）、閱讀操作、來賓訪談（EP## 達人操作）
function seriesOf(title) {
  const code = episodeCode(title);
  if (/閱讀操作/.test(title)) return 'read';
  if (/^AI/i.test(code)) return 'trend';
  if (/^EP/i.test(code) || /達人操作/.test(title)) return 'guest';
  return 'other';
}
const SERIES = { trend: 'AI 趨勢', guest: '來賓訪談', read: '閱讀操作', other: '其他' };

// 首頁、Podcast 頁、搜尋頁用的精簡單集資料（不含完整簡介；episodes.json 的 desc 佔 2/3 體積）
function episodesLite(episodes) {
  return episodes.map((e) => ({
    title: e.title, code: episodeCode(e.title), series: seriesOf(e.title), date: e.date, dur: e.dur || 0,
    art: e.art || '', url: e.url || '', apple: e.apple || APPLE_SHOW,
    // Spotify 目前只有「用標題搜尋」的網址，很長又可由標題推回 → 不存，用 spotHref() 現算
    spot: e.spot && !/\/search\//.test(e.spot) ? e.spot : '', post: e.post || '', d: clip(e.desc, 110),
  }));
}

function head({ title, desc, url, image = `${SITE}/default.png`, extra = '', schema = null, type = 'website' }) {
  return `<!DOCTYPE html>
<html lang="zh-Hant-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${FAVICON_TAGS}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<link rel="canonical" href="${url}">
<link rel="alternate" type="application/rss+xml" title="操作一下 RSS" href="${SITE}/feed.xml">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="操作一下">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:locale" content="zh_TW">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${image}">
${schema ? `<script type="application/ld+json">${JSON.stringify(schema)}</script>` : ''}
<link rel="stylesheet" href="/theme.css">
${extra}`;
}

// 平台按鈕（Apple 單集頁／Spotify／SoundOn）
function platformLinks(ep, { compact = false } = {}) {
  const t = esc(ep.title);
  const a = (cls, href, ico, label) => `<a class="pf ${cls}" href="${esc(href)}" target="_blank" rel="noopener"${compact ? ` aria-label="${label}：${t}"` : ''}>${ico}${compact ? '' : `<span>${label}</span>`}</a>`;
  return a('pf-apple', ep.apple || APPLE_SHOW, ICO_APPLE, 'Apple Podcasts') + a('pf-spotify', spotHref(ep), ICO_SPOT, 'Spotify');
}

function articleCard(p, thumbWebp, { feature = false } = {}) {
  const img = p.image || '/default.png';
  const thumb = thumbWebp(p.image);
  return `<a class="h-card${feature ? ' h-card-feature' : ''}" href="${postUrl(p)}">
  <span class="h-card-img">${thumb ? `<picture><source type="image/webp" srcset="${esc(thumb)}">` : ''}<img src="${esc(img)}" alt="" width="480" height="320" loading="lazy" decoding="async">${thumb ? '</picture>' : ''}</span>
  <span class="h-card-body"><span class="h-meta"><span class="h-cat">${esc(p.category)}</span><time datetime="${esc(date(p.date))}">${esc(date(p.date))}</time></span>
  <span class="h-card-t">${esc(p.title)}</span>
  <span class="h-card-d">${esc(clip(p.excerpt, 90))}</span></span>
</a>`;
}

function episodeRow(e) {
  const href = e.post || e.apple || APPLE_SHOW;
  const ext = !e.post;
  return `<li class="h-ep-row">
  <img src="${esc(e.art || '/logo.jpg')}" alt="" width="72" height="72" loading="lazy" decoding="async">
  <div><span class="h-meta"><span class="h-cat">${esc(e.code || SERIES[e.series])}</span><time datetime="${esc(e.date)}">${esc(e.date)}</time>${e.dur ? `<span>${e.dur} 分鐘</span>` : ''}</span>
  <a class="h-ep-t" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${esc(e.title)}</a></div>
</li>`;
}

// ── 首頁 ─────────────────────────────────────────────────────────
function generateHomePage({ posts, episodes, thumbWebp, CAT_ICON, CAT_DESC, CF_BEACON }) {
  const eps = episodesLite(episodes);
  const ep = eps[0];
  const epPost = ep && ep.post ? posts.find((p) => postUrl(p) === ep.post) : null;
  const latest = posts.filter((p) => !epPost || p.id !== epPost.id).slice(0, 6);
  const counts = {};
  posts.forEach((p) => { counts[p.category] = (counts[p.category] || 0) + 1; });
  const hours = Math.round(eps.reduce((s, e) => s + (e.dur || 0), 0) / 60);

  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE}/#website`, name: '操作一下', alternateName: 'operation.tw', url: SITE, inLanguage: 'zh-TW',
        publisher: { '@id': `${SITE}/#person` },
        potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${SITE}/search/?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
      { '@type': 'Person', '@id': `${SITE}/#person`, name: 'Jin', url: `${SITE}/#about`, image: `${SITE}/profile.jpg`, jobTitle: '產品經理 · Podcast 主持人',
        description: '喜歡探索新趨勢、學習新事物的 PM，主持 Podcast《操作一下》，分享雲端、資安、AI、閱讀與成長。',
        knowsAbout: ['雲端運算', '資訊安全', '人工智慧', 'AWS', '大型語言模型', '產品管理'],
        sameAs: ['https://www.instagram.com/operation.tw/', 'https://www.threads.net/@operation.tw', 'https://www.youtube.com/@操作一下', APPLE_SHOW] },
      { '@type': 'PodcastSeries', '@id': `${SITE}/podcast.html#series`, name: '操作一下', url: `${SITE}/podcast.html`, webFeed: RSS, author: { '@id': `${SITE}/#person` }, image: `${SITE}/logo.jpg` },
    ],
  };

  const heroCta = ep ? (ep.post || ep.apple) : '/podcast.html';
  const hero = `<section class="h-hero"><img class="h-hero-art" src="/images/brand/hero-network.svg" alt="" aria-hidden="true"><div class="st-shell h-hero-grid">
  <div class="h-hero-copy">
    <p class="h-kicker"><i></i>AI · Cloud · Cyber Security · Podcast</p>
    <h1>把複雜的科技，<span class="grad">說得清楚，也說得有用。</span></h1>
    <div class="h-host">
      <img src="/profile-160.webp" width="56" height="56" alt="Jin 的照片">
      <p><strong>我是 Jin，一位產品經理。</strong>每週一集 Podcast：訪問台灣科技工作者、拆解 AI、雲端與資安的新變化，再整理成可以直接拿來用的文章。</p>
    </div>
    <div class="h-actions">
      <a class="btn btn-primary" href="${esc(heroCta)}">▶ 收聽最新一集</a>
      <a class="btn btn-ghost" href="#newsletter">訂閱電子報</a>
    </div>
  </div>
  ${ep ? `<article class="h-ep" aria-labelledby="h-ep-t">
    <img class="h-ep-art" src="${esc(ep.art || '/logo.jpg')}" alt="" width="360" height="360" fetchpriority="high">
    <div class="h-ep-body">
      <p class="h-chip">最新單集 · ${esc(ep.date)}${ep.dur ? ` · ${ep.dur} 分鐘` : ''}</p>
      <h2 id="h-ep-t"><a href="${esc(heroCta)}">${esc(ep.title)}</a></h2>
      <p class="h-ep-d">${esc(epPost ? clip(epPost.excerpt, 120) : ep.d)}</p>
    </div>
    <div class="h-ep-actions">${ep.post ? `<a class="btn btn-small" href="${esc(ep.post)}">讀這集的重點</a>` : ''}${platformLinks(ep)}</div>
  </article>` : ''}
</div></section>`;

  const stats = `<section class="h-stats" aria-label="網站概況"><div class="st-shell h-stats-grid">
  <div><strong>${eps.length} 集</strong><span>Podcast，約 ${hours} 小時</span></div>
  <div><strong>${posts.length} 篇</strong><span>文章與單集重點</span></div>
  <div><strong>2022</strong><span>開播至今</span></div>
  <div><strong>每週</strong><span>固定更新</span></div>
</div></section>`;

  const podcast = `<section class="h-sec h-sec-band" id="podcast" aria-labelledby="h-pod-t"><div class="st-shell">
  <div class="h-head"><div><p class="h-eyebrow">Listen</p><h2 id="h-pod-t">最近幾集 Podcast</h2><p>通勤、運動時聽；想複習就讀每集的重點整理。</p></div><a class="h-more" href="/podcast.html">所有單集 →</a></div>
  <ul class="h-ep-list">${eps.slice(1, 5).map(episodeRow).join('')}</ul>
</div></section>`;

  const articles = `<section class="h-sec" id="posts" aria-labelledby="h-posts-t"><div class="st-shell">
  <div class="h-head"><div><p class="h-eyebrow">Read</p><h2 id="h-posts-t">最新文章</h2></div><a class="h-more" href="/search/">搜尋全部文章 →</a></div>
  <div class="h-grid">${latest.map((p, i) => articleCard(p, thumbWebp, { feature: i === 0 })).join('')}</div>
</div></section>`;

  const topics = `<section class="h-sec" id="topics" aria-labelledby="h-topics-t"><div class="st-shell">
  <div class="h-head"><div><p class="h-eyebrow">Topics</p><h2 id="h-topics-t">依主題探索</h2></div></div>
  <div class="h-topics">${CATS.map(([c, label]) => {
    const recent = posts.filter((p) => p.category === c).slice(0, 2);
    return `<a class="h-topic" href="${catHref(c)}"><img class="h-topic-ic" src="${topicArt(c)}" alt="" width="56" height="56" loading="lazy"><span class="h-topic-n">${esc(label)}<small>${counts[c] || 0} 篇</small></span><span class="h-topic-d">${esc(CAT_DESC[c] || '')}</span>${recent.map((p) => `<span class="h-topic-p">${esc(p.title)}</span>`).join('')}</a>`;
  }).join('')}</div>
</div></section>`;

  const about = `<section class="h-sec h-sec-band" id="about" aria-labelledby="h-about-t"><div class="st-shell h-about">
  <img src="/profile-480.webp" width="480" height="475" alt="Jin，操作一下主持人" loading="lazy" decoding="async">
  <div>
    <p class="h-eyebrow">About</p>
    <h2 id="h-about-t">我是 Jin，操作一下</h2>
    <p>一位喜歡探索新趨勢、學習新事物的 PM。常有朋友問我：「這要怎麼操作？怎麼開始？」網路上的資訊總是碎片化，於是我把它們整理成自己的版本，加入實際操作的經驗與觀點——這就是「操作一下」的起點。</p>
    <p>在這裡，我分享雲端、資安、AI、閱讀與成長的操作，也邀請各產業的朋友，聊他們領域的學習歷程。</p>
    <div class="h-actions"><a class="btn btn-ghost" href="/podcast.html">收聽 Podcast</a><a class="btn btn-ghost" href="/faq/">常見問題</a><a class="btn btn-ghost" href="mailto:keepfighting510@gmail.com">合作邀約</a></div>
  </div>
</div></section>`;

  const nl = `<section class="h-sec" aria-label="訂閱電子報"><div class="st-shell h-nl">${newsletterBox({ id: 'newsletter', source: 'home' })}</div></section>`;

  return head({
    title: '操作一下｜Jin 的 AI、雲端、資安 Podcast 與科技部落格',
    desc: '操作一下由 Jin 主持：每週一集 Podcast，訪問台灣科技工作者、拆解 AI、雲端（AWS、Azure、GCP）與資安趨勢，並整理成可以直接用的重點文章。',
    url: `${SITE}/`,
    schema,
    extra: `<meta name="google-site-verification" content="puSeWyYwLv1eXCJhWEzExzrvlq0XQV6dH9jNYkyDO4c" />
<link rel="help" type="text/markdown" href="${SITE}/llms.txt" title="LLM Information">
<script>/* 舊版 SPA 轉址留下的 /?p=/post/123 → 直接導到靜態頁 */(function(){var p=new URLSearchParams(location.search).get('p');if(p&&/^\\/[\\w\\-\\/%.]*$/.test(p))location.replace(p);})();</script>
${CF_BEACON}`,
  }) + `</head>
<body class="st st-home" data-page="home">
${siteHeader('home')}
<main id="main">
${hero}
${stats}
${podcast}
${articles}
${topics}
${about}
${nl}
</main>
${SITE_FOOTER}
${SITE_JS}
</body>
</html>
`;
}

// ── Podcast 頁 ───────────────────────────────────────────────────
function epCard(e, i) {
  const series = SERIES[e.series];
  return `<li class="p-ep" data-series="${e.series}">
  <img class="p-ep-art" src="${esc(e.art || '/logo.jpg')}" alt="" width="96" height="96" loading="lazy" decoding="async">
  <div class="p-ep-body">
    <p class="h-meta"><span class="h-cat">${esc(e.code || series)}</span><span>${esc(series)}</span><time datetime="${esc(e.date)}">${esc(e.date)}</time>${e.dur ? `<span>${e.dur} 分鐘</span>` : ''}</p>
    <h3 class="p-ep-t">${e.post ? `<a href="${esc(e.post)}">${esc(e.title)}</a>` : esc(e.title)}</h3>
    <p class="p-ep-d">${esc(e.d)}</p>
    <div class="p-ep-actions">
      ${e.url ? `<button class="btn btn-small btn-play" type="button" data-i="${i}" aria-label="播放：${esc(e.title)}">▶ 播放</button>` : ''}
      ${e.post ? `<a class="btn btn-small btn-ghost" href="${esc(e.post)}">讀重點文章</a>` : ''}
      ${platformLinks(e, { compact: true })}
    </div>
  </div>
</li>`;
}

function generatePodcastPage({ episodes, CF_BEACON }) {
  const eps = episodesLite(episodes);
  const ep = eps[0];
  const rest = eps.slice(1);
  const hours = Math.round(eps.reduce((s, e) => s + (e.dur || 0), 0) / 60);
  const counts = { trend: 0, guest: 0, read: 0, other: 0 };
  rest.forEach((e) => { counts[e.series]++; });
  const schema = {
    '@context': 'https://schema.org', '@type': 'PodcastSeries', '@id': `${SITE}/podcast.html#series`,
    name: '操作一下', url: `${SITE}/podcast.html`, webFeed: RSS, image: `${SITE}/logo.jpg`, inLanguage: 'zh-TW',
    description: 'Jin 主持的科技 Podcast：訪問台灣科技工作者、拆解 AI、雲端與資安趨勢，也聊閱讀與職涯。',
    author: { '@type': 'Person', name: 'Jin', url: `${SITE}/#about` },
    sameAs: [APPLE_SHOW, SPOTIFY_SHOW],
    hasPart: eps.filter((e) => e.post).slice(0, 20).map((e) => ({ '@type': 'PodcastEpisode', name: e.title, url: `${SITE}${e.post}`, datePublished: e.date })),
  };
  const STATIC_N = 24;
  return head({
    title: '操作一下 Podcast｜所有單集',
    desc: `Jin 主持的科技 Podcast，共 ${eps.length} 集：AI 趨勢、台灣科技人訪談、閱讀操作。Apple Podcasts、Spotify 同步收聽，每集都有重點整理文章。`,
    url: `${SITE}/podcast.html`,
    image: `${SITE}/logo.jpg`,
    schema,
    extra: CF_BEACON,
  }) + `</head>
<body class="st st-podcast" data-page="podcast">
${siteHeader('podcast')}
<main id="main">
<section class="p-hero"><img class="p-hero-art" src="/images/brand/sound-wave.svg" alt="" aria-hidden="true"><div class="st-shell p-hero-grid">
  <img class="p-cover" src="/logo.jpg" width="320" height="320" alt="操作一下 Podcast 封面">
  <div>
    <p class="h-kicker"><i></i>Operation Podcast · since 2022</p>
    <h1>操作一下 Podcast</h1>
    <p class="p-lead">每週一集。主持人 Jin 是一位產品經理，聊 AI 趨勢、訪問台灣科技工作者，也分享讀過的好書。每集都有一篇重點整理文章，聽完可以回來複習。</p>
    <div class="p-platforms">
      <a class="pf pf-apple pf-lg" href="${APPLE_SHOW}" target="_blank" rel="noopener">${ICO_APPLE}<span>Apple Podcasts</span></a>
      <a class="pf pf-spotify pf-lg" href="${SPOTIFY_SHOW}" target="_blank" rel="noopener">${ICO_SPOT}<span>Spotify</span></a>
      <a class="pf pf-ghost pf-lg" href="${RSS}" target="_blank" rel="noopener"><span>RSS</span></a>
    </div>
    <p class="p-stats"><strong>${eps.length}</strong> 集 · 約 <strong>${hours}</strong> 小時 · 2022 開播 · 3 種收聽方式</p>
  </div>
</div></section>

${ep ? `<section class="st-shell p-latest" aria-labelledby="p-latest-t">
  <img src="${esc(ep.art || '/logo.jpg')}" alt="" width="320" height="320" fetchpriority="high">
  <div>
    <p class="h-chip">最新單集 · ${esc(ep.date)}${ep.dur ? ` · ${ep.dur} 分鐘` : ''}</p>
    <h2 id="p-latest-t">${ep.post ? `<a href="${esc(ep.post)}">${esc(ep.title)}</a>` : esc(ep.title)}</h2>
    <p class="p-ep-d">${esc(ep.d)}</p>
    <div class="p-ep-actions">
      ${ep.url ? `<button class="btn btn-primary btn-play" type="button" data-i="0">▶ 立即播放</button>` : ''}
      ${ep.post ? `<a class="btn btn-ghost" href="${esc(ep.post)}">讀這集的重點</a>` : ''}
      ${platformLinks(ep)}
    </div>
  </div>
</section>` : ''}

<div class="st-shell">${newsletterBox({ id: 'newsletter', compact: true, source: 'podcast' })}</div>

<section class="st-shell p-all" aria-labelledby="p-all-t">
  <div class="h-head"><div><p class="h-eyebrow">All episodes</p><h2 id="p-all-t">探索所有單集</h2></div></div>
  <div class="p-controls">
    <label class="sr-only" for="p-q">搜尋單集</label>
    <input id="p-q" type="search" placeholder="搜尋單集標題或內容…" autocomplete="off" enterkeyhint="search">
    <div class="p-chips" role="group" aria-label="依系列篩選">
      <button type="button" class="chip" data-series="" aria-pressed="true">全部 <small>${rest.length}</small></button>
      <button type="button" class="chip" data-series="trend" aria-pressed="false">AI 趨勢 <small>${counts.trend}</small></button>
      <button type="button" class="chip" data-series="guest" aria-pressed="false">來賓訪談 <small>${counts.guest}</small></button>
      <button type="button" class="chip" data-series="read" aria-pressed="false">閱讀操作 <small>${counts.read}</small></button>
    </div>
    <label class="sr-only" for="p-sort">排序</label>
    <select id="p-sort"><option value="new">最新優先</option><option value="old">最舊優先</option><option value="long">最長優先</option><option value="short">最短優先</option></select>
  </div>
  <p class="p-count" id="p-count" role="status" aria-live="polite">共 ${rest.length} 集</p>
  <ul class="p-list" id="p-list">${rest.slice(0, STATIC_N).map((e, i) => epCard(e, i + 1)).join('')}</ul>
  <div class="p-more-wrap"><button type="button" class="btn btn-ghost" id="p-more"${rest.length <= STATIC_N ? ' hidden' : ''}>顯示更多單集</button></div>
  <noscript><p class="p-count">完整 ${eps.length} 集也可以在 <a href="${APPLE_SHOW}">Apple Podcasts</a> 收聽。</p></noscript>
</section>
</main>

<div class="p-player" id="p-player" hidden>
  <div class="p-player-row">
    <p class="p-player-t" id="p-player-t"></p>
    <button type="button" class="p-player-x" id="p-player-x" aria-label="關閉播放器">✕</button>
  </div>
  <audio id="p-audio" controls preload="none"></audio>
</div>
${SITE_FOOTER}
${SITE_JS}
<script src="/js/podcast.js" defer></script>
</body>
</html>
`;
}

// ── 搜尋頁 ───────────────────────────────────────────────────────
function generateSearchPage({ CF_BEACON }) {
  return head({
    title: '搜尋文章與 Podcast｜操作一下',
    desc: '搜尋操作一下的文章與 Podcast 單集：AI、雲端、資安、閱讀與成長。',
    url: `${SITE}/search/`,
    extra: `<meta name="robots" content="noindex, follow">${CF_BEACON}`,
  }).replace('<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">\n', '') + `</head>
<body class="st st-search" data-page="search">
${siteHeader('search')}
<main id="main" class="st-narrow s-page">
  <h1>搜尋</h1>
  <form class="s-form" action="/search/" method="get" role="search">
    <label class="sr-only" for="s-q">搜尋文章與 Podcast</label>
    <input id="s-q" name="q" type="search" placeholder="例如：NotebookLM、零信任、AWS 證照" autocomplete="off" enterkeyhint="search">
    <button type="submit" class="btn btn-primary">搜尋</button>
  </form>
  <div class="p-chips" role="group" aria-label="篩選類型">
    <button type="button" class="chip" data-type="" aria-pressed="true">全部</button>
    <button type="button" class="chip" data-type="post" aria-pressed="false">文章</button>
    <button type="button" class="chip" data-type="ep" aria-pressed="false">Podcast 單集</button>
  </div>
  <p class="p-count" id="s-count" role="status" aria-live="polite">輸入關鍵字開始搜尋。</p>
  <ol class="s-list" id="s-list"></ol>
  <noscript><p>搜尋需要 JavaScript。也可以從 <a href="/category/AI/">主題頁</a> 或 <a href="/podcast.html">Podcast</a> 瀏覽。</p></noscript>
</main>
${SITE_FOOTER}
${SITE_JS}
<script src="/js/search.js" defer></script>
</body>
</html>
`;
}

// 搜尋索引：可見文章＋所有單集（精簡欄位）
function searchIndex(posts, episodes) {
  // 有重點文章的單集併進文章那一筆（標記 p:1、把單集標題也放進可搜尋文字），不重複列兩次
  const lite = episodesLite(episodes);
  const epByPost = {};
  lite.forEach((e) => { if (e.post) epByPost[e.post] = e; });
  return {
    posts: posts.map((p) => {
      const e = epByPost[postUrl(p)];
      return { t: p.title, u: postUrl(p), c: e ? `Podcast · ${SERIES[e.series]}` : p.category, d: date(p.date), e: clip(p.excerpt, 120), ...(e ? { p: 1, k: e.title } : {}) };
    }),
    eps: lite.filter((e) => !e.post).map((e) => ({ t: e.title, u: e.apple, c: SERIES[e.series], d: e.date, e: e.d, x: 1 })),
  };
}

// ── 404 ──────────────────────────────────────────────────────────
function generate404({ posts }) {
  // 404.html 在任何路徑下都可能被送出 → 一律用絕對路徑
  return head({ title: '找不到這個頁面｜操作一下', desc: '這個頁面不存在或已搬移。', url: `${SITE}/404.html` })
    .replace('<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">', '<meta name="robots" content="noindex">') + `</head>
<body class="st st-404">
${siteHeader('')}
<main id="main" class="st-narrow s-page">
  <p class="h-eyebrow">404</p>
  <h1>找不到這個頁面</h1>
  <p>連結可能打錯了，或文章已經搬家。試試搜尋，或從下面的最新內容開始：</p>
  <form class="s-form" action="/search/" method="get" role="search">
    <label class="sr-only" for="nf-q">搜尋文章與 Podcast</label>
    <input id="nf-q" name="q" type="search" placeholder="搜尋文章、單集…" enterkeyhint="search">
    <button type="submit" class="btn btn-primary">搜尋</button>
  </form>
  <h2 class="nf-h">最新文章</h2>
  <ol class="s-list">${posts.slice(0, 6).map((p) => `<li><a href="${postUrl(p)}">${esc(p.title)}</a><span class="h-meta"><span class="h-cat">${esc(p.category)}</span><time>${esc(date(p.date))}</time></span></li>`).join('')}</ol>
  <p class="h-actions"><a class="btn btn-ghost" href="/">回首頁</a><a class="btn btn-ghost" href="/podcast.html">所有 Podcast 單集</a></p>
</main>
${SITE_FOOTER}
${SITE_JS}
</body>
</html>
`;
}

module.exports = { generateHomePage, generatePodcastPage, generateSearchPage, generate404, searchIndex, episodesLite, SERIES, postUrl };
