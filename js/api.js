// operation.tw — Cloudflare Worker API client（取代 supabase-js）
// 公開端點：一般 fetch。/api/admin/*：帶 Google 登入拿到的 ID token（Authorization: Bearer）。
(function () {
  const BASE = () => (window.API_BASE || '').replace(/\/+$/, '');
  let authToken = null; // Google ID token（admin 登入後設定）

  async function call(pathname, { method = 'GET', body, admin = false, signal } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (admin) {
      if (!authToken) { const e = new Error('尚未登入'); e.status = 401; throw e; }
      headers['Authorization'] = 'Bearer ' + authToken;
    }
    const res = await fetch(BASE() + pathname, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal,
    });
    if (!res.ok) {
      let msg = 'HTTP ' + res.status;
      try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
      const e = new Error(msg); e.status = res.status; throw e;
    }
    return res.status === 204 ? null : res.json();
  }

  window.api = {
    // 設定 / 清除 Google ID token
    setAuthToken: (t) => { authToken = t || null; },
    hasAuthToken: () => !!authToken,

    // ── 公開 ──
    getSettings: () => call('/api/settings'),
    getPublishedPosts: () => call('/api/posts').then((r) => r.posts || []),
    getPostBody: (id, signal) => call(`/api/posts/${id}/body`, { signal }).then((r) => r.body),
    incrementSiteViews: () => call('/api/views/site', { method: 'POST' }),
    incrementPostViews: (id) => call('/api/views/post', { method: 'POST', body: { id } }),
    subscribe: (email) => call('/api/subscribe', { method: 'POST', body: { email } }).then((r) => r.result),

    // ── 後台（需 Google 登入）──
    me: () => call('/api/admin/me', { admin: true }),
    adminListPosts: () => call('/api/admin/posts', { admin: true }).then((r) => r.posts || []),
    adminGetPost: (id) => call(`/api/admin/posts/${id}`, { admin: true }).then((r) => r.post),
    adminCreatePosts: (rows) => call('/api/admin/posts', { method: 'POST', admin: true, body: rows }).then((r) => r.posts || []),
    adminUpdatePost: (id, patch) => call(`/api/admin/posts/${id}`, { method: 'PATCH', admin: true, body: patch }).then((r) => r.post),
    adminDeletePost: (id) => call(`/api/admin/posts/${id}`, { method: 'DELETE', admin: true }),
    adminDeleteAll: () => call('/api/admin/posts?all=1', { method: 'DELETE', admin: true }),
    adminGetSettings: () => call('/api/admin/settings', { admin: true }),
    adminPutSetting: (key, value) => call(`/api/admin/settings/${key}`, { method: 'PUT', admin: true, body: value }),
  };
})();
