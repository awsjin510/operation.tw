/**
 * indexnow.js — 發布新文後通知 IndexNow（Bing / Yandex 等），加速被索引。
 * 金鑰檔需放在網站根目錄：https://operation.tw/<KEY>.txt（內容即 KEY）。
 * 文件：https://www.indexnow.org/documentation
 */
'use strict';

const KEY = 'c14d5af63b5b06532e52a3306d2d9204';
const HOST = 'operation.tw';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

/**
 * @param {string[]} urls 要通知的完整網址（同一 host）
 */
async function ping(urls) {
  const urlList = [...new Set((urls || []).filter(Boolean))];
  if (!urlList.length) return;
  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    });
    // IndexNow 成功回 200 或 202；其他狀態不致命，只記錄。
    console.log(`  ↪ IndexNow 已提交 ${urlList.length} 個網址（HTTP ${res.status}）`);
  } catch (err) {
    console.warn(`  ⚠ IndexNow 提交失敗（不影響發布）：${err.message}`);
  }
}

module.exports = { ping, KEY, HOST };
