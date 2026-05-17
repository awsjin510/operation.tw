# 舊網址轉址對照表

> 舊站（WordPress）改版後，以下舊網址已設定自動轉址。
> 轉址方式：HTML meta-refresh + JS redirect（靜態主機）。
> 若主機支援 HTTP 301，可在主機後台（Zeabur/Cloudflare Pages 等）補設定。

## 轉址清單

| 舊網址 | 新目標 | 說明 |
|---|---|---|
| `/about/` | `https://operation.tw/#about` | 關於我頁面 |
| `/category/雲端/` | `https://operation.tw/` | 雲端分類頁 |
| `/category/資安/` | `https://operation.tw/` | 資安分類頁 |
| `/category/AI/` | `https://operation.tw/` | AI 分類頁 |
| `/category/閱讀/` | `https://operation.tw/` | 閱讀分類頁 |
| `/category/成長/` | `https://operation.tw/` | 成長分類頁 |
| `/publiccloud/` | `https://operation.tw/` | 舊版公有雲頁面 |
| `/podcast/` | `https://operation.tw/podcast.html` | Podcast 頁面 |
| `/cloud/` | `https://operation.tw/` | 舊版雲端頁面 |
| `/security/` | `https://operation.tw/` | 舊版資安頁面 |
| `/ai/` | `https://operation.tw/` | 舊版 AI 頁面 |

## 各文章舊網址

如有舊文章 slug 網址（如 `/publiccloud/aws-intro/`），
請至 Google Search Console 的「涵蓋範圍」報告匯出完整清單，
再為每個舊 URL 建立對應的轉址規則。

## 如何設定 HTTP 301（建議）

靜態主機層的 301 轉址優於 meta-refresh，對 SEO 更有效：

**Zeabur**：目前查無自訂 redirect 設定介面，建議與客服確認。

**Cloudflare Pages**：在 repo 根目錄新增 `_redirects`：
```
/about/*       https://operation.tw/#about   301
/category/*    https://operation.tw/         301
/publiccloud/* https://operation.tw/         301
/podcast/*     https://operation.tw/podcast.html  301
```

**Netlify**：格式相同，同樣放 `_redirects` 在根目錄。
