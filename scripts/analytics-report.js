/**
 * analytics-report.js
 * 抓 Cloudflare Web Analytics（RUM）過去 24 小時數據，整理成報告，經 Resend 寄出。
 *
 * 環境變數：
 *   CLOUDFLARE_API_TOKEN   需含「Account Analytics: Read」權限
 *   CLOUDFLARE_ACCOUNT_ID  Cloudflare 帳號 ID
 *   RESEND_API_KEY         Resend API key（寄信用）
 *   REPORT_TO              收件 email（預設 keepfighting510@gmail.com）
 */
'use strict';

const ACCOUNT_TAG = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TO = process.env.REPORT_TO || 'keepfighting510@gmail.com';
const SITE_TAG = '81a9db35d0634ee983873f7de67c6c4f'; // Web Analytics beacon token = site tag
const SITE = 'operation.tw';

if (!ACCOUNT_TAG || !API_TOKEN || !RESEND_API_KEY) {
  console.error('❌ 缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / RESEND_API_KEY');
  process.exit(1);
}

const iso = (d) => d.toISOString();
const pct = (cur, prev) => {
  if (!prev) return cur ? '＋∞%' : '0%';
  const d = Math.round(((cur - prev) / prev) * 100);
  return (d >= 0 ? '＋' : '') + d + '%';
};

async function cfGraphQL() {
  const now = new Date();
  const start = new Date(now.getTime() - 24 * 3600 * 1000);
  const prevStart = new Date(now.getTime() - 48 * 3600 * 1000);
  const F = (a, b) => `{siteTag:"${SITE_TAG}",datetime_geq:"${iso(a)}",datetime_lt:"${iso(b)}"}`;
  const grp = (alias, filter, extra = '') =>
    `${alias}: rumPageloadEventsAdaptiveGroups(filter:${filter},limit:5${extra}){count sum{visits} ${extra ? 'dimensions{requestPath refererHost countryName}' : ''}}`;

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
  if (json.errors && json.errors.length) {
    throw new Error('Cloudflare GraphQL: ' + JSON.stringify(json.errors));
  }
  const acc = json.data?.viewer?.accounts?.[0];
  if (!acc) throw new Error('無資料：' + JSON.stringify(json).slice(0, 300));
  return acc;
}

function rows(list, dimKey, label) {
  const items = (list || []).filter((r) => r.dimensions?.[dimKey]);
  if (!items.length) return `<tr><td colspan="2" style="color:#888">（無資料）</td></tr>`;
  return items.map((r) =>
    `<tr><td>${esc(r.dimensions[dimKey] || '(直接/未知)')}</td><td style="text-align:right">${r.count}</td></tr>`
  ).join('');
}
const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

function buildHtml(acc, dateStr) {
  const cur = acc.cur?.[0] || { count: 0, sum: { visits: 0 } };
  const prev = acc.prev?.[0] || { count: 0, sum: { visits: 0 } };
  const views = cur.count || 0, pviews = prev.count || 0;
  const visits = cur.sum?.visits || 0, pvisits = prev.sum?.visits || 0;
  return `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e">
    <h2 style="margin:0 0 4px">📊 operation.tw 每日成效報告</h2>
    <div style="color:#888;font-size:13px;margin-bottom:18px">${dateStr}（過去 24 小時）</div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
      <tr>
        <td style="padding:12px;background:#f3f6ff;border-radius:8px">
          <div style="font-size:13px;color:#666">頁面瀏覽</div>
          <div style="font-size:26px;font-weight:700">${views}</div>
          <div style="font-size:12px;color:#888">vs 前一日 ${pct(views, pviews)}</div>
        </td>
        <td style="width:12px"></td>
        <td style="padding:12px;background:#f3f6ff;border-radius:8px">
          <div style="font-size:13px;color:#666">造訪人次</div>
          <div style="font-size:26px;font-weight:700">${visits}</div>
          <div style="font-size:12px;color:#888">vs 前一日 ${pct(visits, pvisits)}</div>
        </td>
      </tr>
    </table>

    <h3 style="margin:18px 0 6px;font-size:15px">🔥 熱門頁面</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows(acc.topPages, 'requestPath')}</table>

    <h3 style="margin:18px 0 6px;font-size:15px">↗️ 流量來源</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows(acc.topReferers, 'refererHost')}</table>

    <h3 style="margin:18px 0 6px;font-size:15px">🌏 訪客地區</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows(acc.topCountries, 'countryName')}</table>

    <div style="margin-top:22px;font-size:12px;color:#aaa">資料來源：Cloudflare Web Analytics · 自動產生</div>
  </div>`;
}

async function sendEmail(html, dateStr) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'operation.tw 報告 <onboarding@resend.dev>',
      to: [TO],
      subject: `📊 operation.tw 成效報告 ${dateStr}`,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend 寄信失敗 (HTTP ${res.status}): ${await res.text()}`);
  console.log(`✅ 報告已寄到 ${TO}`);
}

async function main() {
  const dateStr = new Date().toISOString().slice(0, 10);
  console.log(`📊 產生 ${SITE} 成效報告（${dateStr}）...`);
  const acc = await cfGraphQL();
  const html = buildHtml(acc, dateStr);
  await sendEmail(html, dateStr);
}

main().catch((err) => { console.error('❌ 失敗：', err.message); process.exit(1); });
