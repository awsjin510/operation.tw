# 📈 operation.tw 優化記錄

> 最後更新：2026-06-30

這份文件記錄網站的優化工作、待你操作的項目,以及未來成長方向。

---

## ✅ 已完成（本輪）

### 基礎建設
- **後台搬遷 Cloudflare**：D1 資料庫後端,修復原本掛掉的後台
- **後台 Google 登入**：管理介面改用 Google 帳號驗證

### SEO 基礎
- 麵包屑、網址結尾斜線正規化、清理失效圖片
- Cloudflare Web Analytics 安裝、字體載入優化

### 搜尋與索引（PR #172）
- **IndexNow**：新文發布自動通知 Bing/Yandex,幾分鐘內被索引
- **文章目錄 TOC**：長文自動從 h2/h3 產生錨點目錄（≥3 標題才顯示）

### 每日成效報告（PR #172, #173）
- 排程每天 09:00（台灣時間）抓 Cloudflare Web Analytics
- 報告貼到固定 GitHub Issue「📊 operation.tw 每日成效報告」,@提及通知
- 不需 email 服務、用 GitHub 內建權限

### AI 搜尋優化 AEO/GEO（PR #175）
- **robots.txt** 明確歡迎 GPTBot / OAI-SearchBot / ClaudeBot / PerplexityBot / Google-Extended 等
- **新聞文 prompt** 改為「答案先行 TL;DR + 問句式 h2 + 文末 FAQ」→ 新文自動帶結構化問答
- **llms-full.txt**：全站文章全文純文字版,供 LLM 一次擷取
- FAQPage JSON-LD：有 FAQ 內容的文章自動產生結構化問答

### 流量技術開關（PR #177）
- **`max-image-preview:large`**：開啟 Google Discover 與大圖預覽資格
- **圖片 sitemap**：sitemap 加 `<image:image>` → Google 圖片搜尋流量
- **上一篇／下一篇導覽**：同分類,提升 pages/session

### 效能 + E-E-A-T（PR #178）
- **文章封面 WebP**：`<picture>` + WebP（201 張,省 ~20-35%）+ width/height 降 CLS
- 新封面在 CI 自動轉 WebP
- **首頁字體瘦身**：砍掉未用的中間字重
- **文章作者署名**：可見 byline（Jin,rel=author）

### 工具
- **舊文 FAQ 回填工具**（PR #176）：手動觸發、批次量可控、可 dry-run 預覽（已測試通過）

---

## 👉 待你操作（每項只需一個動作）

| 項目 | 你要做的 | 完成後 |
|---|---|---|
| **每日報告** | Cloudflare → API Tokens → 你的 token 加 **Account · Analytics · Read** 權限 | 報告天天自動進 GitHub Issue |
| **舊文 FAQ 回填** | Actions → Backfill FAQ → 先 `dry_run=true` 預覽 → 滿意改 `false` | 高流量舊文補上 FAQ/TL;DR |
| **Giscus 留言** | repo 開 Discussions + 裝 giscus App → giscus.app 拿 repo/category ID 給我 | 我注入留言系統 |
| **Google Search Console** | search.google.com/search-console → 提交 `sitemap.xml` → 看「曝光高點擊低」的查詢調標題 | 撿現有排名的免費流量 |

---

## 🚀 未來成長方向（內容與營運）

### 內容策略（最大槓桿）
> 現況：278 篇中僅約 9 篇是「常青型」,其餘 97% 是會過期的時效新聞 —— 這是流量天花板的根因。

- **補常青內容**：比較/推薦清單（「2026 最好用的 AI 工具」「AWS vs GCP」）、教學/入門指南、年度趨勢
- **Pillar 主題頁**：把 104 篇 AI 串成「AI 完整指南」Hub,衝大關鍵字 + 內部連結灌權重

### 內容分發（借別人的流量）
- **Medium**（Publication「操作一下」已建）：用 `medium.com/p/import` 貼網址,自動設好 canonical 指回原文
- **方格子 Vocus**：發「導讀版」（精華 + 完整全文連結）導流回站
- **Podcast → YouTube 影片**：YouTube 是第二大搜尋引擎

### 自有受眾（回訪複利）
- **電子報真的開始寄**：訂閱框已收集,但尚未寄送 —— 最強的回訪槓桿

---

## 🔧 技術備忘
- 靜態建置：`node scripts/build-static.js`（含 WebP 產生、TOC、sitemap、llms）
- 內容發布：`podcast-to-post.js`(Podcast)、`auto-post.js`(每日新聞)
- 既有 secrets：`CF_API_BASE`、`CF_SERVICE_TOKEN`、`ANTHROPIC_API_KEY`、`CLOUDFLARE_*`
- IndexNow 金鑰檔：根目錄 `c14d5af63b5b06532e52a3306d2d9204.txt`
