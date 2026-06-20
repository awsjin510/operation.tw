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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !ANTHROPIC_API_KEY) {
  console.error('❌ 缺少必要環境變數：SUPABASE_URL、SUPABASE_SERVICE_KEY、ANTHROPIC_API_KEY');
  process.exit(1);
}

const RSS_URL = 'https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml';
const SPOTIFY_SHOW = 'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_PER_RUN = 3;          // 每次執行最多生成幾篇
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

// ── 分類：用標題＋簡介關鍵字對應到現有 5 類 ──────────────────────────
function classifyCategory(title, desc) {
  const t = (title + ' ' + desc).toLowerCase();
  const has = (...kw) => kw.some((k) => t.includes(k.toLowerCase()));
  // 「閱讀操作」單集或出現書名號 → 閱讀
  if (title.includes('閱讀操作') || /《[^》]+》/.test(title)) return '閱讀';
  if (has('資安', '安全', '攻擊', '零信任', '漏洞', '勒索', '滲透', 'security', 'ransomware', 'phishing')) return '資安';
  if (has('雲端', 'aws', 'azure', 'gcp', 'kubernetes', 'serverless', '雲服務', 'cloud')) return '雲端';
  if (has('ai', '模型', 'llm', 'gpt', 'claude', 'gemini', 'prompt', '生成式', '機器學習', '人工智慧', 'agent')) return 'AI';
  if (has('成長', '習慣', '職涯', '心態', '心法', '自媒體', '經營', '管理', '情緒')) return '成長';
  return 'AI'; // 預設
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
    max_tokens: 2200,
    messages: [{
      role: 'user',
      content: `你是科技自媒體「操作一下」的部落格作者。以下是我 Podcast 的一集單集資訊，請把它延伸成一篇可獨立閱讀的繁體中文文章（不是逐字稿，而是延伸單集的重點與說明）。

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

body 要求：
- 使用 <h2>、<p>、<ul>/<li> 等 HTML 標籤，600-900 字
- 結構：開場鉤子 → 單集核心觀點整理 → 延伸補充與背景 → 對讀者的實際應用 → 結語
- 自然帶到「這集 Podcast」，語氣專業但口語、易讀
- 不要編造單集裡沒有的具體數據或引述`,
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
      .map((p) => `<li><a href="/post/${p.id}">${escHtml(p.title)}</a></li>`)
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

// ── Supabase 發布 ─────────────────────────────────────────────────
async function publishPost(post) {
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
  if (!res.ok) throw new Error(`Supabase 寫入失敗 (HTTP ${res.status}): ${await res.text()}`);
  return (await res.json())[0];
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
  if (!res.ok) throw new Error(`Supabase 更新圖片失敗 (HTTP ${res.status}): ${await res.text()}`);
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
  const res = await fetchWithTimeout(
    `${SUPABASE_URL}/rest/v1/posts?select=id,title,category,date,status,excerpt,image,views&status=eq.published&order=date.desc`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  if (!res.ok) throw new Error(`posts fetch failed: ${res.status}`);
  const all = await res.json();
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
  if (!state.existed) {
    episodes.forEach((ep) => { state.processed[ep.guid] = 0; });
    await saveState(state);
    console.log(`  ✓ 首次執行：已將 ${episodes.length} 集標記為已處理（種子化），不生成文章。`);
    console.log('    之後只有「新單集」才會自動產生文章。\n✅ 完成');
    return;
  }

  const fresh = episodes.filter((ep) => !(ep.guid in state.processed));
  console.log(`  ✓ 未處理的新單集：${fresh.length} 集`);
  if (fresh.length === 0) { console.log('✅ 沒有新單集，結束'); return; }

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
      const related = pickRelated(localPosts, category);
      const body = art.body + listenBlock(ep, related);
      const published = await publishPost({
        title: art.title,
        category,
        date: ep.date || new Date().toISOString().split('T')[0],
        status: 'published',
        excerpt: art.excerpt,
        image: '',
        body,
      });
      const postId = published.id;
      console.log(`  ✓ 已發布 ID ${postId}：[${category}] ${art.title}`);

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
  if (created > 0 && !DRY_RUN) await refreshPostsJson();
  console.log(`\n✅ 完成，本次生成 ${created} 篇`);
}

main().catch((err) => {
  console.error('\n❌ podcast-to-post 失敗：', err.message);
  process.exit(1);
});
