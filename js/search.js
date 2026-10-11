// /search/ 搜尋頁：在 /search-index.json（build-static 產生：可見文章＋所有單集）裡做關鍵字搜尋。
// 查詢字串放在網址 ?q=，可分享、可按上一頁回到結果。
(function () {
  'use strict';
  var input = document.getElementById('s-q');
  var list = document.getElementById('s-list');
  var count = document.getElementById('s-count');
  var chips = document.querySelectorAll('.p-chips .chip');
  var idx = null, type = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function mark(text, terms) {
    var out = esc(text);
    terms.forEach(function (t) {
      if (!t) return;
      var re = new RegExp('(' + esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      out = out.replace(re, '<mark>$1</mark>');
    });
    return out;
  }
  function score(item, terms) {
    var t = (item.t + ' ' + (item.k || '')).toLowerCase(), e = (item.e || '').toLowerCase(), s = 0;
    for (var i = 0; i < terms.length; i++) {
      var w = terms[i];
      var inT = t.indexOf(w) !== -1, inE = e.indexOf(w) !== -1;
      if (!inT && !inE) return 0;          // 每個關鍵字都要出現
      s += inT ? 3 : 1;
    }
    return s;
  }
  function run() {
    var q = input.value.trim();
    var url = new URL(location.href);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState(null, '', url);
    document.title = (q ? '「' + q + '」的搜尋結果' : '搜尋') + '｜操作一下';
    if (!q) { list.innerHTML = ''; count.textContent = '輸入關鍵字開始搜尋。'; return; }
    if (!idx) { count.textContent = '載入中…'; return; }
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var items = [];
    // 單集文章（p:1）在「文章」與「Podcast 單集」兩個篩選下都算
    idx.posts.forEach(function (p) { if (type !== 'ep' || p.p) items.push({ k: p.p ? 'ep' : 'post', it: p }); });
    if (type !== 'post') idx.eps.forEach(function (e) { items.push({ k: 'ep', it: e }); });
    var hits = items.map(function (x) { x.s = score(x.it, terms); return x; })
      .filter(function (x) { return x.s > 0; })
      .sort(function (a, b) { return b.s - a.s || b.it.d.localeCompare(a.it.d); })
      .slice(0, 60);
    count.textContent = hits.length ? '找到 ' + hits.length + ' 筆「' + q + '」的結果' + (hits.length === 60 ? '（顯示前 60 筆）' : '') : '找不到「' + q + '」，換個關鍵字，或試試較短的詞。';
    list.innerHTML = hits.map(function (x) {
      var it = x.it, ext = x.k === 'ep' && it.x;
      return '<li><a href="' + esc(it.u) + '"' + (ext ? ' target="_blank" rel="noopener"' : '') + '>' + mark(it.t, terms) + '</a>' +
        '<span class="h-meta"><span class="h-cat">' + (x.k === 'ep' ? '🎙 ' : '') + esc(it.c) + '</span><time>' + esc(it.d) + '</time></span>' +
        (it.e ? '<p>' + mark(it.e, terms) + '</p>' : '') + '</li>';
    }).join('');
  }

  Array.prototype.forEach.call(chips, function (c) {
    c.addEventListener('click', function () {
      Array.prototype.forEach.call(chips, function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
      type = c.dataset.type;
      run();
    });
  });
  document.querySelector('.s-form').addEventListener('submit', function (e) { e.preventDefault(); run(); });
  var timer;
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 200); });

  input.value = new URLSearchParams(location.search).get('q') || '';
  if (!input.value) input.focus();
  fetch('/search-index.json').then(function (r) { return r.json(); }).then(function (j) { idx = j; run(); })
    .catch(function () { count.textContent = '搜尋資料載入失敗，請重新整理。'; });
})();
