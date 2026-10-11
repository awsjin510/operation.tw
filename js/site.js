// operation.tw — 全站共用的小腳本（首頁、Podcast、文章、分類、搜尋頁都載入）
// 1. 電子報表單（.nl-form）：送出、驗證、成功／失敗訊息寫進 role=status 並保留
// 2. 瀏覽統計：每頁記一次全站瀏覽；每個瀏覽器每天第一次造訪記一次「訪客」（不辨識身分）
//    數字填進 [data-stat=total|today|visitors_today|visitors_total]
// 3. 文章瀏覽數：body[data-post-id] 時記一次並顯示在 #pv；卡片上的 [data-views-id] 由 /api/views/posts 填入
(function () {
  'use strict';
  var API = 'https://operation-tw-api.gamania-cloudforce.workers.dev';
  var EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  }

  // ── 1. 電子報 ──
  function setMsg(form, text, kind) {
    var box = form.parentNode.querySelector('.nl-msg');
    if (!box) return;
    box.textContent = text;
    box.className = 'nl-msg' + (kind ? ' is-' + kind : '');
  }
  function onSubmit(e) {
    e.preventDefault();
    var form = e.currentTarget, input = form.email, btn = form.querySelector('button');
    var email = (input.value || '').trim();
    if (!EMAIL_RE.test(email)) {
      input.setAttribute('aria-invalid', 'true');
      setMsg(form, '請輸入正確的 Email，例如 name@example.com', 'error');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    btn.disabled = true;
    var label = btn.textContent;
    btn.textContent = '送出中…';
    setMsg(form, '', '');
    post('/api/subscribe', { email: email, website: form.website ? form.website.value : '', source: form.dataset.source || location.pathname })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (x) {
        if (x.s === 429) setMsg(form, '嘗試太頻繁了，請稍等一分鐘再試。', 'error');
        else if (x.j.result === 'invalid') { input.setAttribute('aria-invalid', 'true'); setMsg(form, 'Email 格式不正確，請再確認一次。', 'error'); }
        else if (x.j.result === 'exists') setMsg(form, '你已經訂閱過了，下一集上線時會寄給你 ✓', 'ok');
        else if (x.s >= 400) setMsg(form, '訂閱沒有成功，請稍後再試。', 'error');
        else { setMsg(form, '訂閱成功！下一集 Podcast 上線時會寄到 ' + email + ' ✓', 'ok'); form.reset(); }
      })
      .catch(function () { setMsg(form, '網路連線失敗，請稍後再試。', 'error'); })
      .finally(function () { btn.disabled = false; btn.textContent = label; });
  }

  // ── 2. 全站瀏覽與訪客 ──
  var fmt = function (n) { return Number(n || 0).toLocaleString('zh-TW'); };
  function taipeiDate() { return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); }
  function trackSite() {
    var visitor = false;
    try {
      if (localStorage.getItem('op-visit') !== taipeiDate()) { visitor = true; localStorage.setItem('op-visit', taipeiDate()); }
    } catch (e) { visitor = false; } // 無痕／封鎖儲存時不計訪客，避免每頁都算一位
    post('/api/views/site', { visitor: visitor })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return;
        Array.prototype.forEach.call(document.querySelectorAll('[data-stat]'), function (el) {
          if (j[el.dataset.stat] != null) el.textContent = fmt(j[el.dataset.stat]);
        });
      })
      .catch(function () {});
  }

  // ── 3. 文章瀏覽數 ──
  function trackPost(id) {
    post('/api/views/post', { id: id })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        var el = document.getElementById('pv');
        if (el && j && j.views != null) el.textContent = ' · ' + fmt(j.views) + ' 次瀏覽';
      })
      .catch(function () {});
  }
  function fillCardViews() {
    var els = document.querySelectorAll('[data-views-id]');
    if (!els.length) return;
    fetch(API + '/api/views/posts').then(function (r) { return r.ok ? r.json() : null; }).then(function (map) {
      if (!map) return;
      Array.prototype.forEach.call(els, function (el) {
        var v = map[el.dataset.viewsId];
        if (v != null) el.textContent = fmt(v) + ' 次瀏覽';
      });
    }).catch(function () {});
  }

  // ── 3. 長清單：篩選＋顯示更多（分類頁、FAQ、術語庫）──
  // <div data-list="x" data-item=".ci" data-page="30">…</div>
  // <input data-filter-for="x">、<button data-more-for="x">、<p data-status-for="x">
  // 全部項目都在 HTML 裡（爬蟲看得到），JS 只負責先收起、篩選。
  function setupList(box) {
    var id = box.dataset.list, size = Number(box.dataset.page) || 0;
    var items = Array.prototype.slice.call(box.querySelectorAll(box.dataset.item || ':scope > *'));
    var groups = box.querySelectorAll('[data-group]');
    var input = document.querySelector('[data-filter-for="' + id + '"]');
    var more = document.querySelector('[data-more-for="' + id + '"]');
    var status = document.querySelector('[data-status-for="' + id + '"]');
    var shown = size || items.length, q = '';
    var text = items.map(function (el) { return el.textContent.toLowerCase(); });
    function apply() {
      var n = 0, visible = 0;
      items.forEach(function (el, i) {
        var match = !q || text[i].indexOf(q) !== -1;
        if (match) n++;
        var show = match && (q || n <= shown);
        el.hidden = !show;
        if (show) visible++;
        if (q && match && el.tagName === 'DETAILS') el.open = true;
      });
      Array.prototype.forEach.call(groups, function (g) { g.hidden = !g.querySelector(box.dataset.item + ':not([hidden])'); });
      if (more) more.hidden = !!q || n <= shown;
      if (status) status.textContent = q ? (n ? '找到 ' + n + ' 筆符合「' + q + '」' : '沒有符合「' + q + '」的項目') : '顯示 ' + visible + ' / ' + items.length + ' 筆';
    }
    if (input) {
      var t;
      input.addEventListener('input', function () { clearTimeout(t); t = setTimeout(function () { q = input.value.trim().toLowerCase(); apply(); }, 120); });
    }
    if (more) more.addEventListener('click', function () { shown += size; apply(); });
    // 從錨點（例如 /glossary/#term-xxx）進來時，確保目標項目是展開可見的
    var target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target && box.contains(target)) { shown = items.length; }
    apply();
    if (target && box.contains(target)) { if (target.tagName === 'DETAILS') target.open = true; target.scrollIntoView(); }
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-list]'), setupList);
    var forms = document.querySelectorAll('.nl-form');
    for (var i = 0; i < forms.length; i++) forms[i].addEventListener('submit', onSubmit);
    var body = document.body;
    trackSite();
    if (body.dataset.postId) trackPost(body.dataset.postId);
    fillCardViews();
    // 手機選單：點選單內連結後收起（同頁錨點時 details 不會自己關）
    var menu = document.querySelector('.st-menu');
    if (menu) menu.addEventListener('click', function (e) { if (e.target.closest('a')) menu.open = false; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
