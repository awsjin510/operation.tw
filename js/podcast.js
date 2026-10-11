// Podcast 頁：搜尋／系列篩選／排序／載入更多／底部播放器。
// 列表前 24 集已由 build-static 輸出在 HTML 裡（沒有 JS 也看得到、爬蟲也看得到）；
// 這裡載入 /episodes-lite.json 後接手篩選與分頁。卡片版型與 scripts/lib/pages.js 的 epCard 一致。
(function () {
  'use strict';
  var PAGE = 24;
  var SERIES = { trend: 'AI 趨勢', guest: '來賓訪談', read: '閱讀操作', other: '其他' };
  var APPLE = 'https://podcasts.apple.com/tw/podcast/id1620760720';
  var ICO_APPLE = '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a9 9 0 0 0-3.6 17.25.75.75 0 0 0 .6-1.38 7.5 7.5 0 1 1 6 0 .75.75 0 1 0 .6 1.38A9 9 0 0 0 12 2Zm0 3.5a5.5 5.5 0 0 0-2.75 10.27.75.75 0 1 0 .75-1.3 4 4 0 1 1 4 0 .75.75 0 1 0 .75 1.3A5.5 5.5 0 0 0 12 5.5Zm0 3.25a2.25 2.25 0 1 0 0 4.5 2.25 2.25 0 0 0 0-4.5Zm0 5.25c-1.1 0-1.9.8-1.78 1.9l.5 4.6c.08.8.6 1.5 1.28 1.5s1.2-.7 1.28-1.5l.5-4.6c.12-1.1-.68-1.9-1.78-1.9Z"/></svg>';
  var ICO_SPOT = '<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.43a.62.62 0 0 1-.86.2c-2.35-1.43-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.22c3.81-.87 7.09-.5 9.72 1.12.3.18.39.57.2.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.83C14.7 8.97 9.37 8.8 6.29 9.73a.94.94 0 1 1-.54-1.8c3.53-1.07 9.42-.86 13.13 1.34a.94.94 0 0 1-.96 1.61Z"/></svg>';

  var EPS = [];
  var state = { q: '', series: '', sort: 'new', shown: PAGE };
  var list = document.getElementById('p-list');
  var count = document.getElementById('p-count');
  var more = document.getElementById('p-more');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function card(e) {
    var t = esc(e.title), series = SERIES[e.series] || '';
    return '<li class="p-ep" data-series="' + e.series + '">' +
      '<img class="p-ep-art" src="' + esc(e.art || '/logo.jpg') + '" alt="" width="96" height="96" loading="lazy" decoding="async">' +
      '<div class="p-ep-body"><p class="h-meta"><span class="h-cat">' + esc(e.code || series) + '</span><span>' + esc(series) + '</span><time datetime="' + esc(e.date) + '">' + esc(e.date) + '</time>' + (e.dur ? '<span>' + e.dur + ' 分鐘</span>' : '') + '</p>' +
      '<h3 class="p-ep-t">' + (e.post ? '<a href="' + esc(e.post) + '">' + t + '</a>' : t) + '</h3>' +
      '<p class="p-ep-d">' + esc(e.d) + '</p><div class="p-ep-actions">' +
      (e.url ? '<button class="btn btn-small btn-play" type="button" data-i="' + e.i + '" aria-label="播放：' + t + '">▶ 播放</button>' : '') +
      (e.post ? '<a class="btn btn-small btn-ghost" href="' + esc(e.post) + '">讀重點文章</a>' : '') +
      '<a class="pf pf-apple" href="' + esc(e.apple || APPLE) + '" target="_blank" rel="noopener" aria-label="Apple Podcasts：' + t + '">' + ICO_APPLE + '</a>' +
      '<a class="pf pf-spotify" href="' + esc(e.spot || 'https://open.spotify.com/search/' + encodeURIComponent(e.title)) + '" target="_blank" rel="noopener" aria-label="Spotify：' + t + '">' + ICO_SPOT + '</a>' +
      '</div></div></li>';
  }

  function filtered() {
    var q = state.q.toLowerCase();
    var arr = EPS.slice(1).filter(function (e) {
      if (state.series && e.series !== state.series) return false;
      return !q || (e.title + ' ' + e.d).toLowerCase().indexOf(q) !== -1;
    });
    // 搜尋時把最新一集也納入（上方大卡只在預設檢視時代表它）
    if (q && (!state.series || EPS[0].series === state.series) && (EPS[0].title + ' ' + EPS[0].d).toLowerCase().indexOf(q) !== -1) arr.unshift(EPS[0]);
    var by = {
      old: function (a, b) { return a.date.localeCompare(b.date); },
      long: function (a, b) { return b.dur - a.dur; },
      short: function (a, b) { return a.dur - b.dur; },
    }[state.sort];
    if (by) arr.sort(by);
    return arr;
  }

  function render() {
    var arr = filtered();
    list.innerHTML = arr.slice(0, state.shown).map(card).join('');
    count.textContent = arr.length ? '共 ' + arr.length + ' 集' + (state.q ? '符合「' + state.q + '」' : '') : '找不到符合的單集，換個關鍵字試試。';
    more.hidden = arr.length <= state.shown;
  }

  // ── 播放器 ──
  var player = document.getElementById('p-player');
  var audio = document.getElementById('p-audio');
  var title = document.getElementById('p-player-t');
  function fitPadding() { document.body.style.paddingBottom = player.hidden ? '' : (player.offsetHeight + 12) + 'px'; }
  function play(i) {
    var e = EPS[i];
    if (!e || !e.url) return;
    title.textContent = e.title;
    if (audio.dataset.i !== String(i)) { audio.src = e.url; audio.dataset.i = String(i); }
    player.hidden = false;
    fitPadding();
    audio.play().catch(function () {});
  }
  document.getElementById('p-player-x').addEventListener('click', function () {
    audio.pause();
    player.hidden = true;
    fitPadding();
  });
  window.addEventListener('resize', fitPadding);
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('.btn-play');
    if (!b) return;
    var i = Number(b.dataset.i);
    if (EPS.length) play(i);
    else load().then(function () { play(i); });
  });

  // ── 篩選控制 ──
  var timer;
  document.getElementById('p-q').addEventListener('input', function (ev) {
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = ev.target.value.trim(); state.shown = PAGE; ready.then(render); }, 150);
  });
  document.getElementById('p-sort').addEventListener('change', function (ev) { state.sort = ev.target.value; state.shown = PAGE; ready.then(render); });
  var chips = document.querySelectorAll('.p-chips .chip');
  Array.prototype.forEach.call(chips, function (c) {
    c.addEventListener('click', function () {
      Array.prototype.forEach.call(chips, function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
      state.series = c.dataset.series;
      state.shown = PAGE;
      ready.then(render);
    });
  });
  more.addEventListener('click', function () { state.shown += PAGE; ready.then(render); });

  function load() {
    return fetch('/episodes-lite.json').then(function (r) { return r.json(); }).then(function (j) {
      EPS = (j.episodes || []).map(function (e, i) { e.i = i; return e; });
    });
  }
  var ready = load().catch(function () { count.textContent = '單集清單載入失敗，請重新整理。'; });
})();
