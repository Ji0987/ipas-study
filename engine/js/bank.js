// 題庫瀏覽：依級別列出全部題目，可篩選、搜尋、以題目 id 標記待複習
import { levels, topicById, loadQuiz } from './data.js';
import { state, save } from './store.js';
import { currentLevel } from './layout.js';
import { isWrong } from './answers.js';
import { openQuiz } from './quiz.js';
import { escHTML, showToast, closeModal } from './ui.js';

let quizBank = null;
let bankLevel = levels[0].id, bankFilter = 'all', bankSearch = '';
const bankMarked = new Set(state.bookmarks);

export async function openBank() {
  const level = currentLevel();
  try { quizBank = await loadQuiz(); } catch (e) { showToast('題庫載入失敗，請透過網址開啟頁面', '⚠️'); return; }
  bankLevel = level.id;
  bankFilter = 'all'; bankSearch = '';
  const s = document.getElementById('bk-search'); if (s) s.value = '';
  renderBank();
  document.getElementById('bk-overlay').classList.add('on');
}
export function bankSetLevel(lvl) { bankLevel = lvl; renderBank(); }
export function bankSetFilter(f) { bankFilter = f; renderBank(); }
export function bankSearchFn(v) { bankSearch = v.toLowerCase().trim(); renderBank(); }
/** 從題庫的錯題篩選直接開始練習 */
export function bankPracticeWrong() {
  closeModal('bk-overlay');
  openQuiz('wrong', bankLevel);
}
export function bankMark(id) {
  if (bankMarked.has(id)) bankMarked.delete(id); else bankMarked.add(id);
  state.bookmarks = [...bankMarked]; save();
  renderBank();
}
function renderBank() {
  const pool = quizBank[bankLevel], level = levels.find(l => l.id === bankLevel);
  for (const l of levels) document.getElementById('bk-lv-' + l.id).classList.toggle('on', l === level);
  const lt = document.getElementById('bk-level-tag');
  lt.textContent = level.name; lt.className = 'lvtag ' + level.tagClass;
  ['all', 'img', 'code', 'marked', 'wrong'].forEach(f => document.getElementById('bk-f-' + f).classList.toggle('on', bankFilter === f));
  const markedCount = pool.filter(q => bankMarked.has(q.id)).length;
  const wrongCount = pool.filter(q => isWrong(q.id)).length;
  let items = pool.map((q, i) => ({ q, i }));
  if (bankFilter === 'img') items = items.filter(x => x.q.img);
  else if (bankFilter === 'code') items = items.filter(x => x.q.code || x.q.codeOpts);
  else if (bankFilter === 'marked') items = items.filter(x => bankMarked.has(x.q.id));
  else if (bankFilter === 'wrong') items = items.filter(x => isWrong(x.q.id));
  const practice = document.getElementById('bk-practice');
  practice.hidden = !(bankFilter === 'wrong' && wrongCount);
  practice.textContent = `📝 練習這 ${wrongCount} 題錯題`;
  if (bankSearch) {
    items = items.filter(x => x.q.q.toLowerCase().includes(bankSearch)
      || x.q.opts.some(o => o.toLowerCase().includes(bankSearch))
      || (x.q.exp || '').toLowerCase().includes(bankSearch));
  }
  document.getElementById('bk-count').textContent = `顯示 ${items.length} / ${pool.length} 題` + (markedCount ? ` · ⭐ 已標記 ${markedCount}` : '') + (wrongCount ? ` · ❌ 錯題 ${wrongCount}` : '');
  const html = items.map(({ q, i }) => {
    const tag = (q.img ? '<span class="bk-tag tag-img">🖼️ 圖片</span>'
      : ((q.code || q.codeOpts) ? '<span class="bk-tag tag-code">💻 程式碼</span>' : ''))
      + (isWrong(q.id) ? '<span class="bk-tag tag-wrong">❌ 錯題</span>' : '');
    let media = '';
    if (q.img) media = `<img class="qz-img" src="${q.img}" alt="${q.imgAlt || '題目附圖：請參閱圖中數據判讀'}">`;
    else if (q.code) media = `<pre class="qz-code">${escHTML(q.code)}</pre>`;
    const opts = ['A', 'B', 'C', 'D'].map((l, oi) => {
      const cor = oi === q.ans, txt = q.codeOpts ? escHTML(q.opts[oi]) : q.opts[oi];
      return `<div class="bk-o${cor ? ' cor' : ''}"><b>${l}</b><span${q.codeOpts ? ' class="mono"' : ''}>${txt}</span>${cor ? '<span class="bk-ck">✓</span>' : ''}</div>`;
    }).join('');
    const marked = bankMarked.has(q.id);
    return `<div class="bk-card">
      <div class="bk-head"><span class="bk-num">#${i + 1}</span>${tag}<button class="bk-mark${marked ? ' on' : ''}" onclick="bankMark('${q.id}')" title="標記待複習" aria-label="標記第 ${i + 1} 題待複習">⭐</button></div>
      <div class="bk-q">${q.q}</div>${media}
      <div class="bk-opts">${opts}</div>
      <div class="bk-exp">💡 ${q.exp}<button class="note-link" onclick="gotoNote('${q.topic}')">📖 看筆記：${escHTML(topicById[q.topic].title)}</button></div>
    </div>`;
  }).join('');
  const list = document.getElementById('bk-list');
  list.innerHTML = html || '<div class="bk-empty">沒有符合條件的題目</div>';
  list.scrollTop = 0;
}
