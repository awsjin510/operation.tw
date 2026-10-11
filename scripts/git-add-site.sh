#!/usr/bin/env bash
# 把 build-static 等腳本產生的網站檔案全部 stage 起來。
# 各 workflow 共用這一份清單：新增產出檔時只要改這裡，不會再漏 commit（漏了就不會部署）。
set -u
cd "$(dirname "$0")/.."
FILES=(
  index.html podcast.html 404.html search/ search-index.json
  posts.json episodes.json episodes-lite.json podcast-posts.json glossary.json
  post/ category/ faq/ glossary/ images/
  sitemap.xml feed.xml llms.txt llms-full.txt
)
for f in "${FILES[@]}"; do
  [ -e "$f" ] && git add -- "$f"
done
exit 0
