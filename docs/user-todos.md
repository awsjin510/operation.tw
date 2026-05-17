# 使用者待辦清單（部署後手動執行）

> 以下為 Claude Code 無法代為操作的項目，請在部署完成後依序處理。

---

## 1. Google Search Console — 提交新 sitemap

1. 前往 [Google Search Console](https://search.google.com/search-console)
2. 選擇 `operation.tw` 資源
3. 左側選單 → **Sitemaps（網站地圖）**
4. 輸入 `sitemap.xml` → **提交**
5. 確認狀態為「成功」

---

## 2. 要求重新索引重點頁面

在 Google Search Console 的**網址檢查**功能，對以下頁面點選「要求建立索引」：

- `https://operation.tw/`（首頁）
- `https://operation.tw/post/105`（最新文章）
- `https://operation.tw/post/104`
- `https://operation.tw/post/103`
- `https://operation.tw/post/102`
- `https://operation.tw/post/101`

---

## 3. 確認舊頁面已轉址（非 404）

在 **涵蓋範圍（Coverage）** 報告中觀察：

- 舊網址（`/publiccloud/`、`/category/雲端/` 等）應顯示為「已透過重新導向排除」
- 如仍顯示 404，請至主機後台補設 HTTP 301 規則（見下方說明）

---

## 4. 主機層設定 HTTP 301（強烈建議）

目前的轉址頁使用 HTML meta-refresh，效果次於 HTTP 301。
若主機支援 redirect 設定，請參考 `docs/redirects.md` 補設：

### 若部署在 Zeabur
請至 Zeabur 後台查詢是否有 Redirect 設定；或聯繫 Zeabur 客服確認。

### 若遷移至 Cloudflare Pages / Netlify
在 repo 根目錄新增 `_redirects`：
```
/about/*        https://operation.tw/#about              301
/category/*     https://operation.tw/                    301
/publiccloud/*  https://operation.tw/                    301
/podcast/*      https://operation.tw/podcast.html        301
/cloud/*        https://operation.tw/                    301
/security/*     https://operation.tw/                    301
/ai/*           https://operation.tw/                    301
```

---

## 5. 每次發新文後需做的事

```bash
# 同步 posts.json（如有腳本）
node scripts/sync-posts-json.js

# 重新產生各文章頁面
node scripts/build-static.js

# 重新產生 sitemap + feed
node scripts/generate-sitemap.js

# commit & push
git add -A
git commit -m "新增文章 XXX"
git push
```

---

## 6. 驗收確認清單

- [ ] `curl https://operation.tw/` → HTML 中看到文章標題（不執行 JS）
- [ ] `curl https://operation.tw/post/105` → 看到文章 `<h1>` 與 JSON-LD
- [ ] `curl https://operation.tw/about/` → 看到 `meta http-equiv="refresh"`
- [ ] `curl https://operation.tw/sitemap.xml | grep -c "<url>"` → 回傳 100
- [ ] `curl https://operation.tw/llms.txt` → 看到文章清單
- [ ] Google Rich Results Test 測試 `/post/105` → BlogPosting 驗證通過
