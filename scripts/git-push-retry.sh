#!/usr/bin/env bash
# 把目前分支已 commit 的內容推上 origin/main，衝突時 rebase 後重試。
# 多個排程 workflow 會同時寫 repo，所以需要重試；三次都失敗就 exit 1，
# 讓 workflow 顯示失敗（以前的迴圈會吞掉失敗、內容默默遺失）。
# --autostash：build 產物若有未 git add 的檔案，rebase 不會因 unstaged changes 失敗。
set -u
for attempt in 1 2 3; do
  if git pull --rebase --autostash origin main && git push origin HEAD:main; then
    echo "✓ push 成功（第 ${attempt} 次）"
    exit 0
  fi
  echo "push 失敗，$((attempt * 3))s 後重試…"
  sleep $((attempt * 3))
done
echo "❌ push 連續 3 次失敗"
exit 1
