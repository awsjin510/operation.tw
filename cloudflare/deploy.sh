#!/usr/bin/env bash
# operation.tw — Cloudflare 一鍵部署（wrangler 部分）
# 在「你自己的電腦」執行（需先 npm i -g wrangler && wrangler login）。
# 後台操作（網域接 Cloudflare、Access、改 nameserver）無法腳本化，見 README.md。
set -euo pipefail
cd "$(dirname "$0")/.."   # 切到 repo 根目錄

# ── 你要填的值 ───────────────────────────────────────────────
: "${SUPABASE_URL:?請設定 SUPABASE_URL（用來匯出舊資料）}"
: "${SUPABASE_SERVICE_KEY:?請設定 SUPABASE_SERVICE_KEY}"
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

echo "▸ 3/6 從 Supabase 匯出資料 → seed.sql"
SUPABASE_URL="$SUPABASE_URL" SUPABASE_SERVICE_KEY="$SUPABASE_SERVICE_KEY" \
  node cloudflare/migrate-from-supabase.js

echo "▸ 4/6 灌資料進 D1"
wrangler d1 execute "$DB_NAME" --remote --file=cloudflare/seed.sql
echo "  驗證："
wrangler d1 execute "$DB_NAME" --remote --command "select count(*) as posts from posts"

echo "▸ 5/6 設定 SERVICE_TOKEN 機密"
printf '%s' "$SERVICE_TOKEN" | wrangler secret put SERVICE_TOKEN --config cloudflare/wrangler.toml

echo "▸ 6/6 部署 Worker"
wrangler deploy --config cloudflare/wrangler.toml

cat <<EOF

✅ wrangler 部分完成。

接下來「手動」的部分（見 cloudflare/README.md）：
  • 步驟 0.5：把 operation.tw 接進 Cloudflare、改 nameserver（保留 GitHub Pages origin）
  • 步驟 3  ：設定 Cloudflare Access（Google 登入 + Email 白名單），
              把 ACCESS_TEAM_DOMAIN / ACCESS_AUD 填進 wrangler.toml 後再 wrangler deploy 一次
  • GitHub  ：Repo Secrets 加入
                CF_API_BASE      = https://operation.tw
                CF_SERVICE_TOKEN = $SERVICE_TOKEN

驗證：
  curl https://operation.tw/api/health      # 期望 {"ok":true}（需先完成 0.5 並等 DNS 生效）
EOF
