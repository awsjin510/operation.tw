# Handoff: operation.tw 視覺重構 — V1+「霓虹玻璃終端」(Cyberpunk)

## Overview
operation.tw（「操作一下」）是一個聚焦雲端、資安、AI、閱讀、成長的中文自媒體部落格。本次交付是其**首頁**的視覺重構，採賽博龐克（cyberpunk）方向，內部代號 **V1+「霓虹玻璃終端 / Neon Glass Terminal」**。目標：提升整體質感與材質層次，同時維持中文長文的易讀性。

核心設計原則（請務必遵守）：**霓虹發光只用在標籤、關鍵字、互動狀態與裝飾；所有內文/標題本文一律用高對比純色，避免發光造成中文糊化。**

## About the Design Files
本 bundle 內的檔案是**用 HTML 製作的設計參考稿**（prototype），用來表達預期的外觀與行為，**不是要直接搬進產品的程式碼**。請在目標 codebase 既有的環境（React / Vue / Next.js / Astro 等）中，**用該專案既有的元件慣例與函式庫重新實作這份設計**。若專案尚無前端環境，請選擇最合適的框架（建議 React + Tailwind 或 Next.js）來實作。

`*.dc.html` 是設計工具的格式：把它當成**靜態 HTML + 內聯樣式**閱讀即可——所有樣式都寫在元素的 `style` 屬性上，沒有外部 CSS class，方便你逐一對照數值。忽略檔案開頭 `support.js` 一類的執行階段引用。

## Fidelity
**High-fidelity (hifi)**。顏色、字體、間距、圓角、陰影、互動狀態皆為最終值，請以下方 Design Tokens 與各區塊規格**像素級**重建。文章封面圖、頭像皆為 operation.tw 既有真實資產。

## Screens / Views

### 首頁 (Homepage) — 單頁、由上到下七個區塊
頁面最外層：深色底 `radial-gradient(ellipse at 75% -5%, #0d1626 0%, #08080f 48%, #060609 100%)`，固定（`position:fixed`）的四層氛圍疊加，內容置中 `max-width:1240px`、左右 `padding:32px`。

**固定氛圍層（fixed overlays，z-index:0，pointer-events:none，鋪滿視窗）：**
1. 網格線：`linear-gradient(rgba(0,229,255,.04) 1px,transparent 1px)` + 90deg 同款，`background-size:42px 42px`
2. 微粒：`radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px)`，`background-size:5px 5px`，`opacity:.5`
3. 速度線（scanlines）：`repeating-linear-gradient(0deg,rgba(255,255,255,.012) 0,rgba(255,255,255,.012) 1px,transparent 1px,transparent 3px)`
4. 光暈兩顆：右上 `620px` 圓 `radial-gradient(circle, rgba(0,229,255,.16), transparent 68%)`；左下 `560px` 圓 `radial-gradient(circle, rgba(255,43,214,.1), transparent 70%)`

內容容器 `z-index:1` 疊在氛圍層之上。

---

#### 1. Nav（頂部導覽，sticky）
- **Layout**: `position:sticky; top:0; z-index:50`，整條 `padding:14px 0`，背景 `rgba(6,6,9,.72)`，`backdrop-filter:blur(16px)`，底線 `1px solid rgba(0,229,255,.12)`。內層 `max-width:1240px` 置中，flex space-between。
- **Logo mark**: 36×36，`border-radius:9px`，`background:linear-gradient(135deg,#00e5ff,#7b61ff)`，內含白底深字「操」(Chakra Petch 700, 17px, #07070d)，`box-shadow:0 0 20px rgba(0,229,255,.5)`。後接站名「操作一下」(Chakra Petch 600, 19px, #f2f2f7, letter-spacing:.04em)。
- **Menu**: JetBrains Mono 13px, letter-spacing:.06em，文字「文章 / Podcast / 主題 / 關於我 / 聯絡」。預設色 #9a9ab0；當前頁（文章）#00e5ff；hover → #e8e8f5。
- **右側**: 🔍 圖示 + 「訂閱 →」按鈕（JetBrains Mono 12px, #07070d，漸層底 `linear-gradient(135deg,#00e5ff,#7b61ff)`，`padding:10px 20px`, `border-radius:8px`, `box-shadow:0 0 18px rgba(0,229,255,.4)`）。

#### 2. Hero
- `padding:90px 0 60px`。
- **Kicker**: 7px 青色圓點（`box-shadow:0 0 10px #00e5ff`，`flick` 動畫 4s 無限）+ 文字「每日一則 · 自媒體創作者」(JetBrains Mono 13px, letter-spacing:.34em, uppercase, #00e5ff)。
- **H1**: Chakra Petch 700, **62px**, line-height:1.22, color:#f2f2f7, max-width:1000px。文案：
  `把複雜的{雲端}、{AI}、{資安}` 換行 `用一篇文章、一集 Podcast 說清楚`
  三個關鍵字用**漸層裁切文字**（`background:linear-gradient(...); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;` 加 `filter:drop-shadow(...)`）：
  - 雲端：`linear-gradient(120deg,#00e5ff,#7b61ff)` + drop-shadow 青 .35
  - AI：`linear-gradient(120deg,#c8ff00,#00e5ff)` + drop-shadow 綠 .3
  - 資安：`linear-gradient(120deg,#ff2bd6,#7b61ff)` + drop-shadow 洋紅 .35
- **副標**: 18px, line-height:1.9, #9a9ab0, max-width:580px：「簡單的事情專注做，有一天世界會為了你而感動。」
- **CTA**: 主按鈕「開始閱讀 →」（漸層底同訂閱鈕，14px, padding:15px 30px, radius:9px, glow .45）；次按鈕「🎙 聽 Podcast」（ghost：border `1px solid rgba(0,229,255,.4)`, 字 #00e5ff, bg `rgba(0,229,255,.04)`）。
- **系統數據列**: 4 個 chip（JetBrains Mono 12px，bg `rgba(255,255,255,.03)`，border `rgba(255,255,255,.07)`，radius:8px，padding:11px 17px）：標籤 #5d5d72 + 值 #00e5ff —「累積文章 50+」「核心主題 5」「更新頻率 每日」「領域 雲端 / AI / 資安」。

#### 3. 最新文章 (Latest Articles)
- **區塊標題列**: H2「最新文章」(Chakra Petch 600, 32px, #f2f2f7) + 「// latest_posts▋」(JetBrains Mono 13px, letter-spacing:.18em, #00e5ff，▋ 用 `blink` 1s steps(1) 無限)；右側「查看全部 →」#5d5d72。
- **篩選 tabs**: JetBrains Mono 13px，膠囊 radius:7px。當前「全部」漸層底深字；其餘 border `rgba(255,255,255,.1)`、字 #9a9ab0。標籤：全部 / AI / 雲端 / 資安 / 閱讀 / 成長。
- **卡片網格（第一排）**: `grid-template-columns:repeat(3,1fr); gap:18px`。
  - **精選大卡**：`grid-column:span 2`，內部再 `grid-template-columns:1.1fr 1fr`（左圖右文）。卡片 radius:16px，bg `linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02))`，border `rgba(0,229,255,.18)`。圖：`min-height:268px`，封面 `filter:grayscale(.35) contrast(1.05) brightness(.85)` + 疊色 `linear-gradient(120deg,rgba(0,229,255,.4),rgba(123,97,255,.35)) mix-blend-mode:screen` + 右側遮罩 `linear-gradient(90deg,transparent 52%,rgba(13,15,24,.92))`；左上分類標籤「AI · 精選」(深字青底膠囊)。文字區：「FEATURED / 2026.06.20」(JetBrains Mono 11px #ff2bd6) → H3 24px/1.5 #f2f2f7 700 → 內文 14px/1.85 #8a8aa0 → 「閱讀全文 →」#00e5ff。
  - **側卡**（1 欄，垂直）：圖 160px，標題 16px，內文 13px，日期 JetBrains Mono 11px #5d5d72。
- **卡片網格（第二排）**: `grid-template-columns:repeat(4,1fr); gap:18px`，4 張垂直卡（圖 140px + 標題 15px + 日期）。
- **卡片 hover（所有文章卡）**: `border-color:rgba(0,229,255,.6); box-shadow:0 14px 38px rgba(0,229,255,.16)`（精選大卡用 `.18`）。
- **分類標籤色**: AI=青底 `#00e5ff` 深字；資安=`rgba(255,43,214,.85)` 白字；雲端=`rgba(123,97,255,.85)` 白字；閱讀=`#c8ff00` 深字。
- **每張卡的封面疊色（screen 混色）依分類微調**，見設計檔；圖片 filter 統一 `grayscale(.35) contrast(1.05) brightness(.85)`。

#### 4. Podcast 最新單集
- 標題「Podcast 最新單集」+「// podcast▋」(#ff2bd6)。
- **Layout**: `grid-template-columns:1.4fr 1fr; gap:18px`。
  - **左：精選播放器** — `grid-template-columns:180px 1fr`，卡片同玻璃漸層底、border `rgba(0,229,255,.22)`、`box-shadow:0 0 34px rgba(0,229,255,.1)`。封面方塊 `aspect-ratio:1`，`linear-gradient(135deg,#00e5ff,#ff2bd6)` 底，置中白字「OPERATION / EP.48 / 操作一下 PODCAST」。右側：「最新單集 · 2026.06.20」(#ff2bd6) → 標題 19px → 內文 13px → 播放列（44px 圓形 ▶ 鈕 #00e5ff 深字 + 進度條 4px，已播 34% `#00e5ff` 含 glow，white knob，時間 12:24 / 36:10）。
  - **右：迷你單集列表** — 3 列，每列 `rgba(255,255,255,.03)` bg、border `rgba(0,229,255,.12)`、radius:12px：集數(Chakra Petch 700 16px #8a8aa0) + 標題 14px + meta(分類·時長) + ▶ #00e5ff。hover border `rgba(0,229,255,.45)`。底部「查看全部單集 →」#00e5ff 靠右。

#### 5. 核心主題 (Core Topics)
- 標題「核心主題」+「// core_topics」。
- **Grid**: `repeat(5,1fr); gap:14px`。每卡 radius:14px、padding:24px 18px、bg `rgba(255,255,255,.03)`、border `rgba(0,229,255,.14)`。內容：emoji 26px → 名稱 17px 700 #ecedf5 → 描述 12px #8a8aa0 → 篇數 JetBrains Mono 12px #00e5ff。hover border `rgba(0,229,255,.5)` + glow。
- **AI 卡為高亮主類**：bg `linear-gradient(135deg,rgba(0,229,255,.12),rgba(123,97,255,.08))`、border `rgba(0,229,255,.4)`、`box-shadow:inset 0 0 26px rgba(0,229,255,.08)`、名稱 #fff、描述 #a8b6cc。
- 內容：☁️ 雲端「AWS、Azure、GCP 架構實戰」19 篇 / 🔐 資安「零信任、滲透測試、資安觀念」17 篇 / 🤖 AI「LLM 工具、Prompt、工作流程」56 篇 / 📚 閱讀「書評、心得、知識管理」2 篇 / 🌱 成長「個人成長、習慣、自媒體經營」6 篇。

#### 6. 關於我 (About)
- 卡片 radius:18px、padding:44px、玻璃漸層底、border `rgba(0,229,255,.16)`，`grid-template-columns:auto 1fr; gap:40px`。
- **頭像**: 160×160 radius:16px，外圈發光（`inset:-6px` 的 `linear-gradient(135deg,#00e5ff,#ff2bd6)` opacity:.5 + `blur(14px)`）；圖 `profile.jpg` filter `grayscale(.2) contrast(1.05)` + 疊色 screen。
- **文字**: 「// about_me」#00e5ff → H2「我是 Jin，操作一下」26px → 內文 15px/1.9 #9a9ab0 → 兩組數據（50+ 篇文章 #00e5ff / 5 核心主題 #f2f2f7，Chakra Petch 700 34px，中間 1px 分隔線）。
- 內文：「深耕雲端、資安與 AI 的自媒體創作者。我相信科技不應只是工程師的語言，每個人都值得理解這些工具。不賣課程，不追流量，只想把有用的東西說清楚。」

#### 7. 電子報 / 聯絡 / 頁尾
- **電子報**: 置中卡片 radius:18px、padding:48px 44px、bg `linear-gradient(135deg,rgba(0,229,255,.1),rgba(123,97,255,.06))`、border `rgba(0,229,255,.3)`，頂部中央光暈。H2「訂閱電子報」30px → 說明 15px → email 輸入框（min-width:320px, height:48px, bg `rgba(6,6,9,.6)`, border `rgba(0,229,255,.3)`, placeholder「your@email.com」#5d5d72）+「訂閱 →」漸層鈕。
- **聯絡方式**: 標題 +「// contact」。`repeat(3,1fr)` 三張 chip 卡（bg `rgba(255,255,255,.03)`, border `rgba(255,255,255,.08)`, radius:12px）：✉️ EMAIL `keepfighting510＠gmail.com`、📸 INSTAGRAM `@operation.tw`、▶️ YOUTUBE `@操作一下`。標籤 JetBrains Mono 11px #5d5d72 + 值 14px #ecedf5。
  - **⚠ Email 注意**：請勿把 email 當成單一純文字 token 輸出（部分平台的郵件遮罩會把它改寫成 `[email protected]`）。實作時用分段（`keepfighting510` + 分隔符 + `gmail.com`）或於 client 端組裝。
- **頁尾**: 頂線 `rgba(0,229,255,.12)`、bg `rgba(6,6,9,.6)`、padding:36px 32px space-between。左：小 logo + 「© 2026 操作一下 · operation.tw」(JetBrains Mono 12px #5d5d72)；右：「simple things, done with focus_」#00e5ff。

## Interactions & Behavior
- **Hover**: 文章卡 / 主題卡 / 單集列 / 導覽項，皆為 border 變青 + 青色光暈 box-shadow（值見各區塊）。CTA 與漸層鈕本身已帶 glow，hover 可再略增亮度。
- **動畫**: `flick`（hero 圓點，4s 無限，opacity 閃爍）；`blink`（區塊標題游標 ▋，1s steps(1) 無限）。其餘為靜態。
- **Smooth scroll**: `html{scroll-behavior:smooth}`，導覽可錨點跳轉到各區塊。
- **互動為視覺示意**：篩選 tabs、播放鈕、訂閱表單在 prototype 中無實際邏輯，請依 codebase 既有模式接資料與行為。
- **Responsive**: prototype 為桌面 1240px。實作請補 RWD：≤1024 文章網格 3→2 欄、Podcast 與關於我改單欄堆疊；≤640 全部單欄、H1 降至約 36–40px、`padding` 收斂至 20–24px、`hit target ≥44px`。

## State Management
此為內容型網站，狀態極少：
- 文章分類 `activeCategory`（tabs 切換，篩選文章清單）。
- Podcast 播放器 `currentEpisode` / `isPlaying` / `progress`（若接真實播放）。
- 電子報表單 `email` + 提交/驗證/成功狀態。
- 文章、單集、主題資料建議從 CMS / API 取得（prototype 為寫死範例）。

## Design Tokens

### Colors
| Token | Hex | 用途 |
|---|---|---|
| bg-deep | `#060609` | 頁面最底 |
| bg-grad-1 / 2 | `#0d1626` / `#08080f` | 背景徑向漸層 |
| panel-glass | `linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02))` | 卡片玻璃底 |
| chip-bg | `rgba(255,255,255,.03)` | chip / 小卡底 |
| border-soft | `rgba(255,255,255,.07~.1)` | 中性邊框 |
| border-cyan | `rgba(0,229,255,.12~.22)` | 主邊框；hover `.5~.6` |
| **accent-cyan** | `#00e5ff` | 主霓虹（連結/數值/互動） |
| accent-violet | `#7b61ff` | 漸層第二色 / 雲端 |
| accent-magenta | `#ff2bd6` | Podcast / 資安 / 強調 |
| accent-lime | `#c8ff00` | AI / 閱讀標籤 |
| text-primary | `#f2f2f7` | 標題 |
| text-body | `#ecedf5` | 卡片標題 |
| text-muted | `#9a9ab0` | 內文 |
| text-dim | `#8a8aa0` | 次要內文 |
| text-faint | `#5d5d72` | meta / 日期 / label |
| text-on-accent | `#07070d` | 霓虹底上的深字 |

### Gradients
- Brand: `linear-gradient(135deg,#00e5ff,#7b61ff)`（logo、主鈕）
- Keyword 雲端 `120deg #00e5ff→#7b61ff`；AI `120deg #c8ff00→#00e5ff`；資安 `120deg #ff2bd6→#7b61ff`
- Podcast cover `135deg #00e5ff→#ff2bd6`

### Typography
| 用途 | Font | 設定 |
|---|---|---|
| 展示標題 / 數字 | **Chakra Petch** | 600/700；H1 62、H2 32、卡片 H3 16–24 |
| 中文內文 / 卡片標題 | **Noto Sans TC** | 400/700；body 14–18，line-height 1.75–1.9 |
| 標籤 / meta / kicker / 按鈕 | **JetBrains Mono** | 400/500/700；11–14；letter-spacing .06–.34em；常 uppercase |

字重：Noto Sans TC 300/400/500/700/900；Chakra Petch 400/500/600/700；JetBrains Mono 400/500/700。

### Spacing / Radius / Shadow
- 容器：`max-width:1240px`、左右 `padding:32px`、區塊縱向間距 ~50px。
- 圓角：按鈕 8–9px、卡片 14–16px、大區塊卡 18px、標籤膠囊 5–7px。
- 卡片 hover 陰影：`0 14px 38px rgba(0,229,255,.16)`；發光鈕：`0 0 18~28px rgba(0,229,255,.4~.45)`；高亮主題卡 `inset 0 0 26px rgba(0,229,255,.08)`。
- 圖片濾鏡：封面 `grayscale(.35) contrast(1.05) brightness(.85)` + 分類疊色 `mix-blend-mode:screen`。

## Assets
全部來自 operation.tw 既有資產（請以你 codebase 的圖片來源/CDN 替換路徑）：
- 文章封面：`https://operation.tw/images/posts/post-{id}.jpg`（本稿用 140/141/284/139/138/137）
- 頭像：`https://operation.tw/profile.jpg`
- Logo：以漸層方塊 +「操」字重繪（未使用點陣 logo）；如需用官方 `logo.png` 可替換 logo mark。
- 字型：Google Fonts（Noto Sans TC、Chakra Petch、JetBrains Mono）。
- 圖示：目前用 emoji（☁️🔐🤖📚🌱✉️📸▶️🔍🎙）；可依 codebase 換成圖示字型 / SVG 套件。

## Files
- `操作一下 V1+ 完整站.dc.html` — 本次交付的完整首頁設計稿（hifi，全區塊，所有樣式內聯，逐元素可對照）。
- `README.md` — 本文件，自足規格。

> 另：本對話另有 `operation.tw 重構.dc.html`（V1 / V1+ / V2 / V3 四個方向 + Podcast 頁的並排比較稿），如需其他方向或 Podcast 完整頁可一併索取，但**本次採用方向為 V1+**。
