# D1 資料庫備份

`d1-latest.json.gz.enc` 由排程 workflow（`backup-d1.yml`）每日產生：
包含 **posts / settings / site_stats / subscribers** 全部資料，
gzip 壓縮後以 **AES-256-GCM** 加密（金鑰＝SHA-256(`CF_SERVICE_TOKEN`)）。
歷史版本都在 git history 裡（`git log -- backups/`）。

## 還原（災難復原）

```bash
# 1. 解密（需要 CF_SERVICE_TOKEN）
CF_SERVICE_TOKEN='<token>' node scripts/backup-d1.js --decrypt backups/d1-latest.json.gz.enc > restore.json

# 2. 檢視內容
node -e "const d=require('./restore.json');console.log(Object.keys(d).map(k=>k+': '+(d[k].length??'-')).join('\n'))"

# 3. 回灌文章（Worker API 支援陣列批次新增）
#    posts → POST /api/admin/posts；settings → PUT /api/admin/settings/:key
#    subscribers 可直接用 wrangler d1 execute 匯入
```

> ⚠️ repo 是公開的，備份**必須**保持加密——訂閱者 email 屬個資。
