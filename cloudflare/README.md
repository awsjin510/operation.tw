# Supabase → Cloudflare 遷移 Runbook

把 `operation.tw` 的資料層從 Supabase 搬到 **Cloudflare D1 + Worker**，後台登入改用
**直接 Google 登入（Google Identity Services）**。前端與 GitHub Actions 改打 Worker API。

> 我（Claude）能寫好所有程式碼，但**開資源、建 Google OAuth、綁網域這些操作要你來跑**。
> 以下指令在你本機（已 `wrangler login`）執行即可。

---

## 架構對照

| Supabase | Cloudflare |
|---|---|
| Postgres 資料表 | **D1**（`cloudflare/schema.sql`） |
| PostgREST 自動 API + RPC | **Worker**（`cloudflare/worker.js`） |
| Auth（密碼登入） | **Google 登入**（前端 GSI 取 ID token；Worker 驗章 + Email 白名單） |
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

### 0.5 把網域接進 Cloudflare（只為了綁 `api.operation.tw`；可選）
> 現況：operation.tw 由 **GitHub Pages** 服務（A record 185.199.108–111.153），DNS 不在 Cloudflare。
> **因為改用 Google 直接登入，auth 已不需要這一步**；只有當你想要漂亮的
> `api.operation.tw` 自訂網域時才需要（Worker 自訂網域要求 zone 在 Cloudflare）。
> 想最省事：先跳過這步，用預設 `*.workers.dev` 網址（CORS 已設好，照樣能動）。

若要綁 `api.operation.tw`：
1. Cloudflare 後台 → **Add a site** → 輸入 `operation.tw` → Free 方案。
2. 確認保留 GitHub Pages 的四個 A record（`185.199.108–111.153`，**橙雲 Proxied**）；`www` CNAME 一併保留。
3. 到註冊商把 **nameserver 改成 Cloudflare 指定的兩台**，等生效（`curl -sI https://operation.tw` 出現 `cf-ray` 即成功）。
4. SSL/TLS 設 **Full**（GitHub Pages 有有效憑證）。站台 origin 沒變，只是前面多了 Cloudflare。

> 用 `*.workers.dev` 時：把 `js/api-config.js` 的 `API_BASE` 設成該網址，並把它加進
> `wrangler.toml` 的 `ALLOWED_ORIGINS` 不需要（CORS 看的是前端來源 operation.tw）。
> 同時把 `wrangler.toml` 的 `[[routes]]` 區塊註解掉（不綁自訂網域）。

### 1. 建立 D1 並套用 schema
```bash
wrangler d1 create operation-tw
# ↑ 把輸出的 database_id 貼進 cloudflare/wrangler.toml 的 database_id
wrangler d1 execute operation-tw --remote --file=cloudflare/schema.sql
```

### 2. 灌資料進 D1

**（預設）方案 A — 從 repo 產生，不需 Supabase**
直接用 repo 內 `posts.json`（metadata）+ `post/<id>/index.html`（完整內文）產生 seed：
```bash
node cloudflare/seed-from-repo.js                 # 產生 cloudflare/seed/*.sql（已分段，避免 D1 100KB 單句上限）
for f in cloudflare/seed/*.sql; do
  wrangler d1 execute operation-tw --remote --file="$f"
done
wrangler d1 execute operation-tw --remote --command "select count(*) from posts"   # 應為 270
```
> 取捨：拿不到「草稿」「訂閱者名單」「精確的 site_stats」（這些只在 Supabase）。
> 已發布文章與內文 100% 完整。settings 留空 → 後台用內建預設值，可在新後台重存。

**方案 B — 從 Supabase 匯出（要 Supabase 還活著，含草稿/訂閱者）**
```bash
SUPABASE_URL=https://pvqvnmntqhsfzarbxayf.supabase.co \
SUPABASE_SERVICE_KEY=<你的 service key> \
node cloudflare/migrate-from-supabase.js          # 產生 cloudflare/seed.sql
wrangler d1 execute operation-tw --remote --file=cloudflare/seed.sql
```

### 3. 建立 Google 登入（OAuth 用戶端）
後台用「直接 Google 登入」（不需 Cloudflare Access / Zero Trust）。在
**Google Cloud Console**（https://console.cloud.google.com）：

1. 建一個專案（或用現有的）。
2. **APIs & Services → OAuth consent screen**：
   - User type 選 **External** → 建立。
   - App name、support email 填一填；Audience 階段先設 **Testing** 即可，
     在 **Test users** 加入 `awsjin510@gmail.com`、`keepfighting510@gmail.com`
     （只有測試使用者能登入，不需 Google 審核）。
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**：
   - Application type：**Web application**
   - **Authorized JavaScript origins** 加入後台頁面的來源（精確比對，要有 https、不含路徑）：
     - `https://operation.tw`
     - `https://www.operation.tw`（若會用 www）
     - 本機測試另加 `http://localhost:8787` 等
   - **Authorized redirect URIs**：用 Google Identity Services（GSI）按鈕**不需要**填，可留空。
   - 建立後複製 **Client ID**（形如 `xxxx.apps.googleusercontent.com`）。

把這個 Client ID 同時填到兩個地方：
- `js/api-config.js` 的 `window.GOOGLE_CLIENT_ID`
- `cloudflare/wrangler.toml` 的 `GOOGLE_CLIENT_ID`（Worker 驗證 token 的 audience）

> 運作方式：admin.html 顯示「Sign in with Google」按鈕 → 使用者登入 → 瀏覽器拿到
> Google **ID token** → 隨每個 `/api/admin/*` 請求以 `Authorization: Bearer` 送出 →
> Worker 用 Google 公鑰驗章、檢查 audience＝你的 Client ID、且 email 在 `ADMIN_EMAILS` 白名單。

### 4. 設定 Worker 機密並部署
```bash
cd cloudflare
# 給 GitHub Actions 用的長隨機字串（自己產，例：openssl rand -hex 32）
wrangler secret put SERVICE_TOKEN
wrangler deploy
```
部署後會得到 Worker 網址。**建議綁自訂網域** `api.operation.tw`（wrangler.toml 已設
`[[routes]] custom_domain`，需網域 zone 在 Cloudflare 上）。想零 DNS 變動可先用
預設 `*.workers.dev` 網址測試——因為走 Google 直接登入＋CORS，跨網域也能運作。

### 5. 前端切換 API 來源
編輯 `js/api-config.js`：
```js
window.API_BASE = 'https://api.operation.tw';   // 或 workers.dev 網址
window.GOOGLE_CLIENT_ID = 'xxxx.apps.googleusercontent.com';
```
`index.html`（公開端點）與 `admin.html`（Google 登入）已改成讀這些變數。

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
後台：開 `operation.tw/admin.html` → 顯示「Sign in with Google」按鈕 → 用白名單帳號登入 → 看得到文章清單。

### （可選）先在本機測整套 Worker + D1
不需 Cloudflare 帳號，用 wrangler 本地模式（已驗證可行）：
```bash
cd cloudflare && npm i        # 安裝 wrangler（devDependency）
npx wrangler d1 execute operation-tw --local --config wrangler.dev.toml --file=schema.sql
echo "SERVICE_TOKEN=devtoken-abc123" > .dev.vars
npx wrangler dev --config wrangler.dev.toml --port 8787 --local
# 另開終端：
curl localhost:8787/api/health
curl localhost:8787/api/admin/posts -H "Authorization: Bearer devtoken-abc123"
```

---

## 切換順序（重要，避免線上壞掉）
1. 先把 Worker 部署好、資料灌好、Google OAuth 設好（線上前端**還在用 Supabase**，不受影響）。
2. 驗證 API 全綠。
3. 合併本分支（前端 + 腳本改打 Worker）。
4. 觀察一兩天。確認沒問題再去 Supabase 暫停專案。

## 回滾
前端只要把 `js/api-config.js` 指回舊行為（或 revert 本分支）即可；Supabase 專案在切換期間**先別刪**，留作後路。

## 成本
D1 免費額度：5GB 儲存、每日 500 萬列讀 / 10 萬列寫——對這個站綽綽有餘，且**不像 Supabase 有 egress 上限**。
