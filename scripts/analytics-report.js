/**
 * analytics-report.js
 * 抓 Cloudflare Web Analytics（RUM）過去 24 小時數據，整理成報告，
 * 貼到一個固定的 GitHub Issue（每天一則留言）。不需 email / 第三方服務。
 *
 * 環境變數：
 *   CLOUDFLARE_API_TOKEN   需含「Account Analytics: Read」權限
 *   CLOUDFLARE_ACCOUNT_ID  Cloudflare 帳號 ID
 *   GITHUB_TOKEN           GitHub Actions 內建（issues: write）
 *   GITHUB_REPOSITORY      owner/repo（Actions 自動帶入）
 */
'use strict';

const ACCOUNT_TAG = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const GH_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY || 'awsjin510/operation.tw';
const SITE_TAG = '81a9db35d0634ee983873f7de67c6c4f'; // Web Analytics beacon token = site tag
const ISSUE_TITLE = '📊 operation.tw 每日成效報告';

if (!ACCOUNT_TAG || !API_TOKEN || !GH_TOKEN) {
  console.error('❌ 缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / GITHUB_TOKEN');
  process.exit(1);
}

const iso = (d) => d.toISOString();
const pct = (cur, prev) => {
  if (!prev) return cur ? '🆕' : '–';
  const d = Math.round(((cur - prev) / prev) * 100);
  return (d > 0 ? `🔺＋${d}%` : d < 0 ? `🔻${d}%` : '→ 0%');
};

async function cfGraphQL() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  const prevStart = new Date(now.getTime() - 48 * 3600 * 1000);
  const F = (a, b) => `{siteTag:"${SITE_TAG}",datetime_geq:"${iso(a)}",datetime_lt:"${iso(b)}"}`;

  const query = `query {
    viewer { accounts(filter:{accountTag:"${ACCOUNT_TAG}"}) {
      cur: rumPageloadEventsAdaptiveGroups(filter:${F(start, now)},limit:1){count sum{visits}}
      prev: rumPageloadEventsAdaptiveGroups(filter:${F(prevStart, start)},limit:1){count sum{visits}}
      topPages: rumPageloadEventsAdaptiveGroups(filter:${F(start, now)},limit:8,orderBy:[count_DESC]){count dimensions{requestPath}}
      topReferers: rumPageloadEventsAdaptiveGroups(filter:${F(start, now)},limit:6,orderBy:[count_DESC]){count dimensions{refererHost}}
      topCountries: rumPageloadEventsAdaptiveGroups(filter:${F(start, now)},limit:6,orderBy:[count_DESC]){count dimensions{countryName}}
    }}
  }`;

  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  if (json.errors && json.errors.length) throw new Error('Cloudflare GraphQL: ' + JSON.stringify(json.errors));
  const acc = json.data?.viewer?.accounts?.[0];
  if (!acc) throw new Error('無資料：' + JSON.stringify(json).slice(0, 300));
  return acc;
}

function mdList(list, dimKey) {
  const items = (list || []).filter((r) => r.dimensions?.[dimKey]);
  if (!items.length) return '_（無資料）_';
  return items.map((r) => `1. \`${r.dimensions[dimKey]}\` — **${r.count}**`).join('\n');
}

function buildMarkdown(acc, dateStr) {
  const cur = acc.cur?.[0] || { count: 0, sum: { visits: 0 } };
  const prev = acc.prev?.[0] || { count: 0, sum: { visits: 0 } };
  const views = cur.count || 0, pviews = prev.count || 0;
  const visits = cur.sum?.visits || 0, pvisits = prev.sum?.visits || 0;
  return `## ${dateStr}（過去 24 小時）

| 指標 | 數值 | vs 前一日 |
|---|---:|---|
| 頁面瀏覽 | **${views}** | ${pct(views, pviews)} |
| 造訪人次 | **${visits}** | ${pct(visits, pvisits)} |

**🔥 熱門頁面**
${mdList(acc.topPages, 'requestPath')}

**↗️ 流量來源**
${mdList(acc.topReferers, 'refererHost')}

**🌏 訪客地區**
${mdList(acc.topCountries, 'countryName')}

<sub>資料來源：Cloudflare Web Analytics · 自動產生</sub>`;
}

async function gh(pathname, method = 'GET', body) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'operation-tw-analytics-report',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${pathname} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function postToIssue(md) {
  const [owner, repo] = REPO.split('/');
  // 找固定的報告 Issue（用標題比對），沒有就建一個
  const open = await gh(`/repos/${owner}/${repo}/issues?state=open&per_page=100`);
  let issue = (open || []).find((i) => i.title === ISSUE_TITLE && !i.pull_request);
  if (!issue) {
    issue = await gh(`/repos/${owner}/${repo}/issues`, 'POST', {
      title: ISSUE_TITLE,
      body: '這個 Issue 由排程自動更新，每天留言一則 operation.tw 的 Cloudflare Web Analytics 成效報告。',
    });
    console.log(`  ✓ 已建立報告 Issue #${issue.number}`);
  }
  await gh(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, 'POST', {
    body: `@${owner}\n\n${md}`,
  });
  console.log(`✅ 報告已貼到 Issue #${issue.number}`);
}

async function main() {
  const dateStr = new Date().toISOString().slice(0, 10);
  console.log(`📊 產生 operation.tw 成效報告（${dateStr}）...`);
  const acc = await cfGraphQL();
  const md = buildMarkdown(acc, dateStr);
  await postToIssue(md);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
