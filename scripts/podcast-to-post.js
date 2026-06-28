/**
 * podcast-to-post.js
 * 當 Podcast（SoundOn RSS）出現新單集時，自動用 Claude 把單集簡介延伸成一篇文章，
 * 發布到 Supabase（published），封面用單集 artwork，並更新 posts.json。
 *
 * 設計重點：
 *  - 以 RSS guid 去重（podcast-posts.json 記錄已處理的單集）。
 *  - 首次執行（無狀態檔）只「種子化」目前所有單集為已處理、不生成文章，
 *    之後只有「新單集」才會產生文章，避免一次灌爆 130+ 篇。
 *  - 每次執行最多生成 MAX_PER_RUN 篇，保護用量。
 *  - DRY_RUN=1 只印出將要做什麼，不寫 Supabase / 不寫檔。
 *
 * 環境變數（GitHub Actions Secrets）：
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY
 */

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const Parser = require('rss-parser');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const cfdb = require('./lib/cf-db');

const CF_API_BASE = process.env.CF_API_BASE;
const CF_SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';
// BACKFILL=1：補寫舊單集。跳過「首次種子化」捷徑，直接把尚未產文的舊單集
// 依序產出（每次最多 MAX_PER_RUN 篇，可重複觸發直到全部完成）。
const BACKFILL = process.env.BACKFILL === '1';

if (!CF_API_BASE || !CF_SERVICE_TOKEN || !ANTHROPIC_API_KEY) {
  console.error('❌ 缺少必要環境變數：CF_API_BASE、CF_SERVICE_TOKEN、ANTHROPIC_API_KEY');
  process.exit(1);
}

const RSS_URL = 'https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml';
const SPOTIFY_SHOW = 'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl';
const MODEL = process.env.PODCAST_MODEL || 'claude-haiku-4-5-20251001'; // 可用環境變數覆寫（backfill 用 sonnet）
const MAX_PER_RUN = parseInt(process.env.MAX_PER_RUN || '3', 10); // 每次執行最多生成幾篇
const MIN_DESC_LEN = 150;       // 簡介太短就跳過，避免硬擴寫
const STATE_PATH = path.join(__dirname, '..', 'podcast-posts.json');
const POSTS_JSON_PATH = path.join(__dirname, '..', 'posts.json');

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

function spotifySearchUrl(title) {
  return title ? 'https://open.spotify.com/search/' + encodeURIComponent(title) : SPOTIFY_SHOW;
}

// ── 從單集標題開頭抓集數碼（AI35 / EP99 / EP01…），後接分隔符 ────────────
function episodeCode(title) {
  const m = (title || '').trim().match(/^([A-Za-z]{1,6}\d{1,4})\s*[_|｜\-:：．.]/);
  return m ? m[1].toUpperCase() : '';
}

// 在乾淨標題前補上 EP 集數碼（例：AI35｜…）。已有正確前綴則不重複加。
function prefixEpisodeCode(cleanTitle, epTitle) {
  const code = episodeCode(epTitle);
  if (!code) return cleanTitle;
  const t = (cleanTitle || '').trim();
  if (t.toUpperCase().startsWith(code + '｜') || t.toUpperCase().startsWith(code + '|')) return t;
  return `${code}｜${t}`;
}

// ── 分類：用「標題」對應到現有 5 類；標題無訊號時才看簡介 ──────────────
// （簡介裡偶然出現的關鍵字——例如 AI 單集順帶提到「資安」——不該蓋過標題的主題。）
function classifyFrom(text) {
  const t = (text || '').toLowerCase();
  const has = (...kw) => kw.some((k) => t.includes(k.toLowerCase()));
  // 「閱讀操作」單集或出現書名號 → 閱讀
  if (/閱讀操作/.test(text) || /《[^》]+》/.test(text)) return '閱讀';
  if (has('資安', '安全', '攻擊', '零信任', '漏洞', '勒索', '滲透', 'security', 'ransomware', 'phishing')) return '資安';
  if (has('雲端', 'aws', 'azure', 'gcp', 'kubernetes', 'serverless', '雲服務', 'cloud')) return '雲端';
  if (has('ai', '模型', 'llm', 'gpt', 'claude', 'gemini', 'prompt', '生成式', '機器學習', '人工智慧', 'agent')) return 'AI';
  // 個人成長 / 訓練 / 生活類關鍵字（含運動、減重、自我經營等）
  if (has('成長', '習慣', '職涯', '心態', '心法', '自媒體', '經營', '管理', '情緒',
    '減重', '減脂', '減掉', '公斤', '斷食', '瘦', '健身', '重訓', '運動', '跑步', '路跑',
    '復跑', '備賽', '馬拉松', '自律', '堅持', '目標', '動機', '創作', '輸出', '魅力', '人際')) return '成長';
  return null;
}
function classifyCategory(title, desc) {
  // 標題優先；標題無訊號時才退而求其次看標題＋簡介。預設「成長」。
  return classifyFrom(title) || classifyFrom(`${title} ${desc}`) || '成長';
}

// ── 抓 RSS 單集 ────────────────────────────────────────────────────
async function fetchEpisodes() {
  const parser = new Parser({
    timeout: 20000,
    customFields: { item: [['itunes:image', 'itunesImage', { keepArray: false }]] },
  });
  const feed = await parser.parseURL(RSS_URL);
  return feed.items.map((item) => {
    let art = '';
    if (item.itunesImage) {
      art = typeof item.itunesImage === 'string'
        ? item.itunesImage
        : (item.itunesImage.$ && item.itunesImage.$.href) || '';
    }
    const guid = item.guid || item.id || item.link || item.title;
    const desc = (item.contentSnippet || item.content || '').trim();
    let date = '';
    if (item.pubDate || item.isoDate) {
      try { date = new Date(item.pubDate || item.isoDate).toISOString().split('T')[0]; } catch (_) {}
    }
    return { guid, title: (item.title || '').trim(), desc, art, apple: item.link || '', date };
  });
}

// ── 狀態檔（guid → postId）────────────────────────────────────────
async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf8');
    const json = JSON.parse(raw);
    return { processed: json.processed || {}, existed: true };
  } catch (_) {
    return { processed: {}, existed: false };
  }
}
async function saveState(state) {
  if (DRY_RUN) return;
  await fs.writeFile(STATE_PATH, JSON.stringify({ generated: new Date().toISOString(), processed: state.processed }, null, 2));
}

// ── 用 Claude 把單集延伸成文章 ────────────────────────────────────
async function generateArticle(ep, category) {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3500,
    messages: [{
      role: 'user',
      content: `你是科技自媒體「操作一下」的部落格作者。以下是我 Podcast 的一集單集資訊，請把它延伸成一篇可獨立閱讀、且對 SEO 長尾與 AI 問答引擎友善的繁體中文文章（不是逐字稿，而是延伸單集的重點與說明）。

單集標題：${ep.title}
單集分類：${category}
單集簡介 / Show notes：
${ep.desc.slice(0, 2000)}

請以純 JSON 回傳（不要 Markdown 代碼區塊、不要多餘文字）：
{
  "title": "適合文章的標題（25字以內，可改寫單集標題，不要保留 AIxx_ 之類前綴）",
  "excerpt": "文章摘要，點出本文重點（80-120字）",
  "body": "文章正文（HTML）"
}

body 要求（HTML，800-1100 字，純 HTML 標籤 <h2>/<h3>/<p>/<ul>/<li>/<strong>，不要 Markdown）：
1. 最前面放「重點整理（TL;DR）」：一段 <p><strong>重點整理</strong></p> 後接 <ul>，用 3 條 <li> 列出本文核心結論（讓讀者與 AI 一眼抓到重點）。
2. 內文用「問句式」的 <h2> 小標（例如「為什麼…？」「…代表什麼？」「如何…？」），對應讀者真的會在 Google 搜尋的問題；每段 <h2> 下接 <p> 說明。
3. 內容脈絡：單集核心觀點整理 → 延伸補充與背景 → 對讀者的實際應用；自然帶到「這集 Podcast」，語氣專業但口語、易讀。
4. 文章最後固定加一段常見問題，格式務必精確如下（供結構化資料解析）：
   <h2>常見問題</h2>
   <h3>一句真實搜尋問句？</h3><p>1-2 句直接回答</p>
   （共 3 題；每題一個 <h3> 問句緊接一個 <p> 答案）
5. 不要編造單集裡沒有的具體數據或引述。`,
    }],
  });

  const raw = (resp.content[0] && resp.content[0].text || '').trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude 回應格式錯誤：${raw.slice(0, 200)}`);
  const parsed = JSON.parse(m[0]);
  for (const f of ['title', 'excerpt', 'body']) {
    if (!parsed[f]) throw new Error(`Claude 回應缺少欄位：${f}`);
  }
  return parsed;
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── 讀本地 posts.json，挑同分類的舊文章做內部連結 ──────────────────
// 目的：讓每篇新文章把 SEO 權重與真人流量導回老集數（內部連結 / topic cluster）。
async function loadLocalPosts() {
  try {
    const raw = await fs.readFile(POSTS_JSON_PATH, 'utf8');
    const json = JSON.parse(raw);
    return (json.posts || []).filter((p) => p.status === 'published');
  } catch (_) {
    return [];
  }
}
function pickRelated(posts, category, n = 3) {
  return posts
    .filter((p) => p.category === category)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, n);
}

// ── 文末加「延伸閱讀（同主題舊文）＋ 收聽這集」引導區塊 ────────────
function listenBlock(ep, related = []) {
  let html = '\n<hr>\n';
  if (related.length) {
    const items = related
      .map((p) => `<li><a href="/post/${p.id}/">${escHtml(p.title)}</a></li>`)
      .join('\n');
    html += `<p>📚 <strong>同主題的其他單集 / 文章，延伸聽下去：</strong></p>\n<ul>\n${items}\n</ul>\n`;
  }
  const links = [];
  if (ep.apple) links.push(`<li><a href="${ep.apple}" target="_blank" rel="noopener">在 Apple Podcast 收聽這集</a></li>`);
  links.push(`<li><a href="${spotifySearchUrl(ep.title)}" target="_blank" rel="noopener">在 Spotify 收聽</a></li>`);
  links.push(`<li><a href="/podcast.html">瀏覽所有單集 →</a></li>`);
  html += `<p>🎙 <strong>這篇文章延伸自 Podcast《操作一下》。</strong>想用聽的，完整一集在這裡：</p>\n<ul>\n${links.join('\n')}\n</ul>`;
  return html;
}

// ── 發布（Cloudflare Worker）────────────────────────────────────────
async function publishPost(post) {
  return await cfdb.createPost(post);
}

async function updatePostImage(postId, imagePath) {
  await cfdb.updatePost(postId, { image: imagePath });
}

// ── 用單集 artwork 產生封面（模糊放大背景 + 置中方圖）───────────────
async function saveCoverFromArt(postId, artUrl) {
  if (!artUrl) return '';
  try {
    const resp = await fetchWithTimeout(artUrl, {}, 20000);
    if (!resp.ok) throw new Error(`art HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    const bg = await sharp(buf).resize(1200, 630, { fit: 'cover' }).blur(22).modulate({ brightness: 0.55 }).toBuffer();
    const fg = await sharp(buf).resize(540, 540, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    const outPath = path.join(__dirname, '..', 'images', 'posts', `post-${postId}.jpg`);
    await sharp(bg).composite([{ input: fg, gravity: 'center' }]).jpeg({ quality: 82 }).toFile(outPath);
    return `/images/posts/post-${postId}.jpg`;
  } catch (err) {
    console.warn(`  ⚠ 封面產生失敗（將留空，前端會用分類佔位圖）：${err.message}`);
    return '';
  }
}

async function refreshPostsJson() {
  // cfdb 內建重試；取回已發布清單後重建 posts.json。
  const all = await cfdb.getPublishedPosts();
  const lean = all.map((p) => ({ ...p, image: (p.image && p.image.startsWith('/')) ? p.image : '' }));
  await fs.writeFile(POSTS_JSON_PATH, JSON.stringify({ generated: new Date().toISOString(), posts: lean }, null, 0));
  console.log(`  ✓ posts.json 已更新（${lean.length} 篇）`);
}

// ── 主流程 ────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎙→📝 Podcast 轉文章 ${DRY_RUN ? '(DRY RUN)' : ''}\n`);

  const episodes = await fetchEpisodes();
  console.log(`  ✓ RSS 取得 ${episodes.length} 集`);

  const state = await loadState();

  // 首次執行：種子化目前所有單集為已處理，不生成文章
  // （BACKFILL 模式則跳過種子化，直接補寫舊單集）
  if (!state.existed && !BACKFILL) {
    episodes.forEach((ep) => { state.processed[ep.guid] = 0; });
    await saveState(state);
    console.log(`  ✓ 首次執行：已將 ${episodes.length} 集標記為已處理（種子化），不生成文章。`);
    console.log('    之後只有「新單集」才會自動產生文章。\n✅ 完成');
    return;
  }

  // 一般模式：只處理「沒在狀態檔裡」的新單集。
  // BACKFILL 模式：把種子化留下的占位（value 0，代表已標記但沒產文）也視為待補。
  const eligible = (ep) => {
    if (!(ep.guid in state.processed)) return true;
    if (BACKFILL && state.processed[ep.guid] === 0) return true;
    return false;
  };
  const fresh = episodes.filter(eligible);
  console.log(`  ✓ 待處理單集：${fresh.length} 集${BACKFILL ? '（BACKFILL）' : ''}（模型：${MODEL}，本次上限 ${MAX_PER_RUN}）`);
  if (fresh.length === 0) { console.log('✅ 沒有待處理單集，結束'); return; }

  // 載入現有文章，供文末「同主題延伸閱讀」做內部連結（新文帶老集數）
  const localPosts = await loadLocalPosts();

  // 由舊到新處理，最多 MAX_PER_RUN 篇
  const targets = fresh.sort((a, b) => (a.date || '').localeCompare(b.date || '')).slice(0, MAX_PER_RUN);
  let created = 0;

  for (const ep of targets) {
    console.log(`\n— 處理單集：${ep.title}`);
    if (ep.desc.length < MIN_DESC_LEN) {
      console.log(`  ↷ 簡介過短（${ep.desc.length} 字 < ${MIN_DESC_LEN}），跳過但標記已處理`);
      state.processed[ep.guid] = -1; // -1 = 跳過
      continue;
    }
    const category = classifyCategory(ep.title, ep.desc);
    console.log(`  分類：${category}`);

    if (DRY_RUN) {
      console.log('  [DRY RUN] 將呼叫 Claude 生成文章並發布（此處略過）');
      state.processed[ep.guid] = 0;
      created++;
      continue;
    }

    try {
      const art = await generateArticle(ep, category);
      const finalTitle = prefixEpisodeCode(art.title, ep.title); // 補上對應 EP 集數碼
      const related = pickRelated(localPosts, category);
      const body = art.body + listenBlock(ep, related);
      const published = await publishPost({
        title: finalTitle,
        category,
        date: ep.date || new Date().toISOString().split('T')[0],
        status: 'published',
        excerpt: art.excerpt,
        image: '',
        body,
      });
      const postId = published.id;
      console.log(`  ✓ 已發布 ID ${postId}：[${category}] ${finalTitle}`);

      const imagePath = await saveCoverFromArt(postId, ep.art);
      if (imagePath) {
        await updatePostImage(postId, imagePath);
        console.log(`  ✓ 封面：${imagePath}`);
      }
      state.processed[ep.guid] = postId;
      created++;
    } catch (err) {
      console.warn(`  ✗ 生成/發布失敗，保留為未處理下次重試：${err.message}`);
    }
  }

  await saveState(state);
  // posts.json 重建失敗不該讓整個流程失敗（文章與狀態檔都已寫好）；
  // workflow 後續的 sync-posts-json.js 會再保險重建一次。
  if (created > 0 && !DRY_RUN) {
    try {
      await refreshPostsJson();
    } catch (err) {
      console.warn(`  ⚠ posts.json 重建最終失敗（不影響已發布文章，後續 sync 會補）：${err.message}`);
    }
  }
  console.log(`\n✅ 完成，本次生成 ${created} 篇`);
}

main().catch((err) => {
  console.error('\n❌ podcast-to-post 失敗：', err.message);
  process.exit(1);
});
