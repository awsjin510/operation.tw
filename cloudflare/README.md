# Supabase → Cloudflare 遷移 Runbook

把 `operation.tw` 的資料層從 Supabase 搬到 **Cloudflare D1 + Worker**，後台登入改用
**Cloudflare Access（Google 登入）**。前端與 GitHub Actions 改打 Worker API。

> 我（Claude）能寫好所有程式碼，但**開資源、設 Access、綁網域這些後台操作要你來跑**。
> 以下指令在你本機（已 `wrangler login`）執行即可。

---

## 架構對照

| Supabase | Cloudflare |
|---|---|
| Postgres 資料表 | **D1**（`cloudflare/schema.sql`） |
| PostgREST 自動 API + RPC | **Worker**（`cloudflare/worker.js`） |
| Auth（密碼登入） | **Cloudflare Access**（Google） |
| RLS 權限 | Worker 內的授權判斷 |
| Service key（Actions 寫入） | Worker 的 `SERVICE_TOKEN` |

前端「讀」的部分（首頁清單、文章內文）**仍走靜態 `posts.json` 與靜態頁**（GitHub Pages，免費流量）。
Worker 只負責：瀏覽計數、電子報訂閱、後台 CRUD。

---

## 步驟

### 0. 前置
```bash
npm i -g wrangler
wrangler login          # 用你已登入 Cloudflare 的帳號授權
```

### 0.5 把網域 DNS 搬到 Cloudflare（保留 GitHub Pages 當原站）
> 現況確認：operation.tw 由 **GitHub Pages** 服務（A record 指向 185.199.108–111.153），
> DNS **不在** Cloudflare。同網域方案（operation.tw/api/*）需要流量經過 Cloudflare，
> 故先把網域接進 Cloudflare —— **這是搬 DNS，不是搬主機，GitHub Pages 繼續服務靜態站**。

1. Cloudflare 後台 → **Add a site** → 輸入 `operation.tw` → 選 Free 方案。
2. Cloudflare 會掃描現有 DNS。確認保留 GitHub Pages 的紀錄（四個 A record 指向
   `185.199.108.153`、`.109.153`、`.110.153`、`.111.153`，**橙雲 Proxied**）。
   `www` 的 CNAME（若有）也設 Proxied。
3. 到你的網域註冊商，把 **nameserver 改成 Cloudflare 指定的兩台**（例 `xxx.ns.cloudflare.com`）。
   等生效（通常數分鐘到數小時）。生效後 `curl -sI https://operation.tw` 應出現 `cf-ray` 標頭。
4. SSL/TLS 模式設 **Full**（GitHub Pages 有有效憑證）。
5. 確認站台照常開得起來（GitHub Pages origin 沒變，只是前面多了 Cloudflare）。

> 不想搬 DNS 的替代方案：後台改放 `admin.operation.tw`，單獨用 Cloudflare Pages/Worker
> 服務並掛 Access；前台 operation.tw 維持 GitHub Pages。較多零件，非預設路徑。

### 1. 建立 D1 並套用 schema
```bash
wrangler d1 create operation-tw
# ↑ 把輸出的 database_id 貼進 cloudflare/wrangler.toml 的 database_id
wrangler d1 execute operation-tw --remote --file=cloudflare/schema.sql
```

### 2. 從 Supabase 匯出資料 → 灌進 D1
```bash
# 用你的 Supabase 專案網址與 service key
SUPABASE_URL=https://pvqvnmntqhsfzarbxayf.supabase.co \
SUPABASE_SERVICE_KEY=<你的 service key> \
node cloudflare/migrate-from-supabase.js          # 產生 cloudflare/seed.sql

wrangler d1 execute operation-tw --remote --file=cloudflare/seed.sql
# 驗證：
wrangler d1 execute operation-tw --remote --command "select count(*) from posts"
```

### 3. 設定 Cloudflare Access（Google 登入保護後台）
在 Cloudflare 後台 **Zero Trust → Access → Applications → Add application（Self-hosted）**：
- **Application domain**：保護兩條路徑
  - `operation.tw/admin.html`（後台頁面本身）
  - `api.operation.tw/api/admin`（後台 API；若 Worker 用 workers.dev 網域，填那個）
- **Identity provider**：加入 **Google**（Zero Trust → Settings → Authentication）
- **Policy**：Action = Allow，Include → Emails → `awsjin510@gmail.com`、`keepfighting510@gmail.com`
- 建好後在應用程式的 **Overview** 複製 **Application Audience (AUD) Tag**
- 你的團隊網域在 Zero Trust → Settings → Custom Pages，形如 `yourteam.cloudflareaccess.com`

把這兩個值填進 `cloudflare/wrangler.toml`：
```toml
ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
ACCESS_AUD = "<剛剛複製的 AUD>"
```

### 4. 設定 Worker 機密並部署
```bash
cd cloudflare
# 給 GitHub Actions 用的長隨機字串（自己產，例：openssl rand -hex 32）
wrangler secret put SERVICE_TOKEN
wrangler deploy
```
部署後會得到 Worker 網址（`https://operation-tw-api.<子網域>.workers.dev` 或你綁的 `api.operation.tw`）。
**建議綁自訂網域** `api.operation.tw`（解開 wrangler.toml 的 `[[routes]]` 區塊再 deploy）。

### 5. 前端切換 API 來源
編輯 `js/api-config.js`，把 `API_BASE` 改成你的 Worker 網址：
```js
window.API_BASE = 'https://api.operation.tw';   // 或 workers.dev 網址
```
`index.html` 與 `admin.html` 已改成讀這個變數（見前端改動）。

### 6. GitHub Actions 換密鑰
Repo → Settings → Secrets and variables → Actions，新增：
- `CF_API_BASE` = 你的 Worker 網址
- `CF_SERVICE_TOKEN` = 步驟 4 設定的同一串

腳本（`podcast-to-post.js` / `sync-posts-json.js`）已改成讀這兩個；舊的 `SUPABASE_*` 可保留備援。

### 7. 驗證後再切換
```bash
curl https://api.operation.tw/api/health                 # {"ok":true}
curl https://api.operation.tw/api/posts | head -c 200    # 文章清單
curl -X POST https://api.operation.tw/api/views/site     # {"total":..,"today":..}
```
後台：開 `operation.tw/admin.html` → 應跳 Google 登入 → 進得去且看得到文章清單。

---

## 切換順序（重要，避免線上壞掉）
1. 先把 Worker 部署好、資料灌好、Access 設好（線上前端**還在用 Supabase**，不受影響）。
2. 驗證 API 全綠。
3. 合併本分支（前端 + 腳本改打 Worker）。
4. 觀察一兩天。確認沒問題再去 Supabase 暫停專案。

## 回滾
前端只要把 `js/api-config.js` 指回舊行為（或 revert 本分支）即可；Supabase 專案在切換期間**先別刪**，留作後路。

## 成本
D1 免費額度：5GB 儲存、每日 500 萬列讀 / 10 萬列寫——對這個站綽綽有餘，且**不像 Supabase 有 egress 上限**。
