'use strict';
// Podcast 集數碼的唯一實作：podcast-to-post / update-podcast-titles / build-static 都用這支，
// 規則改一次就全站一致（以前三份複製的 regex 各自漂移，AI56 這類標題就漏掉了）。

// 從標題開頭抓集數碼（AI35 / EP99 / EP01…）
function episodeCode(title) {
  const t = String(title || '').trim();
  // 一般情況：碼後接分隔符（AI35_… / EP99｜…）
  const m = t.match(/^([A-Za-z]{1,6}\d{1,4})\s*[_|｜\-:：．.]/);
  if (m) return m[1].toUpperCase();
  // 單集標題偶爾碼後直接接中文（AI56趨勢操作｜…）；只認 AI/EP，避免把 APT28、AWS20 之類誤判成集數
  const m2 = t.match(/^((?:AI|EP)\d{1,4})(?=[\u3400-\u9fff])/i);
  return m2 ? m2[1].toUpperCase() : '';
}

module.exports = { episodeCode };
