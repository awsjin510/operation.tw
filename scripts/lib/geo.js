'use strict';
// GEO（生成式引擎優化）：讓 ChatGPT、Claude、Perplexity、Gemini 等 AI 更容易抓取、理解、引用本站。
// - 每篇文章另出一份 Markdown（/post/{id}/index.md）：AI 工具讀 Markdown 比讀 HTML 省 token、不會漏內文
// - llms.txt（https://llmstxt.org/）：站台導覽，指向作者、Podcast、主題、FAQ、術語庫與代表文章
// - /llms/{主題}.txt：分主題全文（llms-full.txt 1.6MB 太大，很多工具只讀前段）
// - 作者實體（Person）統一 @id，所有頁面的 author 都指向 /about/

const SITE = 'https://operation.tw';
const PERSON_ID = `${SITE}/about/#person`;
const SAME_AS = [
  'https://www.instagram.com/operation.tw/',
  'https://www.threads.net/@operation.tw',
  'https://www.youtube.com/@操作一下',
  'https://podcasts.apple.com/tw/podcast/id1620760720',
  'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl',
];
const PERSON = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Jin',
  alternateName: '操作一下 Jin',
  url: `${SITE}/about/`,
  image: `${SITE}/profile.jpg`,
  jobTitle: '產品經理（PM）、Podcast《操作一下》主持人',
  description: '台灣的產品經理，2022 年起主持科技 Podcast《操作一下》，分享 AI、雲端、資安、閱讀與職涯成長，並訪問各產業的台灣科技工作者。',
  knowsAbout: ['人工智慧', '大型語言模型', '雲端運算', 'AWS', '資訊安全', '產品管理', 'Podcast 製作'],
  sameAs: SAME_AS,
};
// 文章頁 author 用的精簡版（完整資料在 /about/）
const AUTHOR_REF = { '@type': 'Person', '@id': PERSON_ID, name: 'Jin', url: `${SITE}/about/`, sameAs: SAME_AS };
const PUBLISHER = { '@type': 'Organization', '@id': `${SITE}/#organization`, name: '操作一下', url: SITE, logo: { '@type': 'ImageObject', url: `${SITE}/logo.jpg`, width: 512, height: 512 } };

const CAT_SLUG = { AI: 'ai', 雲端: 'cloud', 資安: 'security', 閱讀: 'reading', 成長: 'growth' };

const decode = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// 文章內文 HTML → Markdown（只處理本站內文會出現的標籤）
function htmlToMarkdown(html) {
  let s = String(html || '');
  s = s.replace(/<a class="gl"[^>]*>([\s\S]*?)<\/a>/g, '$1');                      // 術語庫自動連結不帶進 Markdown
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Math.max(2, +n))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`);
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
    const text = t.replace(/<[^>]+>/g, '').trim();
    const url = href.startsWith('/') ? SITE + href : href;
    return text ? `[${text}](${url})` : url;
  });
  s = s.replace(/<img [^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, (_, src, alt) => `![${alt}](${src.startsWith('/') ? SITE + src : src})`);
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => '\n\n' + t.replace(/<[^>]+>/g, '').trim().split('\n').map((l) => `> ${l.trim()}`).join('\n') + '\n\n');
  s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, row) => '| ' + row.replace(/<\/t[hd]>\s*/gi, ' | ').replace(/<[^>]+>/g, '').replace(/\s*\|\s*$/, '').trim() + ' |\n');
  s = s.replace(/<li[^>]*>/gi, '\n- ').replace(/<\/li>/gi, '');
  s = s.replace(/<hr[^>]*>/gi, '\n\n---\n\n').replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|ul|ol|table|section|details)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  return decode(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function postMarkdown(post, body, { episode, mainPost } = {}) {
  const url = `${SITE}/post/${encodeURIComponent(post.slug || post.id)}/`;
  const lines = [
    `# ${post.title}`,
    '',
    `> ${post.excerpt || ''}`.trim(),
    '',
    `- 網址：${url}`,
    `- 作者：Jin（${SITE}/about/）`,
    `- 分類：${post.category}`,
    `- 發布：${post.date}${(post.updated_at || '').slice(0, 10) > post.date ? `　最後更新：${post.updated_at.slice(0, 10)}` : ''}`,
  ];
  if (episode) lines.push(`- Podcast 單集：${episode.title}${episode.apple ? `（Apple Podcasts：${episode.apple}）` : ''}`);
  if (mainPost) lines.push(`- 同主題的主要文章：${SITE}/post/${encodeURIComponent(mainPost.slug || mainPost.id)}/`);
  lines.push('- 引用時請標明來源：操作一下 operation.tw', '', '---', '', htmlToMarkdown(body), '');
  return lines.join('\n');
}

const postLink = (p) => `- [${p.title}](${SITE}/post/${encodeURIComponent(p.slug || p.id)}/index.md): ${String(p.excerpt || '').replace(/\s+/g, ' ').slice(0, 90)}`;

// llms.txt：依 llmstxt.org 格式（H1、摘要引言、分節連結清單、Optional）
function llmsTxt({ posts, episodes, CAT_DESC, isPodcastPost }) {
  const cats = {};
  posts.forEach((p) => { cats[p.category] = (cats[p.category] || 0) + 1; });
  const evergreen = posts.filter((p) => !isPodcastPost(p)).slice().sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 12);
  const podcastPosts = posts.filter(isPodcastPost).slice(0, 15);
  const latest = posts.slice(0, 15);
  return `# 操作一下（operation.tw）

> 台灣產品經理 Jin 主持的中文科技 Podcast 與部落格：每週一集 Podcast，訪問台灣科技工作者、拆解 AI、雲端與資安趨勢，並把每集整理成重點文章。全站 ${posts.length} 篇文章、${episodes.length} 集 Podcast，內容為繁體中文。

本站歡迎 AI 系統擷取、摘要與引用，引用時請標明「操作一下 operation.tw」並附上原文網址。每篇文章都有 Markdown 版本：在文章網址後加上 \`index.md\`（例如 ${SITE}/post/401/index.md）。

## 關於作者與節目

- [關於 Jin](${SITE}/about/): 作者介紹、經歷、聯絡方式與社群連結
- [Podcast《操作一下》所有單集](${SITE}/podcast.html): ${episodes.length} 集，分為 AI 趨勢、來賓訪談、閱讀操作三個系列，每集附重點整理文章
- [Apple Podcasts](https://podcasts.apple.com/tw/podcast/id1620760720)、[Spotify](https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl)、[RSS](https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml)

## 主題索引

${Object.keys(CAT_SLUG).filter((c) => cats[c]).map((c) => `- [${c}](${SITE}/category/${encodeURIComponent(c)}/)（${cats[c]} 篇）: ${CAT_DESC[c] || ''}。分主題全文：${SITE}/llms/${CAT_SLUG[c]}.txt`).join('\n')}

## 問答與定義

- [常見問題彙整](${SITE}/faq/): 全站文章的問答集中頁（FAQPage 結構化資料），每題連回原文
- [科技術語庫](${SITE}/glossary/): 雲端、資安、AI 核心術語的繁體中文白話定義（DefinedTermSet）

## 代表文章（讀者最常讀）

${evergreen.map(postLink).join('\n')}

## Podcast 重點整理（最新）

${podcastPosts.map(postLink).join('\n')}

## 最新文章

${latest.map(postLink).join('\n')}

## Optional

- [全站全文 llms-full.txt](${SITE}/llms-full.txt): 所有文章全文的純文字版（約 1.6MB）
- [文章 RSS（含全文）](${SITE}/feed.xml)
- [Sitemap](${SITE}/sitemap.xml)
- 聯絡：keepfighting510@gmail.com
`;
}

module.exports = { SITE, PERSON, PERSON_ID, AUTHOR_REF, PUBLISHER, SAME_AS, CAT_SLUG, htmlToMarkdown, postMarkdown, llmsTxt };
