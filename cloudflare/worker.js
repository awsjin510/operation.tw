/**
 * operation.tw — Cloudflare Worker API（取代 Supabase PostgREST + RPC + Auth）
 *
 * 公開端點（anon）：
 *   GET  /api/posts                  已發布文章清單（靜態 posts.json 的後援）
 *   GET  /api/posts/:id/body         單篇內文（靜態頁的後援）
 *   GET  /api/settings               公開設定 hp/about/footer
 *   POST /api/views/site             網站瀏覽 +1 → { total, today }
 *   POST /api/views/post  {id}       文章瀏覽 +1 → { views }
 *   POST /api/subscribe   {email}    電子報訂閱 → { result }
 *
 * 管理端點（需授權，前綴 /api/admin）：
 *   瀏覽器：Google 登入取得的 ID token，以 Authorization: Bearer 送出；
 *           Worker 用 Google 公鑰驗章，檢查 aud＝GOOGLE_CLIENT_ID 且 email 在白名單。
 *   GitHub Actions 等自動化：Authorization: Bearer <SERVICE_TOKEN>。
 *   GET    /api/admin/me
 *   GET    /api/admin/posts           全部文章（含草稿，不含 body）
 *   GET    /api/admin/posts/:id       單篇（含 body）
 *   POST   /api/admin/posts           新增（單筆物件或陣列）→ 回傳含 id
 *   PATCH  /api/admin/posts/:id       更新
 *   DELETE /api/admin/posts/:id       刪除單篇
 *   DELETE /api/admin/posts?all=1     清空（匯入前重置用）
 *   GET    /api/admin/settings        全部設定
 *   PUT    /api/admin/settings/:key   upsert 設定（body 即 value）
 *
 * 綁定（wrangler.toml / secrets）：
 *   env.DB                D1 binding
 *   env.ALLOWED_ORIGINS   逗號分隔的允許來源（CORS），例：https://operation.tw
 *   env.ADMIN_EMAILS      逗號分隔的管理員 Email 白名單
 *   env.GOOGLE_CLIENT_ID  Google OAuth 2.0 用戶端 ID（驗證 ID token 的 audience）
 *   env.SERVICE_TOKEN     給自動化腳本用的長隨機字串（secret）
 */

const POST_COLS = ['title', 'category', 'date', 'status', 'excerpt', 'image', 'body', 'views', 'slug'];
const LIST_COLS = 'id,title,category,date,status,excerpt,image,views,slug';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), request, env);
    try {
      const res = await route(request, env, url);
      return cors(res, request, env);
    } catch (err) {
      const status = err.status || 500;
      return cors(json({ error: err.message || 'internal error' }, status), request, env);
    }
  },
};

async function route(request, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = request.method;

  if (p === '/api/health') return json({ ok: true });

  // ── 公開 ──────────────────────────────────────────────
  if (p === '/api/posts' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `select ${LIST_COLS} from posts where status='published' order by date desc`
    ).all();
    return json({ posts: results });
  }

  let mm;
  if ((mm = p.match(/^\/api\/posts\/(\d+)\/body$/)) && m === 'GET') {
    const row = await env.DB.prepare(
      `select body from posts where id=? and status='published'`
    ).bind(+mm[1]).first();
    if (!row) throw httpError(404, 'not found');
    return json({ body: row.body });
  }

  if (p === '/api/settings' && m === 'GET') {
    const { results } = await env.DB.prepare(
      `select key, value from settings where key in ('hp','about','footer')`
    ).all();
    return json(settingsToObject(results));
  }

  if (p === '/api/views/site' && m === 'POST') {
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare(`insert into site_stats (id,count) values ('total',1)
        on conflict(id) do update set count=count+1, updated_at=datetime('now')`),
      env.DB.prepare(`insert into site_stats (id,count) values (?1,1)
        on conflict(id) do update set count=count+1, updated_at=datetime('now')`).bind(today),
    ]);
    const { results } = await env.DB.prepare(
      `select id,count from site_stats where id in ('total',?1)`
    ).bind(today).all();
    let total = 0, day = 0;
    for (const r of results) { if (r.id === 'total') total = r.count; else day = r.count; }
    return json({ total, today: day });
  }

  if (p === '/api/views/post' && m === 'POST') {
    const { id } = await readJson(request);
    if (!id) throw httpError(400, 'missing id');
    await env.DB.prepare(
      `update posts set views=views+1 where id=? and status='published'`
    ).bind(+id).run();
    const row = await env.DB.prepare(`select views from posts where id=?`).bind(+id).first();
    return json({ views: row ? row.views : null });
  }

  if (p === '/api/subscribe' && m === 'POST') {
    const body = await readJson(request);
    // honeypot：隱藏欄位被填 → 判定機器人，回假成功（不入庫）
    if (body.website) return json({ result: 'subscribed' });
    const e = String(body.email || '').trim().toLowerCase();
    if (!e || e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      return json({ result: 'invalid' });
    }
    // 每 IP 每小時最多 5 次（借 site_stats 當計數器；rl: 前綴不影響瀏覽統計，
    // 讀取皆為精確 id 查詢）
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const bucket = `rl:sub:${ip}:${new Date().toISOString().slice(0, 13)}`;
    const rl = await env.DB.prepare(
      `insert into site_stats (id,count) values (?1,1)
       on conflict(id) do update set count=count+1, updated_at=datetime('now')
       returning count`
    ).bind(bucket).first();
    if (rl && rl.count > 5) return json({ result: 'rate_limited' }, 429);
    if (rl && rl.count === 1) {
      // 新的小時桶建立時，順手清掉過期限流記錄
      await env.DB.prepare(
        `delete from site_stats where id like 'rl:%' and updated_at < datetime('now','-1 day')`
      ).run();
    }
    const r = await env.DB.prepare(
      `insert into subscribers (email) values (?) on conflict(email) do nothing`
    ).bind(e).run();
    const inserted = (r.meta && r.meta.changes) ? r.meta.changes > 0 : false;
    return json({ result: inserted ? 'subscribed' : 'exists' });
  }

  // 退訂：以 HMAC token 驗證後刪除（連結放在電子報底部）
  if (p === '/api/unsubscribe' && m === 'GET') {
    const e = String(url.searchParams.get('e') || '').trim().toLowerCase();
    const t = url.searchParams.get('t') || '';
    if (!e || !t || !env.SERVICE_TOKEN) return htmlPage('連結無效。', 400);
    const expect = (await hmacHex(env.SERVICE_TOKEN, e)).slice(0, 32);
    if (t !== expect) return htmlPage('連結無效或已失效。', 400);
    await env.DB.prepare(`delete from subscribers where email=?`).bind(e).run();
    return htmlPage('你已成功退訂,之後不會再收到「操作一下」電子報。');
  }

  // ── 管理（需授權）────────────────────────────────────
  if (p.startsWith('/api/admin/')) {
    const who = await requireAuth(request, env);

    if (p === '/api/admin/me' && m === 'GET') return json({ email: who.email, via: who.via });

    if (p === '/api/admin/subscribers' && m === 'GET') {
      const { results } = await env.DB.prepare(
        `select email from subscribers order by created_at`
      ).all();
      return json({ subscribers: (results || []).map(r => r.email) });
    }

    if (p === '/api/admin/backup' && m === 'GET') {
      const [posts, settings, stats, subs] = await Promise.all([
        env.DB.prepare(`select * from posts order by id`).all(),
        env.DB.prepare(`select * from settings`).all(),
        env.DB.prepare(`select * from site_stats where id not like 'rl:%'`).all(),
        env.DB.prepare(`select * from subscribers order by id`).all(),
      ]);
      return json({
        exported_at: new Date().toISOString(),
        posts: posts.results, settings: settings.results,
        site_stats: stats.results, subscribers: subs.results,
      });
    }

    if (p === '/api/admin/posts' && m === 'GET') {
      const cols = url.searchParams.get('include') === 'body' ? '*' : LIST_COLS;
      const { results } = await env.DB.prepare(
        `select ${cols} from posts order by date desc`
      ).all();
      return json({ posts: results });
    }

    if (p === '/api/admin/posts' && m === 'POST') {
      const body = await readJson(request);
      const rows = Array.isArray(body) ? body : [body];
      const out = [];
      for (const r of rows) out.push(await insertPost(env, r));
      return json({ posts: out });
    }

    if (p === '/api/admin/posts' && m === 'DELETE') {
      if (url.searchParams.get('all') !== '1') throw httpError(400, 'refuse to delete all without ?all=1');
      await env.DB.prepare(`delete from posts`).run();
      return json({ ok: true });
    }

    if ((mm = p.match(/^\/api\/admin\/posts\/(\d+)$/))) {
      const id = +mm[1];
      if (m === 'GET') {
        const row = await env.DB.prepare(`select * from posts where id=?`).bind(id).first();
        if (!row) throw httpError(404, 'not found');
        return json({ post: row });
      }
      if (m === 'PATCH') {
        const patch = await readJson(request);
        return json({ post: await updatePost(env, id, patch) });
      }
      if (m === 'DELETE') {
        await env.DB.prepare(`delete from posts where id=?`).bind(id).run();
        return json({ ok: true });
      }
    }

    if (p === '/api/admin/settings' && m === 'GET') {
      const { results } = await env.DB.prepare(`select key,value from settings`).all();
      return json(settingsToObject(results));
    }

    if ((mm = p.match(/^\/api\/admin\/settings\/([a-z_]+)$/)) && m === 'PUT') {
      const value = await readJson(request);
      await env.DB.prepare(
        `insert into settings (key,value) values (?1,?2)
         on conflict(key) do update set value=?2`
      ).bind(mm[1], JSON.stringify(value)).run();
      return json({ ok: true });
    }

    throw httpError(404, 'unknown admin route');
  }

  throw httpError(404, 'not found');
}

// ── DB helpers ──────────────────────────────────────────
async function insertPost(env, r) {
  const cols = [], ph = [], vals = [];
  let i = 1;
  for (const c of POST_COLS) {
    if (r[c] !== undefined) { cols.push(c); ph.push('?' + i++); vals.push(r[c]); }
  }
  if (!cols.length) throw httpError(400, 'empty post');
  const sql = `insert into posts (${cols.join(',')}) values (${ph.join(',')}) returning ${LIST_COLS}`;
  return await env.DB.prepare(sql).bind(...vals).first();
}

async function updatePost(env, id, patch) {
  const sets = [], vals = [];
  let i = 1;
  for (const c of POST_COLS) {
    if (patch[c] !== undefined) { sets.push(`${c}=?${i++}`); vals.push(patch[c]); }
  }
  if (!sets.length) throw httpError(400, 'nothing to update');
  vals.push(id);
  const sql = `update posts set ${sets.join(',')} where id=?${i} returning ${LIST_COLS}`;
  const row = await env.DB.prepare(sql).bind(...vals).first();
  if (!row) throw httpError(404, 'not found');
  return row;
}

function settingsToObject(rows) {
  const o = {};
  for (const r of rows) { try { o[r.key] = JSON.parse(r.value); } catch { o[r.key] = r.value; } }
  return o;
}

// ── Auth：Service token（腳本）或 Google ID token（瀏覽器）─────────
async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) throw httpError(401, 'unauthenticated');
  const tok = auth.slice(7);
  // 自動化腳本：Service token（非 JWT 的隨機字串，先比對）
  if (env.SERVICE_TOKEN && tok === env.SERVICE_TOKEN) return { email: 'service', via: 'token' };
  // 瀏覽器：Google 登入拿到的 ID token
  const claims = await verifyGoogleIdToken(tok, env);
  const email = (claims.email || '').toLowerCase();
  const allow = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (!email || !allow.includes(email)) throw httpError(403, 'not an admin');
  return { email, via: 'google' };
}

let _googleCerts = null;
async function getGoogleCerts() {
  if (_googleCerts) return _googleCerts;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw httpError(500, 'cannot fetch Google certs');
  const data = await res.json();
  const keys = {};
  for (const jwk of data.keys || []) {
    keys[jwk.kid] = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  }
  _googleCerts = keys;
  return keys;
}

async function verifyGoogleIdToken(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'malformed token');
  let header, payload;
  try {
    header = JSON.parse(b64urlToString(parts[0]));
    payload = JSON.parse(b64urlToString(parts[1]));
  } catch (_) { throw httpError(401, 'malformed token'); }
  let keys = await getGoogleCerts();
  if (!keys[header.kid]) { _googleCerts = null; keys = await getGoogleCerts(); } // 金鑰輪替 → 重抓一次
  const key = keys[header.kid];
  if (!key) throw httpError(401, 'unknown signing key');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw httpError(401, 'bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) throw httpError(401, 'token expired');
  const iss = payload.iss || '';
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') throw httpError(401, 'bad issuer');
  if (env.GOOGLE_CLIENT_ID && payload.aud !== env.GOOGLE_CLIENT_ID) throw httpError(401, 'bad audience');
  if (payload.email_verified === false) throw httpError(401, 'email not verified');
  return payload;
}

// ── 小工具 ──────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}
async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function httpError(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function hmacHex(key, msg) {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function htmlPage(msg, status = 200) {
  const body = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>操作一下</title>
<style>body{margin:0;background:#050510;color:#e0e0ff;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}a{color:#00f5ff}</style>
</head><body><div><h1 style="color:#00f5ff">操作一下</h1><p>${msg}</p><p><a href="https://operation.tw/">← 回首頁</a></p></div></body></html>`;
  return new Response(body, {
    status, headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

function cors(res, request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = new Headers(res.headers);
  if (allowed.includes(origin) || allowed.includes('*')) {
    h.set('Access-Control-Allow-Origin', allowed.includes('*') ? '*' : origin);
    h.set('Vary', 'Origin');
  }
  h.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,PUT,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  h.set('Access-Control-Allow-Credentials', 'true');
  return new Response(res.body, { status: res.status, headers: h });
}

function b64urlToString(s) { return new TextDecoder().decode(b64urlToBytes(s)); }
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
