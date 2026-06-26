#!/usr/bin/env bash
# operation.tw — Cloudflare 一鍵部署（wrangler 部分）
# 在「你自己的電腦」執行（需先 npm i -g wrangler && wrangler login）。
# 後台操作（網域接 Cloudflare、Access、改 nameserver）無法腳本化，見 README.md。
set -euo pipefail
cd "$(dirname "$0")/.."   # 切到 repo 根目錄

# ── 資料來源 ─────────────────────────────────────────────────
# 預設 SEED_SOURCE=repo：直接用 repo 內 posts.json + 靜態頁產生 seed（不需 Supabase）。
# 若要從 Supabase 匯出（含草稿/訂閱者），設 SEED_SOURCE=supabase 並提供 SUPABASE_URL/SERVICE_KEY。
SEED_SOURCE="${SEED_SOURCE:-repo}"
# SERVICE_TOKEN：給 GitHub Actions 用的長隨機字串；沒給就自動產一組
SERVICE_TOKEN="${SERVICE_TOKEN:-$(openssl rand -hex 32)}"
DB_NAME="operation-tw"

echo "▸ 0/6 檢查 wrangler 登入狀態"
wrangler whoami >/dev/null || { echo "請先 wrangler login"; exit 1; }

echo "▸ 1/6 建立 D1（已存在會略過）"
if ! wrangler d1 list 2>/dev/null | grep -q "$DB_NAME"; then
  wrangler d1 create "$DB_NAME"
fi
# 取出 database_id 並寫回 wrangler.toml
DB_ID="$(wrangler d1 list --json 2>/dev/null | python3 -c "import sys,json;[print(d['uuid']) for d in json.load(sys.stdin) if d['name']=='$DB_NAME']")"
if [ -z "$DB_ID" ]; then echo "找不到 $DB_NAME 的 database_id"; exit 1; fi
python3 - "$DB_ID" <<'PY'
import re,sys
p='cloudflare/wrangler.toml'; s=open(p).read()
s=re.sub(r'database_id = "[^"]*"', f'database_id = "{sys.argv[1]}"', s)
open(p,'w').write(s); print("  ✓ wrangler.toml database_id =", sys.argv[1])
PY

echo "▸ 2/6 套用 schema 到 D1"
wrangler d1 execute "$DB_NAME" --remote --file=cloudflare/schema.sql

echo "▸ 3/6 產生 seed（來源：$SEED_SOURCE）"
if [ "$SEED_SOURCE" = "supabase" ]; then
  : "${SUPABASE_URL:?supabase 模式需 SUPABASE_URL}"
  : "${SUPABASE_SERVICE_KEY:?supabase 模式需 SUPABASE_SERVICE_KEY}"
  node cloudflare/migrate-from-supabase.js          # 產生 cloudflare/seed.sql（單檔）
  SEED_FILES="cloudflare/seed.sql"
else
  node cloudflare/seed-from-repo.js                 # 從 repo 產生 cloudflare/seed/*.sql（多檔）
  SEED_FILES="cloudflare/seed/*.sql"
fi

echo "▸ 4/6 灌資料進 D1"
for f in $SEED_FILES; do
  echo "  載入 $f"
  wrangler d1 execute "$DB_NAME" --remote --file="$f"
done
echo "  驗證："
wrangler d1 execute "$DB_NAME" --remote --command "select count(*) as posts from posts"

echo "▸ 5/6 部署 Worker（先部署，secret 才能掛上去）"
wrangler deploy --config cloudflare/wrangler.toml

echo "▸ 6/6 設定 SERVICE_TOKEN 機密（即時生效，不需再部署）"
printf '%s' "$SERVICE_TOKEN" | wrangler secret put SERVICE_TOKEN --config cloudflare/wrangler.toml

cat <<EOF

✅ wrangler 部分完成。

接下來「手動」的部分（見 cloudflare/README.md）：
  • 步驟 3  ：在 Google Cloud Console 建 OAuth Client ID（Web 應用程式，
              Authorized JS origins 加 https://operation.tw），把 Client ID 填進
              js/api-config.js 與 wrangler.toml 的 GOOGLE_CLIENT_ID，然後再 wrangler deploy 一次
  • 步驟 0.5：（可選）想綁 api.operation.tw 才需把網域接進 Cloudflare；
              否則直接用上面 deploy 出來的 *.workers.dev 網址即可
  • GitHub  ：Repo Secrets 加入
                CF_API_BASE      = 你的 Worker 網址（api.operation.tw 或 *.workers.dev）
                CF_SERVICE_TOKEN = $SERVICE_TOKEN

驗證：
  curl <你的 Worker 網址>/api/health      # 期望 {"ok":true}
EOF
