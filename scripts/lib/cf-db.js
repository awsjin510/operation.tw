/**
 * cf-db.js — GitHub Actions 腳本用的 Cloudflare Worker API 客戶端
 * 取代各腳本裡直接打 Supabase REST 的程式碼。
 *
 * 環境變數：
 *   CF_API_BASE                Worker 網址（例 https://operation.tw 或 https://api.operation.tw）
 *   CF_SERVICE_TOKEN           後台寫入用的 Bearer token（對應 worker 的 SERVICE_TOKEN）
 *   CF_ACCESS_CLIENT_ID/SECRET （選用）若 API 在邊緣被 Access 保護，改用 Access service token
 */
'use strict';

const BASE = (process.env.CF_API_BASE || '').replace(/\/+$/, '');
const SERVICE_TOKEN = process.env.CF_SERVICE_TOKEN || '';
const ACCESS_ID = process.env.CF_ACCESS_CLIENT_ID || '';
const ACCESS_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || '';

function assertConfigured() {
  if (!BASE) throw new Error('缺少 CF_API_BASE');
}
function adminHeaders(extra = {}) {
  const h = { ...extra };
  if (SERVICE_TOKEN) h.Authorization = `Bearer ${SERVICE_TOKEN}`;
  if (ACCESS_ID && ACCESS_SECRET) {
    h['CF-Access-Client-Id'] = ACCESS_ID;
    h['CF-Access-Client-Secret'] = ACCESS_SECRET;
  }
  return h;
}

function fetchWithTimeout(url, opts = {}, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function req(method, pathname, { body, admin = false, retries = 3 } = {}) {
  assertConfigured();
  let lastErr;
  for (let i = 1; i <= retries; i++) {
    try {
      const res = await fetchWithTimeout(BASE + pathname, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(admin ? adminHeaders() : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      return res.status === 204 ? null : await res.json();
    } catch (err) {
      lastErr = err;
      if (i === retries) break;
      await new Promise((r) => setTimeout(r, i * 3000));
    }
  }
  throw lastErr;
}

module.exports = {
  // 公開：已發布清單（不含 body）
  getPublishedPosts: () => req('GET', '/api/posts').then((r) => r.posts || []),
  // 後台：含 body 的全部文章（build-static 取內文用）
  getAllPostsWithBody: () => req('GET', '/api/admin/posts?include=body', { admin: true }).then((r) => r.posts || []),
  // 後台：新增單篇，回傳含 id 的列
  createPost: (obj) => req('POST', '/api/admin/posts', { admin: true, body: obj }).then((r) => (r.posts || [])[0]),
  // 後台：更新
  updatePost: (id, patch) => req('PATCH', `/api/admin/posts/${id}`, { admin: true, body: patch }).then((r) => r.post),
  // 後台：刪除
  deletePost: (id) => req('DELETE', `/api/admin/posts/${id}`, { admin: true }),
};
