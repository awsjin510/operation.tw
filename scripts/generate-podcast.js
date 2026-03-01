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
      apple: item.link || '',
      spot: SPOTIFY_SHOW,
    };
  });

  const outPath = path.resolve(__dirname, '..', 'episodes.json');
  fs.writeFileSync(outPath, JSON.stringify({ generated: new Date().toISOString(), episodes }));
  console.log(`  ✓ episodes.json written (${episodes.length} episodes)`);
  console.log('✅ Done!');
}

main().catch((err) => {
  console.error('❌ generate-podcast failed:', err.message);
  process.exit(1);
});
