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
      spot: spotifySearchUrl(item.title),
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
