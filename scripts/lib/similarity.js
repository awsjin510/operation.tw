'use strict';
// 文章相似度：auto-post 去重、build-static 的「重複文自動分群」與「延伸閱讀」共用同一套。
// 門檻以 2026-08 以來實際重複的自動新聞校準：
//   標題重疊度（交集 / 較短者）≥ 0.4，或「標題＋摘要」Jaccard ≥ 0.15 → 視為同主題。
//   真重複落在 0.40～0.70 / 0.15～0.31；不同主題分別多在 0.33 / 0.14 以下。

const DUP_TITLE = 0.4;
const DUP_TEXT = 0.15;

// 中文常見但不帶主題資訊的二字詞（「台灣企業如何…」幾乎每篇都有）
const TITLE_STOP = new Set('台灣 灣企 企業 業如 如何 何應 時代 背後 為什 什麼 麼是 解析 啟示 新的 的新 灣科 科技 技企 業的 的合 你的 我們 全球 趨勢 關鍵 下一 一步 真正 重塑 影響 挑戰 機會 崛起'.split(' '));

function tokens(t) {
  t = String(t || '').toLowerCase().replace(/^[a-z]{1,6}\d{1,4}\s*[｜|_]/, '');
  const words = (t.match(/[a-z0-9][a-z0-9.+-]*/g) || []).filter((w) => w.length > 1 && w !== 'ai');
  const bigrams = [];
  for (const seg of t.replace(/[^㐀-鿿]/g, ' ').split(/\s+/).filter(Boolean)) {
    for (let i = 0; i < seg.length - 1; i++) { const b = seg.slice(i, i + 2); if (!TITLE_STOP.has(b)) bigrams.push(b); }
  }
  return new Set([...words, ...bigrams]);
}

function titleSimilarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

function textJaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / ((A.size + B.size - n) || 1);
}

const fullText = (p) => `${p.title} ${p.excerpt || ''}`;

function isDuplicate(a, b, title = DUP_TITLE, text = DUP_TEXT) {
  return titleSimilarity(a.title, b.title) >= title || textJaccard(fullText(a), fullText(b)) >= text;
}

module.exports = { DUP_TITLE, DUP_TEXT, tokens, titleSimilarity, textJaccard, fullText, isDuplicate };
