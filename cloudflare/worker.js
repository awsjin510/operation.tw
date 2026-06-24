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
 *   由 Cloudflare Access（Google 登入）在邊緣保護；Worker 再驗 Access JWT + Email 白名單。
 *   GitHub Actions 等自動化則用 Authorization: Bearer <SERVICE_TOKEN>。
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
 *   env.ACCESS_TEAM_DOMAIN  你的 Access 團隊網域，例：yourteam.cloudflareaccess.com
 *   env.ACCESS_AUD        Access 應用程式的 Application Audience (AUD) tag
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
    const { email } = await readJson(request);
    const e = String(email || '').trim().toLowerCase();
    if (!e || e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      return json({ result: 'invalid' });
    }
    const r = await env.DB.prepare(
      `insert into subscribers (email) values (?) on conflict(email) do nothing`
    ).bind(e).run();
    const inserted = (r.meta && r.meta.changes) ? r.meta.changes > 0 : false;
    return json({ result: inserted ? 'subscribed' : 'exists' });
  }

  // ── 管理（需授權）────────────────────────────────────
  if (p.startsWith('/api/admin/')) {
    const who = await requireAuth(request, env);

    if (p === '/api/admin/me' && m === 'GET') return json({ email: who.email, via: who.via });

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

// ── Auth：Service token 或 Cloudflare Access JWT ─────────
async function requireAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) {
    const tok = auth.slice(7);
    if (env.SERVICE_TOKEN && tok === env.SERVICE_TOKEN) return { email: 'service', via: 'token' };
    throw httpError(401, 'invalid service token');
  }
  // Cloudflare Access：JWT 可能來自 header（API 在邊緣被 Access 保護時）
  // 或 CF_Authorization cookie（同網域下 Access 登入頁面後種下的）。
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion') || getCookie(request, 'CF_Authorization');
  if (!jwt) throw httpError(401, 'unauthenticated');
  const claims = await verifyAccessJwt(jwt, env);
  const allow = (env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  const email = (claims.email || '').toLowerCase();
  if (email && allow.includes(email)) return { email, via: 'access' };
  // 服務型 Access token（非互動，無 email，有 common_name）— Access 政策已在邊緣放行
  if (claims.common_name) return { email: claims.common_name, via: 'access-service' };
  throw httpError(403, 'not an admin');
}

let _certsCache = null;
async function getAccessCerts(env) {
  if (_certsCache) return _certsCache;
  const res = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!res.ok) throw httpError(500, 'cannot fetch Access certs');
  const data = await res.json();
  const keys = {};
  for (const jwk of data.keys || []) {
    keys[jwk.kid] = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
  }
  _certsCache = keys;
  return keys;
}

async function verifyAccessJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'malformed jwt');
  const header = JSON.parse(b64urlToString(parts[0]));
  const payload = JSON.parse(b64urlToString(parts[1]));
  const keys = await getAccessCerts(env);
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
  if (env.ACCESS_AUD) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.ACCESS_AUD)) throw httpError(401, 'bad audience');
  }
  return payload;
}

// ── 小工具 ──────────────────────────────────────────────
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function httpError(status, msg) { const e = new Error(msg); e.status = status; return e; }
function getCookie(request, name) {
  const c = request.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
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
