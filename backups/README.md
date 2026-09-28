# D1 資料庫備份

`backup-d1.yml` 每天把 D1 的 **posts / settings / site_stats / subscribers** 匯出，
gzip 後以 **AES-256-GCM** 加密，存成 **GitHub Actions artifact**（`d1-backup-<run_id>`，保留 90 天）。

> 備份**不再 commit 進 repo**：repo 與網站都是公開的，訂閱者 email 屬個資。
> 這個資料夾只保留說明文件，`*.enc` 已列入 `.gitignore`。

## 金鑰

- 有 repo secret `BACKUP_KEY` → 用 scrypt 衍生金鑰（v2 格式，建議）。
  **請另存一份 BACKUP_KEY 在密碼管理器**，GitHub secret 設定後無法再讀出。
- 沒設 `BACKUP_KEY` → 退回 SHA-256(`CF_SERVICE_TOKEN`)（v1 舊格式）。

## 還原（災難復原）

```bash
# 1. 下載最新備份
gh run download -R awsjin510/operation.tw -n d1-backup-<run_id>

# 2. 解密（v1/v2 自動判斷）
BACKUP_KEY='<key>' node scripts/backup-d1.js --decrypt d1-latest.json.gz.enc > restore.json
#   舊 v1 備份改用：CF_SERVICE_TOKEN='<token>' node scripts/backup-d1.js --decrypt …

# 3. 檢視內容
node -e "const d=require('./restore.json');console.log(Object.keys(d).map(k=>k+': '+(d[k].length??'-')).join('\n'))"

# 4. 回灌文章（Worker API 支援陣列批次新增）
#    posts → POST /api/admin/posts；settings → PUT /api/admin/settings/:key
#    subscribers 可直接用 wrangler d1 execute 匯入
```
