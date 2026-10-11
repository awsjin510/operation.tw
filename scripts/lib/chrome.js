'use strict';
// 全站共用的「外框」：導覽列（含手機選單與搜尋）、頁尾、電子報區塊、favicon。
// 首頁、Podcast 頁、文章／分類／FAQ／術語庫／搜尋頁都用這一份，改一處全站一致
// （以前首頁、Podcast 頁、靜態頁各有一套導覽，手機選單還連到不存在的 #topics、#contact）。

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CATS = [
  ['AI', 'AI'],
  ['雲端', 'Cloud'],
  ['資安', 'Cyber Security'],
  ['閱讀', '閱讀'],
  ['成長', '成長'],
];
const catHref = (c) => `/category/${encodeURIComponent(c)}/`;
// 主題插圖（scripts/tools/gen-brand-art.js 產生）
const TOPIC_ART = { AI: 'topic-ai', 雲端: 'topic-cloud', 資安: 'topic-security', 閱讀: 'topic-reading', 成長: 'topic-growth' };
const topicArt = (c) => (TOPIC_ART[c] ? `/images/brand/${TOPIC_ART[c]}.svg` : '');

const FAVICON_TAGS = '<link rel="icon" href="/favicon.ico" sizes="48x48"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">';

// 頁首。current：目前所在分類名稱，或 'podcast' / 'search' / 'faq' / 'glossary' / 'home'
function siteHeader(current = '') {
  const cur = (k) => (current === k ? ' aria-current="page"' : '');
  const catLinks = CATS.map(([c, label]) => `<a href="${catHref(c)}"${cur(c)}>${label}</a>`).join('');
  const searchForm = (id) => `<form class="st-search" action="/search/" method="get" role="search"><label class="sr-only" for="${id}">搜尋文章與 Podcast</label><input id="${id}" name="q" type="search" placeholder="搜尋文章、單集…" autocomplete="off" enterkeyhint="search"></form>`;
  return `<a class="skip-link" href="#main">跳到主要內容</a>
<header class="st-nav"><div class="st-shell">
  <a class="st-logo" href="/"><img src="/logo-72.webp" width="32" height="32" alt="">操作一下</a>
  <nav class="st-links" aria-label="主選單">${catLinks}<a href="/podcast.html"${cur('podcast')}>Podcast</a></nav>
  <div class="st-right">${searchForm('st-q')}<a class="st-cta" href="/#newsletter">訂閱電子報</a></div>
  <details class="st-menu">
    <summary aria-label="開啟選單"><span></span><span></span><span></span></summary>
    <div class="st-menu-panel">
      ${searchForm('st-q-m')}
      <p class="st-menu-h">主題</p>
      <nav aria-label="主題">${catLinks}</nav>
      <p class="st-menu-h">更多</p>
      <nav aria-label="更多"><a href="/podcast.html"${cur('podcast')}>Podcast 所有單集</a><a href="/faq/"${cur('faq')}>常見問題</a><a href="/glossary/"${cur('glossary')}>科技術語庫</a><a href="/#about">關於 Jin</a></nav>
      <a class="st-cta st-cta-block" href="/#newsletter">訂閱電子報</a>
    </div>
  </details>
</div></header>`;
}

const SOCIAL = [
  ['Instagram', 'https://www.instagram.com/operation.tw/'],
  ['Threads', 'https://www.threads.net/@operation.tw'],
  ['YouTube', 'https://www.youtube.com/@%E6%93%8D%E4%BD%9C%E4%B8%80%E4%B8%8B'],
];
const LISTEN = [
  ['Apple Podcasts', 'https://podcasts.apple.com/tw/podcast/id1620760720'],
  ['Spotify', 'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl'],
  ['RSS', 'https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml'],
];
const ext = (pairs) => pairs.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`).join('');

const SITE_FOOTER = `<footer class="st-foot"><div class="st-shell">
  <div class="st-foot-brand"><strong>操作一下</strong><p>Jin 的科技 Podcast 與部落格：把 AI、雲端與資安的變化，說得清楚也說得有用。</p></div>
  <nav aria-label="主題"><h2>主題</h2>${CATS.map(([c, l]) => `<a href="${catHref(c)}">${l}</a>`).join('')}</nav>
  <nav aria-label="探索"><h2>探索</h2><a href="/podcast.html">Podcast</a><a href="/search/">搜尋</a><a href="/faq/">常見問題</a><a href="/glossary/">術語庫</a><a href="/#about">關於 Jin</a></nav>
  <nav aria-label="收聽與追蹤"><h2>收聽與追蹤</h2>${ext(LISTEN)}${ext(SOCIAL)}</nav>
  <p class="st-foot-stats" aria-label="網站瀏覽統計">累積瀏覽 <strong data-stat="total">—</strong> 次 · 今日 <strong data-stat="visitors_today">—</strong> 位訪客、<strong data-stat="today">—</strong> 次瀏覽</p>
  <p class="st-foot-bottom">© ${'2022'}–${new Date().getFullYear()} 操作一下 · operation.tw · <a href="/feed.xml">文章 RSS</a></p>
</div></footer>`;

// 電子報區塊：文案與實際寄送一致（send-newsletter.js 在每集 Podcast 文章上架時寄一封）
const NL_TITLE = '每集一封，把這週的重點寄給你';
const NL_DESC = '新一集 Podcast 上線時寄出：本集重點整理與延伸閱讀，大約每週一封。不發廣告，信末一鍵退訂。';
function newsletterBox({ id = 'newsletter', compact = false, source = '' } = {}) {
  const inputId = `nl-${id}`;
  return `<section class="nl-box${compact ? ' nl-compact' : ''}" id="${id}" aria-labelledby="${inputId}-t">
  <h2 class="nl-t" id="${inputId}-t">${NL_TITLE}</h2>
  <p class="nl-d">${NL_DESC}</p>
  <form class="nl-form" data-source="${esc(source)}" novalidate>
    <label class="sr-only" for="${inputId}">Email</label>
    <input id="${inputId}" type="email" name="email" required placeholder="your@email.com" autocomplete="email" inputmode="email" enterkeyhint="send" aria-describedby="${inputId}-msg">
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="nl-hp">
    <button type="submit">訂閱</button>
  </form>
  <p class="nl-msg" id="${inputId}-msg" role="status" aria-live="polite"></p>
</section>`;
}

// 全站共用的小腳本（電子報送出、文章瀏覽數）
const SITE_JS = '<script src="/js/site.js" defer></script>';

module.exports = { esc, CATS, catHref, topicArt, FAVICON_TAGS, siteHeader, SITE_FOOTER, newsletterBox, SITE_JS, LISTEN };
