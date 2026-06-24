// Cloudflare Worker API 來源。
// 預設空字串＝同網域（建議）：Worker 掛在 operation.tw/api/* 的路由，
// 與前端同源 → 無 CORS、後台 Access cookie 自動帶上，最簡單可靠。
//
// 若你改用獨立子網域（例 https://api.operation.tw），把下面改成該網址，
// 並記得在 worker.js 的 CORS、Access、CSP 一併設定該網域。
window.API_BASE = '';
