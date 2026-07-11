# 🗺 給 AI 協作者的施工須知（Codex / Claude / 任何 agent 開工前必讀）

> 這個 repo 是「靜態站 + SPA + 每日自動化管線」的混合體，很多東西**看起來能改、其實牽一髮動全身**。
> 改壞過的真實案例都寫在下面。開工前花 3 分鐘讀完，能省掉一整輪來回除錯。

## 架構 30 秒版

- **前端**：GitHub Pages 靜態託管。`index.html` 同時是「靜態 SEO 頁」和「SPA」（views：`#v-home` / `#v-post` / `#v-search`）。
- **資料**：文章存 Cloudflare D1，透過 Worker API（`js/api-config.js` 的網址）讀寫；前端讀 `posts.json` / `episodes.json`（workflow 產生的快照）。
- **自動化**：GitHub Actions 每天自動發文、抓 Podcast 轉文章、寄電子報、重建靜態頁。**很多檔案是機器寫的，手改會被覆蓋**。

## ⛔ 地雷清單（每一條都炸過）

1. **這些檔案由 `scripts/build-static.js` 自動重生，手改必被覆蓋**：
   `post/`、`category/`、`faq/`、`glossary/`、`sitemap.xml`、`feed.xml`、`llms.txt`、`llms-full.txt`、`posts.json`，
   以及 `index.html` 裡的「靜態文章卡片（#grid-main 內容）、主題數量、noscript 區」。
   → 要改這些的樣板，請改 `scripts/build-static.js` 裡的產生邏輯。

2. **`/ai/` 和 `/about/` 是「頁面已遷移」的轉址殭屍頁**（開啟後立刻彈回首頁）。
   **不要連結它們**。正確連結：分類頁 `/category/AI/`（雲端、資安、閱讀、成長同理，中文要 URL encode）、`/faq/`、`/glossary/`、文章 `/post/<id>/`、`/#about`。

3. **SPA 依賴這些 DOM id，刪掉或改名會壞功能**：
   `#v-home` `#v-post` `#v-search` `#posts`（含 `.fb` 篩選鈕、`#grid-main`、`#load-more`）、`#nl-email` `#nl-hp`（honeypot）、`#a-*`（文章視圖）、`nav` 裡的 `#stat-total` `#stat-today`。
   `homepage-v2.js` 重繪首頁時會刻意**保留 `#posts` 區塊塞回**——這是使用者指定要的原版文章區，別再蓋掉。

4. **新舊兩套 CSS 同時存在**：`index.html` / `podcast.html` 的行內 `<style>` 是 v1；`homepage-v2.css` / `podcast-v2.css` 後載入是 v2。
   改樣式時**先搜尋同名 selector 是否兩邊都有**（`.ep-card` 曾因此在手機版把內文壓進縮圖欄）。手機版改動務必用 390px 視窗實測。

5. **圖片 onerror 絕對不要 `display:none`**（縮圖一掛整個 grid 塌版）。用 `this.src='/default.png'`（文章）或 `/logo.jpg`（Podcast）佔位。
   文章封面：`/images/posts/post-<id>.jpg`（WebP 由 build-static 自動產生，別手做）。新文章封面由 Pexels 自動配圖（`scripts/lib/photo-cover.js`）。

6. **可點擊卡片要讓「整張卡是 `<a>`」**，不要用「絕對定位的空 `<a>` 浮層」——CSS 沒載到時浮層塌成 0×0，整卡點不動（發生過）。

7. **SEO / GEO 埋點不可破壞**：`index.html` 開頭的 JSON-LD（Organization/Person/WebSite）、文章頁的 Article/FAQPage、`/glossary/` 的 DefinedTermSet、`llms.txt`、canonical。
   文章內文固定格式 `<h2>常見問題</h2>` + `<h3>問句</h3><p>答案</p>`（×3）是給結構化資料解析器用的，別改格式。

8. **瀏覽數有兩層**：`posts.json` 的 `views` 是排程快照；即時值打 `GET /api/views/posts`（id→views 對照表）。卡片上的「N 次瀏覽」是使用者指定要顯示的，別移除。

9. **電子報**：表單按鈕呼叫 `nlSubmit()`，必須保留 `#nl-email` + `#nl-hp`（隱藏 honeypot）。寄送邏輯在 Worker + `scripts/send-newsletter.js`，前端別自己實作。

10. **部署機制**：push 到 main 會自動部署 GitHub Pages；但 **workflow 機器人 commit 不會觸發部署**，會 commit 的 workflow 必須列在 `deploy-pages.yml` 的 `workflow_run` 白名單（新增 workflow 時記得加）。
    Worker / D1 改動要手動跑「Deploy Cloudflare」workflow——**`reseed` 一律保持 `false`**（`true` 會清空正式資料庫，發生過資料被洗掉）。

## ✅ 流程要求

- **開 branch、發 PR，不要直接 push main**；一次 PR 一個主題，不要短時間連推多版（部署與 CDN 快取交錯會讓線上出現混版 bug）。
- 改前端後至少驗證：**桌機 1366px + 手機 390px** 各截圖一次、文章卡片可點擊、無水平溢出。
- 不確定某段程式能不能動，先搜尋這份文件和 `OPTIMIZATION_LOG.md`，或在 PR 描述裡標註「不確定」。

## 📁 檔案地圖

| 檔案 | 角色 | 可以手改？ |
|---|---|---|
| `index.html` | SPA + 靜態首頁（v1 邏輯與樣式） | 小心改（見地雷 1/3/4） |
| `homepage-v2.js/css`、`podcast-v2.css` | 新版視覺層 | ✅ 主要改這裡 |
| `podcast.html` | Podcast 頁（v1+v2 混合） | 小心改（見地雷 4） |
| `admin.html`、`js/admin-charts.js` | 後台儀表板 | ✅ |
| `js/api.js`、`js/api-config.js` | Worker API client | 小心改 |
| `cloudflare/worker.js`、`schema.sql` | API + D1 | 改完要跑 Deploy Cloudflare |
| `scripts/*.js` | 自動化管線 | ✅（改完 `node --check`） |
| `.github/workflows/*` | 排程與部署 | 小心改（見地雷 10） |
| `post/ category/ faq/ glossary/ sitemap.xml feed.xml llms*.txt posts.json` | 機器產物 | ❌ 改 build-static.js |
