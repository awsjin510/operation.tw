// 產生網站的科技感裝飾圖（SVG，品牌色：藍 #62a8ff／青 #55e6d8／紫 #a78bfa）。
// 一次性產生、結果 commit 在 images/brand/；要調整造型時改這支再跑：node scripts/tools/gen-brand-art.js
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', '..', 'images', 'brand');
fs.mkdirSync(OUT, { recursive: true });

// 可重現的亂數（同一個 seed 每次產生一樣的圖，避免每次 build 出 diff）
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const r1 = (n) => Math.round(n * 10) / 10;

const DEFS = `<defs>
  <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#70b7ff"/><stop offset=".5" stop-color="#55e6d8"/><stop offset="1" stop-color="#b08cff"/></linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="#62a8ff" stop-opacity=".55"/><stop offset="1" stop-color="#62a8ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="glow2"><stop offset="0" stop-color="#a78bfa" stop-opacity=".4"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></radialGradient>
  <filter id="blur"><feGaussianBlur stdDeviation="2"/></filter>
</defs>`;

// ── 1. 首頁 hero：網路星座＋電路走線＋同心環 ──
function heroNetwork() {
  const W = 900, H = 700, rand = rng(7);
  const nodes = [];
  for (let i = 0; i < 46; i++) {
    // 集中在右半部、往左漸稀（左側要放文字）
    const x = W * (0.25 + 0.75 * Math.pow(rand(), 0.6));
    const y = H * (0.08 + 0.84 * rand());
    nodes.push({ x, y, r: 1.4 + rand() * 2.6, hot: rand() < 0.16 });
  }
  const edges = [];
  nodes.forEach((a, i) => {
    const near = nodes.map((b, j) => ({ j, d: Math.hypot(a.x - b.x, a.y - b.y) })).filter((o) => o.j !== i).sort((p, q) => p.d - q.d).slice(0, 2);
    near.forEach((o) => { if (o.d < 190 && i < o.j) edges.push([i, o.j, o.d]); });
  });
  // 電路走線：水平—斜角—水平，末端圓點
  const traces = [];
  for (let k = 0; k < 9; k++) {
    const y = H * (0.12 + 0.78 * rand()), x0 = W * (0.42 + 0.2 * rand()), len = 80 + rand() * 160, dy = (rand() < 0.5 ? -1 : 1) * (20 + rand() * 40);
    traces.push(`M${r1(x0)} ${r1(y)}h${r1(len)}l${r1(Math.abs(dy))} ${r1(dy)}h${r1(60 + rand() * 120)}`);
  }
  const cx = W * 0.72, cy = H * 0.46;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${DEFS}
<circle cx="${cx}" cy="${cy}" r="260" fill="url(#glow)" opacity=".5"/>
<circle cx="${W * 0.9}" cy="${H * 0.15}" r="200" fill="url(#glow2)" opacity=".6"/>
<g fill="none" stroke="url(#g)" stroke-width="1" opacity=".22">${[120, 190, 270].map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" stroke-dasharray="${r === 190 ? '2 10' : '1 0'}"/>`).join('')}</g>
<g fill="none" stroke="#55e6d8" stroke-width="1.2" opacity=".28" stroke-linecap="round" stroke-linejoin="round">${traces.map((d) => `<path d="${d}"/>`).join('')}</g>
<g fill="#55e6d8" opacity=".55">${traces.map((d) => { const m = d.match(/^M([\d.]+) ([\d.]+)/); return `<circle cx="${m[1]}" cy="${m[2]}" r="2.6"/>`; }).join('')}</g>
<g stroke="url(#g)" stroke-width=".9">${edges.map(([i, j, d]) => `<line x1="${r1(nodes[i].x)}" y1="${r1(nodes[i].y)}" x2="${r1(nodes[j].x)}" y2="${r1(nodes[j].y)}" opacity="${r1(0.55 - d / 450)}"/>`).join('')}</g>
<g fill="#cfe3ff">${nodes.map((n) => `<circle cx="${r1(n.x)}" cy="${r1(n.y)}" r="${r1(n.r)}" opacity="${n.hot ? 1 : 0.55}"/>`).join('')}</g>
<g class="pulse" fill="url(#glow)">${nodes.filter((n) => n.hot).map((n, i) => `<circle cx="${r1(n.x)}" cy="${r1(n.y)}" r="14" style="animation-delay:${r1(i * 0.7)}s"/>`).join('')}</g>
<style>.pulse circle{transform-box:fill-box;transform-origin:center;animation:p 4.2s ease-in-out infinite}@keyframes p{0%,100%{opacity:.15;transform:scale(.6)}50%{opacity:.9;transform:scale(1.25)}}@media(prefers-reduced-motion:reduce){.pulse circle{animation:none;opacity:.5}}</style>
</svg>`;
}

// ── 2. Podcast：聲波 ──
function soundWave() {
  const W = 900, H = 400, rand = rng(21), bars = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const env = Math.sin(Math.PI * t) * (0.55 + 0.45 * Math.sin(t * 9.5));
    const h = 16 + Math.abs(env) * (H * 0.62) * (0.65 + 0.35 * rand());
    const x = 20 + t * (W - 40);
    bars.push(`<rect x="${r1(x - 3)}" y="${r1(H / 2 - h / 2)}" width="6" height="${r1(h)}" rx="3"/>`);
  }
  const wave = (amp, phase, op) => {
    let d = `M0 ${H / 2}`;
    for (let x = 0; x <= W; x += 12) d += ` L${x} ${r1(H / 2 + amp * Math.sin(x / 70 + phase) * Math.sin(Math.PI * x / W))}`;
    return `<path d="${d}" fill="none" stroke="url(#g)" stroke-width="1.5" opacity="${op}"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${DEFS}
<circle cx="${W * 0.5}" cy="${H * 0.5}" r="260" fill="url(#glow)" opacity=".35"/>
<g fill="url(#g)" opacity=".28">${bars.join('')}</g>
${wave(90, 0, 0.5)}${wave(60, 1.8, 0.35)}${wave(120, 3.1, 0.2)}
</svg>`;
}

// ── 3. 主題插圖（AI／雲端／資安／閱讀／成長）──
const ICONS = {
  ai: `<rect x="34" y="34" width="52" height="52" rx="10" fill="none" stroke="url(#g)" stroke-width="3"/>
<rect x="48" y="48" width="24" height="24" rx="4" fill="url(#g)" opacity=".9"/>
<g stroke="url(#g)" stroke-width="3" stroke-linecap="round">${[46, 60, 74].map((v) => `<path d="M${v} 34V20M${v} 86v14M34 ${v}H20M86 ${v}h14"/>`).join('')}</g>
<g fill="#55e6d8">${[46, 60, 74].map((v) => `<circle cx="${v}" cy="18" r="3"/><circle cx="${v}" cy="102" r="3"/><circle cx="18" cy="${v}" r="3"/><circle cx="102" cy="${v}" r="3"/>`).join('')}</g>`,
  cloud: `<path d="M36 82h50a18 18 0 0 0 2-35.9A26 26 0 0 0 38.6 52 15 15 0 0 0 36 82Z" fill="none" stroke="url(#g)" stroke-width="3" stroke-linejoin="round"/>
<g stroke="#55e6d8" stroke-width="2.4" stroke-linecap="round"><path d="M48 82v14M62 82v18M76 82v14"/></g>
<g fill="url(#g)"><circle cx="48" cy="98" r="4"/><circle cx="62" cy="102" r="4"/><circle cx="76" cy="98" r="4"/></g>
<g fill="#cfe3ff" opacity=".9"><circle cx="54" cy="66" r="2.5"/><circle cx="66" cy="62" r="2.5"/><circle cx="76" cy="68" r="2.5"/></g>
<path d="M54 66l12-4 10 6" fill="none" stroke="#cfe3ff" stroke-width="1.4" opacity=".7"/>`,
  sec: `<path d="M60 16 96 30v26c0 24-15.5 41.5-36 48-20.5-6.5-36-24-36-48V30Z" fill="none" stroke="url(#g)" stroke-width="3" stroke-linejoin="round"/>
<rect x="46" y="54" width="28" height="22" rx="4" fill="url(#g)" opacity=".9"/>
<path d="M51 54v-6a9 9 0 0 1 18 0v6" fill="none" stroke="url(#g)" stroke-width="3"/>
<circle cx="60" cy="64" r="3" fill="#07090f"/><path d="M60 66v5" stroke="#07090f" stroke-width="2.4" stroke-linecap="round"/>`,
  read: `<path d="M60 34c-10-8-24-10-40-8v62c16-2 30 0 40 8 10-8 24-10 40-8V26c-16-2-30 0-40 8Z" fill="none" stroke="url(#g)" stroke-width="3" stroke-linejoin="round"/>
<path d="M60 34v62" stroke="url(#g)" stroke-width="2.4"/>
<g stroke="#55e6d8" stroke-width="2" stroke-linecap="round" opacity=".8"><path d="M30 42h20M30 52h20M30 62h14M70 42h20M70 52h20M70 62h16"/></g>
<circle cx="88" cy="20" r="5" fill="url(#g)"/><path d="M88 8v4M88 28v4M76 20h4M96 20h4" stroke="#cfe3ff" stroke-width="1.6" stroke-linecap="round"/>`,
  grow: `<g fill="url(#g)"><rect x="24" y="72" width="14" height="24" rx="3" opacity=".55"/><rect x="46" y="58" width="14" height="38" rx="3" opacity=".7"/><rect x="68" y="44" width="14" height="52" rx="3" opacity=".85"/><rect x="90" y="28" width="14" height="68" rx="3"/></g>
<path d="M22 62 48 42l18 10 34-30" fill="none" stroke="#55e6d8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M88 22h12v12" fill="none" stroke="#55e6d8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18 100h88" stroke="#cfe3ff" stroke-width="1.6" opacity=".5"/>`,
};
const icon = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" aria-hidden="true">${DEFS}<circle cx="60" cy="60" r="56" fill="url(#glow)" opacity=".35"/>${body}</svg>`;

// ── 4. 區塊背景：細網格＋節點 ──
function gridTile() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M64 0H0v64" fill="none" stroke="#97aada" stroke-opacity=".07"/><circle cx="0" cy="0" r="1.4" fill="#62a8ff" fill-opacity=".25"/></svg>`;
}

const files = {
  'hero-network.svg': heroNetwork(),
  'sound-wave.svg': soundWave(),
  'grid.svg': gridTile(),
  'topic-ai.svg': icon(ICONS.ai),
  'topic-cloud.svg': icon(ICONS.cloud),
  'topic-security.svg': icon(ICONS.sec),
  'topic-reading.svg': icon(ICONS.read),
  'topic-growth.svg': icon(ICONS.grow),
};
for (const [name, svg] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), svg.replace(/\n/g, '') + '\n');
  console.log(`  ✓ images/brand/${name}（${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB）`);
}
