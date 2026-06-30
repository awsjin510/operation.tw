/**
 * send-newsletter.js
 * 新 Podcast 文章上架時,寄電子報給訂閱者(從 D1 subscribers 取清單)。
 * 由 podcast-to-post.js 在發布後呼叫;也可單獨執行測試:
 *     node scripts/send-newsletter.js 290 291      # 指定 post id
 *
 * 需要環境變數:
 *   RESEND_API_KEY    Resend 寄信金鑰(未設定 → 靜默略過,功能等同關閉)
 *   CF_API_BASE       Worker API base
 *   CF_SERVICE_TOKEN  與 Worker SERVICE_TOKEN 相同(用來簽退訂連結)
 *   NEWSLETTER_FROM   寄件者(預設 '操作一下 <hello@operation.tw>',網域需在 Resend 驗證)
 */
'use strict';

const crypto = require('crypto');
const cfdb = require('./lib/cf-db');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CF_API_BASE = (process.env.CF_API_BASE || '').replace(/\/+$/, '');
const SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN || '';
const FROM = process.env.NEWSLETTER_FROM || '操作一下 <hello@operation.tw>';
const SITE = 'https://operation.tw';

const esc = (s) => String(s == null ? '' : s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
const unsubToken = (email) => crypto.createHmac('sha256', SERVICE_TOKEN).update(email).digest('hex').slice(0, 32);
const unsubUrl = (email) => `${CF_API_BASE}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;

function buildHtml(posts, email) {
  const cards = posts.map((p) => {
    const url = `${SITE}/post/${p.id}/`;
    const cover = p.image && p.image.startsWith('/') ? `${SITE}${p.image}` : '';
    return `<tr><td style="padding:0 0 24px">
      ${cover ? `<a href="${url}"><img src="${cover}" alt="${esc(p.title)}" width="560" style="width:100%;max-width:560px;border-radius:10px;display:block"></a>` : ''}
      <h2 style="margin:16px 0 8px;font-size:20px;color:#111"><a href="${url}" style="color:#111;text-decoration:none">${esc(p.title)}</a></h2>
      <p style="margin:0 0 12px;color:#555;font-size:15px;line-height:1.6">${esc(p.excerpt || '')}</p>
      <a href="${url}" style="display:inline-block;background:#0a84ff;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-size:15px">閱讀全文 →</a>
    </td></tr>`;
  }).join('');
  const unsub = unsubUrl(email);
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px">
    <div style="text-align:center;padding-bottom:16px;border-bottom:1px solid #eee;margin-bottom:24px">
      <a href="${SITE}" style="font-size:22px;font-weight:700;color:#0a84ff;text-decoration:none">🎙 操作一下</a>
      <div style="color:#888;font-size:13px;margin-top:4px">新文章上架了</div>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0">${cards}</table>
    <div style="border-top:1px solid #eee;margin-top:24px;padding-top:16px;color:#aaa;font-size:12px;text-align:center;line-height:1.7">
      你收到這封信是因為訂閱了「操作一下」電子報。<br>
      <a href="${unsub}" style="color:#aaa">取消訂閱</a> · <a href="${SITE}" style="color:#aaa">operation.tw</a>
    </div>
  </div>`;
}

async function sendBatch(entries) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  });
  if (!res.ok) throw new Error(`Resend batch 失敗 (HTTP ${res.status}): ${await res.text()}`);
  return res.json();
}

/** posts: [{id, title, excerpt, image}] */
async function sendForPosts(posts) {
  if (!posts || !posts.length) return;
  if (!RESEND_API_KEY) { console.log('  ↪ 未設定 RESEND_API_KEY,略過電子報寄送'); return; }
  if (!CF_API_BASE || !SERVICE_TOKEN) { console.warn('  ⚠ 缺 CF_API_BASE / CF_SERVICE_TOKEN,略過電子報'); return; }

  let subscribers;
  try { subscribers = await cfdb.getSubscribers(); }
  catch (err) { console.warn(`  ⚠ 取訂閱者失敗,略過電子報:${err.message}`); return; }
  if (!subscribers.length) { console.log('  ↪ 目前沒有訂閱者'); return; }

  const subject = posts.length === 1 ? `🎙 新文章:${posts[0].title}` : `🎙 ${posts.length} 篇新文章上架`;
  const entries = subscribers.map((email) => ({
    from: FROM,
    to: [email],
    subject,
    html: buildHtml(posts, email),
    headers: { 'List-Unsubscribe': `<${unsubUrl(email)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }));

  let sent = 0;
  for (let i = 0; i < entries.length; i += 100) {
    try { await sendBatch(entries.slice(i, i + 100)); sent += Math.min(100, entries.length - i); }
    catch (err) { console.warn(`  ⚠ 批次 ${i / 100 + 1} 寄送失敗:${err.message}`); }
  }
  console.log(`  ✓ 電子報已寄給 ${sent}/${subscribers.length} 位訂閱者(${posts.length} 篇)`);
}

module.exports = { sendForPosts };

// CLI:node send-newsletter.js <id> [id...]
if (require.main === module) {
  (async () => {
    const ids = process.argv.slice(2).map((n) => parseInt(n, 10)).filter(Boolean);
    if (!ids.length) { console.error('用法:node send-newsletter.js <postId> [postId...]'); process.exit(1); }
    const all = await cfdb.getPublishedPosts();
    const posts = ids.map((id) => all.find((p) => p.id === id)).filter(Boolean)
      .map((p) => ({ id: p.id, title: p.title, excerpt: p.excerpt, image: p.image }));
    if (!posts.length) { console.error('找不到指定文章'); process.exit(1); }
    await sendForPosts(posts);
  })().catch((err) => { console.error('❌ 失敗:', err.message); process.exit(1); });
}
