/**
 * generate-podcast.js
 * 從 SoundOn RSS Feed 抓取 Podcast 集數，生成 episodes.json
 *
 * 無須環境變數，直接 fetch 公開 RSS URL
 */

'use strict';

const fs = require('fs');
const path = require('path');
const RSSParser = require('rss-parser');

const RSS_URL = 'https://feeds.soundon.fm/podcasts/aa7727c5-7aa2-4403-8a87-b91a8d842f7b.xml';
const SPOTIFY_SHOW = 'https://open.spotify.com/show/0PV8lmSxw1f7y0n6mZGSPl';
const APPLE_ID = '1620760720';
const APPLE_SHOW = `https://podcasts.apple.com/tw/podcast/id${APPLE_ID}`;

// ── Spotify 單集直連 ──────────────────────────────────────────────
// 對應表存在 spotify-episodes.json（標題 → episode id），會隨每次執行累積：
//   1. 有 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET（Spotify 開發者後台免費申請）→ 官方 API 一次抓全部單集
//   2. 沒有 → 讀公開的嵌入頁，只拿得到「最新一集」，之後每集上架時自動補上
// 對不到的單集仍用「以標題搜尋」的網址。
const SPOTIFY_SHOW_ID = '0PV8lmSxw1f7y0n6mZGSPl';
const SPOTIFY_MAP_PATH = path.resolve(__dirname, '..', 'spotify-episodes.json');
const normTitle = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally { clearTimeout(timer); }
}

async function spotifyViaApi(id, secret) {
  const tok = await (await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  })).json();
  const out = {};
  let next = `https://api.spotify.com/v1/shows/${SPOTIFY_SHOW_ID}/episodes?market=TW&limit=50`;
  while (next) {
    const page = await (await fetchJson(next, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    for (const ep of page.items || []) if (ep && ep.id) out[normTitle(ep.name)] = ep.id;
    next = page.next;
  }
  return out;
}

async function spotifyViaEmbed() {
  const html = await (await fetchJson(`https://open.spotify.com/embed/show/${SPOTIFY_SHOW_ID}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return {};
  const ent = JSON.parse(m[1]).props.pageProps.state.data.entity || {};
  return ent.type === 'episode' && ent.id ? { [normTitle(ent.name)]: ent.id } : {};
}

async function loadSpotifyMap() {
  let map = {};
  try { map = JSON.parse(fs.readFileSync(SPOTIFY_MAP_PATH, 'utf8')).episodes || {}; } catch (_) {}
  try {
    const { SPOTIFY_CLIENT_ID: id, SPOTIFY_CLIENT_SECRET: secret } = process.env;
    const found = id && secret ? await spotifyViaApi(id, secret) : await spotifyViaEmbed();
    const before = Object.keys(map).length;
    Object.assign(map, found);
    const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(SPOTIFY_MAP_PATH, JSON.stringify({ episodes: sorted }, null, 1) + '\n');
    console.log(`  ✓ Spotify 單集對應：${Object.keys(sorted).length} 集（本次新增 ${Object.keys(sorted).length - before}，來源：${id && secret ? 'API' : '嵌入頁最新一集'}）`);
    return sorted;
  } catch (err) {
    console.warn(`  ⚠ Spotify 單集對應更新失敗（沿用既有對應）：${err.message}`);
    return map;
  }
}

/**
 * 從 iTunes Lookup API 取每集的 Apple Podcasts 單集網址（公開 API、免金鑰）。
 * 以 RSS guid ↔ episodeGuid 對應；失敗時回傳空物件，按鈕退回節目頁。
 */
async function fetchAppleEpisodeUrls() {
  const url = `https://itunes.apple.com/lookup?id=${APPLE_ID}&entity=podcastEpisode&limit=300&country=tw`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const res = await fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const byGuid = {}, byTitle = {};
    for (const r of json.results || []) {
      if (r.kind !== 'podcast-episode' || !r.trackViewUrl) continue;
      // 精簡成 /id{show}?i={episode}：與完整 slug 網址等效，episodes.json 小很多
      const m = r.trackViewUrl.match(/[?&]i=(\d+)/);
      const link = m ? `${APPLE_SHOW}?i=${m[1]}` : r.trackViewUrl.replace(/&uo=\d+$/, '');
      if (r.episodeGuid) byGuid[r.episodeGuid] = link;
      if (r.trackName) byTitle[r.trackName.trim()] = link;
    }
    return { byGuid, byTitle };
  } catch (err) {
    console.warn(`  ⚠ Apple 單集網址取得失敗（改用節目頁）：${err.message}`);
    return { byGuid: {}, byTitle: {} };
  }
}

/** Build a Spotify search URL that opens Spotify searching for the episode title. */
function spotifySearchUrl(title) {
  if (!title) return SPOTIFY_SHOW;
  return 'https://open.spotify.com/search/' + encodeURIComponent(title);
}

/**
 * Parse itunes:duration to integer minutes.
 * Accepts: "HH:MM:SS", "MM:SS", or plain seconds as string/number.
 */
function parseDuration(raw) {
  if (!raw) return 0;
  const s = String(raw).trim();
  if (s.includes(':')) {
    const parts = s.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 60 + parts[1] + Math.round(parts[2] / 60);
    if (parts.length === 2) return parts[0] + Math.round(parts[1] / 60);
  }
  const totalSec = parseInt(s, 10);
  return isNaN(totalSec) ? 0 : Math.round(totalSec / 60);
}

async function main() {
  console.log('🎙 Fetching podcast RSS feed...');

  const parser = new RSSParser({
    customFields: {
      item: [
        ['itunes:image', 'itunesImage', { keepArray: false }],
        ['itunes:duration', 'itunesDuration'],
      ],
    },
  });

  let feed;
  try {
    feed = await parser.parseURL(RSS_URL);
  } catch (err) {
    console.error('❌ Failed to fetch/parse RSS:', err.message);
    process.exit(1);
  }

  console.log(`  ✓ Feed: ${feed.title}`);
  console.log(`  ✓ Episodes found: ${feed.items.length}`);

  const apple = await fetchAppleEpisodeUrls();
  const spotify = await loadSpotifyMap();

  const episodes = feed.items.map((item) => {
    // itunes:image can be a string or an object with $.href
    let art = '';
    if (item.itunesImage) {
      art = typeof item.itunesImage === 'string'
        ? item.itunesImage
        : (item.itunesImage.$ && item.itunesImage.$.href) || '';
    } else if (item.itunes && item.itunes.image) {
      art = item.itunes.image;
    }

    const rawDur = item.itunesDuration || (item.itunes && item.itunes.duration) || 0;
    const dur = parseDuration(rawDur);

    const dateRaw = item.pubDate || item.isoDate || '';
    let date = '';
    if (dateRaw) {
      try { date = new Date(dateRaw).toISOString().split('T')[0]; } catch (_) {}
    }

    return {
      title: item.title || '',
      date,
      dur,
      desc: item.contentSnippet || item.content || '',
      url: (item.enclosure && item.enclosure.url) || '',
      art,
      soundon: item.link || '', // RSS 的 item.link 是 SoundOn 播放頁（非 Apple）
      apple: apple.byGuid[item.guid] || apple.byTitle[(item.title || '').trim()] || APPLE_SHOW,
      spot: spotify[normTitle(item.title)] ? `https://open.spotify.com/episode/${spotify[normTitle(item.title)]}` : spotifySearchUrl(item.title),
    };
  });

  const outPath = path.resolve(__dirname, '..', 'episodes.json');
  // generated 用最新單集日期，而非執行時間：內容沒變就不會產生 diff（避免每 3 小時一個空 commit）
  const generated = episodes.reduce((m, e) => (e.date > m ? e.date : m), '');
  fs.writeFileSync(outPath, JSON.stringify({ generated, episodes }));
  const direct = episodes.filter((e) => e.apple !== APPLE_SHOW).length;
  console.log(`  ✓ Apple 單集直連：${direct}/${episodes.length}`);
  console.log(`  ✓ episodes.json written (${episodes.length} episodes)`);
  console.log('✅ Done!');
}

main().catch((err) => {
  console.error('❌ generate-podcast failed:', err.message);
  process.exit(1);
});
