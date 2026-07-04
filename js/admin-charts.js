// operation.tw 後台 — 手刻 SVG 圖表庫（無外部依賴）
// 規格：2px 折線、≥8px hover 標記、4px 圓角資料端、bar 間 2px 表面間隙、
//       recessive 網格、文字一律用文字色（不用資料色）、crosshair + tooltip。
// 調色盤已通過六項檢查（明度帶/彩度/色盲分離/對比，dark surface #050510）。
(function () {
  'use strict';

  // 分類固定色序（validated categorical palette, dark mode）
  const CAT_COLORS = { AI: '#0092ad', 雲端: '#8464ff', 資安: '#d0209a', 閱讀: '#8a5200', 成長: '#7ba100' };
  const INK = '#e4e4f4', INK_DIM = '#9a9ab2', GRID = 'rgba(255,255,255,.07)', SURFACE = '#050510';

  const esc = (s) => String(s == null ? '' : s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const fmt = (n) => Number(n).toLocaleString('zh-Hant-TW');

  // 共用 tooltip（每個容器一個）
  function tipOf(host) {
    let t = host.querySelector('.ch-tip');
    if (!t) {
      t = document.createElement('div');
      t.className = 'ch-tip';
      t.style.cssText = 'position:absolute;pointer-events:none;background:#14142a;border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 10px;font-size:12px;color:' + INK + ';white-space:nowrap;opacity:0;transition:opacity .12s;z-index:5;box-shadow:0 4px 16px rgba(0,0,0,.5);';
      host.appendChild(t);
    }
    return t;
  }
  function showTip(host, x, y, html) {
    const t = tipOf(host);
    t.innerHTML = html;
    t.style.opacity = '1';
    const r = host.getBoundingClientRect(), tw = t.offsetWidth;
    t.style.left = Math.min(Math.max(4, x - tw / 2), r.width - tw - 4) + 'px';
    t.style.top = Math.max(2, y - t.offsetHeight - 12) + 'px';
  }
  function hideTip(host) { const t = host.querySelector('.ch-tip'); if (t) t.style.opacity = '0'; }

  // y 軸友善刻度
  function niceMax(v) {
    if (v <= 5) return 5;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 5, 10]) if (v <= m * p) return m * p;
    return 10 * p;
  }

  // ── 折線圖（單一序列：時間趨勢）──────────────────────────────
  // data: [{date:'YYYY-MM-DD', value:Number}]
  function lineChart(host, data, opts = {}) {
    const color = opts.color || '#0092ad';
    host.style.position = 'relative';
    if (!data.length) { host.innerHTML = '<div style="color:' + INK_DIM + ';padding:32px;text-align:center;font-size:.85rem;">尚無資料</div>'; return; }
    const W = host.clientWidth || 600, H = opts.height || 220;
    const P = { l: 42, r: 14, t: 12, b: 26 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = niceMax(Math.max(...data.map((d) => d.value), 1));
    const x = (i) => P.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw);
    const y = (v) => P.t + ih - (v / max) * ih;

    let g = '';
    for (let k = 0; k <= 3; k++) { // recessive 橫向網格 4 條
      const gy = P.t + (ih * k) / 3, gv = Math.round(max * (1 - k / 3));
      g += `<line x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}" stroke="${GRID}"/>`
        + `<text x="${P.l - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="${INK_DIM}">${fmt(gv)}</text>`;
    }
    // x 軸首尾 + 中間日期
    const xt = [0, Math.floor((data.length - 1) / 2), data.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    for (const i of xt) g += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="${INK_DIM}">${esc(data[i].date.slice(5))}</text>`;

    const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
    const area = `${P.l},${P.t + ih} ${pts} ${x(data.length - 1)},${P.t + ih}`;
    const last = data[data.length - 1];
    // 選擇性直標：只標最後一點
    const lastLbl = `<text x="${Math.min(x(data.length - 1), W - P.r - 4)}" y="${Math.max(y(last.value) - 10, 12)}" text-anchor="end" font-size="11" font-weight="600" fill="${INK}">${fmt(last.value)}</text>`;

    host.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block">
      ${g}
      <polygon points="${area}" fill="${color}" opacity="0.10"/>
      <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="ch-x" x1="0" y1="${P.t}" x2="0" y2="${P.t + ih}" stroke="rgba(255,255,255,.25)" stroke-dasharray="3,3" opacity="0"/>
      <circle class="ch-dot" r="4.5" fill="${color}" stroke="${SURFACE}" stroke-width="2" opacity="0"/>
      ${lastLbl}
      <rect class="ch-hit" x="${P.l}" y="${P.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>`;

    const svg = host.querySelector('svg'), hit = svg.querySelector('.ch-hit'),
      vline = svg.querySelector('.ch-x'), dot = svg.querySelector('.ch-dot');
    hit.addEventListener('mousemove', (e) => {
      const box = svg.getBoundingClientRect(), sx = W / box.width;
      const mx = (e.clientX - box.left) * sx;
      const i = Math.round(((mx - P.l) / iw) * (data.length - 1));
      const ci = Math.max(0, Math.min(data.length - 1, i));
      const px = x(ci), py = y(data[ci].value);
      vline.setAttribute('x1', px); vline.setAttribute('x2', px); vline.setAttribute('opacity', '1');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('opacity', '1');
      showTip(host, px / sx, py / sx, `<b>${esc(data[ci].date)}</b><br>${esc(opts.label || '數值')}：<b>${fmt(data[ci].value)}</b>`);
    });
    hit.addEventListener('mouseleave', () => { vline.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); hideTip(host); });
  }

  // ── 橫向長條（排行：單一色相 + 端點數值）────────────────────
  // data: [{label, value, href?}]
  function hBarChart(host, data, opts = {}) {
    const color = opts.color || '#0092ad';
    host.style.position = 'relative';
    if (!data.length) { host.innerHTML = '<div style="color:' + INK_DIM + ';padding:32px;text-align:center;font-size:.85rem;">尚無資料</div>'; return; }
    const W = host.clientWidth || 600;
    const BAR = 18, GAP = 10, LBL = 15;
    const P = { l: 8, r: 52, t: 4, b: 4 };
    const H = P.t + data.length * (BAR + GAP + LBL) + P.b;
    const iw = W - P.l - P.r;
    const max = Math.max(...data.map((d) => d.value), 1);

    let rows = '';
    data.forEach((d, i) => {
      const ty = P.t + i * (BAR + GAP + LBL);
      const by = ty + LBL;
      const bw = Math.max(4, (d.value / max) * iw);
      const r = 4; // 只圓資料端（右側）
      const path = `M${P.l},${by} h${Math.max(0, bw - r)} a${r},${r} 0 0 1 ${r},${r} v${BAR - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${Math.max(0, bw - r)} z`;
      rows += `<text x="${P.l}" y="${ty + 11}" font-size="11" fill="${INK_DIM}">${esc(d.label.length > 34 ? d.label.slice(0, 33) + '…' : d.label)}</text>`
        + `<path class="ch-bar" data-i="${i}" d="${path}" fill="${color}" opacity="0.9"/>`
        + `<text x="${P.l + bw + 8}" y="${by + BAR / 2 + 4}" font-size="11" font-weight="600" fill="${INK}">${fmt(d.value)}</text>`;
    });
    host.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block">${rows}</svg>`;
    host.querySelectorAll('.ch-bar').forEach((b) => {
      b.style.cursor = data[+b.dataset.i].href ? 'pointer' : 'default';
      b.addEventListener('mouseenter', (e) => {
        b.setAttribute('opacity', '1');
        const box = host.getBoundingClientRect();
        showTip(host, e.clientX - box.left, e.clientY - box.top, `<b>${esc(data[+b.dataset.i].label)}</b><br>${esc(opts.label || '數值')}：<b>${fmt(data[+b.dataset.i].value)}</b>`);
      });
      b.addEventListener('mouseleave', () => { b.setAttribute('opacity', '0.9'); hideTip(host); });
      b.addEventListener('click', () => { const h = data[+b.dataset.i].href; if (h) window.open(h, '_blank'); });
    });
  }

  // ── 分類長條（identity：固定分類色 + 軸標籤帶名，非僅靠顏色）──
  // data: [{label, value}]；顏色取 CAT_COLORS[label]
  function catBarChart(host, data, opts = {}) {
    host.style.position = 'relative';
    if (!data.length) { host.innerHTML = '<div style="color:' + INK_DIM + ';padding:32px;text-align:center;font-size:.85rem;">尚無資料</div>'; return; }
    const W = host.clientWidth || 600, H = opts.height || 210;
    const P = { l: 42, r: 10, t: 14, b: 30 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = niceMax(Math.max(...data.map((d) => d.value), 1));
    const n = data.length, slot = iw / n, bw = Math.min(56, slot - 14);

    let g = '';
    for (let k = 0; k <= 3; k++) {
      const gy = P.t + (ih * k) / 3, gv = Math.round(max * (1 - k / 3));
      g += `<line x1="${P.l}" y1="${gy}" x2="${W - P.r}" y2="${gy}" stroke="${GRID}"/>`
        + `<text x="${P.l - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="${INK_DIM}">${fmt(gv)}</text>`;
    }
    let bars = '';
    data.forEach((d, i) => {
      const cx = P.l + slot * i + slot / 2;
      const bh = Math.max(3, (d.value / max) * ih);
      const bx = cx - bw / 2, by = P.t + ih - bh, r = 4; // 只圓資料端（頂部）
      const path = `M${bx},${P.t + ih} v-${Math.max(0, bh - r)} a${r},${r} 0 0 1 ${r},-${r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${Math.max(0, bh - r)} z`;
      const fill = opts.color || CAT_COLORS[d.label] || '#0092ad';
      const lbl = opts.shortLabel ? esc(String(d.label).slice(5)) : esc(d.label);
      bars += `<path class="ch-bar" data-i="${i}" d="${path}" fill="${fill}" opacity="0.92"/>`
        + `<text x="${cx}" y="${by - 6}" text-anchor="middle" font-size="10" font-weight="600" fill="${INK}">${fmt(d.value)}</text>`
        + `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="9.5" fill="${INK_DIM}">${lbl}</text>`;
    });
    host.innerHTML = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block">${g}${bars}</svg>`;
    host.querySelectorAll('.ch-bar').forEach((b) => {
      b.addEventListener('mouseenter', (e) => {
        b.setAttribute('opacity', '1');
        const box = host.getBoundingClientRect();
        showTip(host, e.clientX - box.left, e.clientY - box.top, `<b>${esc(data[+b.dataset.i].label)}</b><br>${esc(opts.label || '數值')}：<b>${fmt(data[+b.dataset.i].value)}</b>`);
      });
      b.addEventListener('mouseleave', () => { b.setAttribute('opacity', '0.92'); hideTip(host); });
    });
  }

  // ── 無障礙：資料表格檢視 ─────────────────────────────────────
  function dataTable(rows, headers) {
    const th = headers.map((h) => `<th style="text-align:left;padding:4px 12px 4px 0;color:${INK_DIM};font-weight:500;">${esc(h)}</th>`).join('');
    const trs = rows.map((r) => `<tr>${r.map((c) => `<td style="padding:3px 12px 3px 0;color:${INK};">${esc(c)}</td>`).join('')}</tr>`).join('');
    return `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:.75rem;color:${INK_DIM};">📋 資料表格</summary>
      <div style="max-height:200px;overflow:auto;margin-top:6px;"><table style="border-collapse:collapse;font-size:.78rem;width:100%;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div></details>`;
  }

  window.AdminCharts = { lineChart, hBarChart, catBarChart, dataTable, CAT_COLORS };
})();
