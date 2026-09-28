// 題目附圖與題組情境的標記（測驗、題庫共用）
import { escHTML } from './ui.js';

/** 指定位置（ctx、stem 或選項字母）的附圖 */
export const figsAt = (q, at) => (q.figs || []).filter(f => f.at === at)
  .map(f => `<img class="qz-img" src="${f.src}" alt="題目附圖" loading="lazy">`).join('');

/** 題組情境區塊；沒有情境時回傳空字串 */
export function ctxHTML(q) {
  const imgs = figsAt(q, 'ctx');
  if (!q.ctx && !imgs) return '';
  return `<div class="qz-ctx">${q.ctx ? `<div class="qz-ctx-t">📋 ${escHTML(q.ctx)}</div>` : ''}${imgs}</div>`;
}
