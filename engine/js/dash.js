// 弱點分析：依作答紀錄統計各科目、各主題的正確率，找出需要加強的主題
import { levels, subjectById, subjectOfTopic, topicById, loadQuiz } from './data.js';
import { state } from './store.js';
import { currentLevel } from './layout.js';
import { escHTML, showToast } from './ui.js';

const WEAK = 0.6;  // 正確率低於此值標示「需加強」
let bank = null, dashLevel = levels[0].id;

export async function openDash() {
  try { bank = await loadQuiz(); } catch (e) { showToast('題庫載入失敗，請透過網址開啟頁面', '⚠️'); return; }
  dashLevel = currentLevel().id;
  renderDash();
  document.getElementById('dash-overlay').classList.add('on');
}
export function dashSetLevel(id) { dashLevel = id; renderDash(); }

/** 一組題目的統計；正確率＝答對次數 ÷ 作答次數 */
function stats(qs) {
  let answered = 0, right = 0, wrong = 0, wrongNow = 0;
  for (const q of qs) {
    const r = state.answers[q.id];
    if (!r) continue;
    answered++; right += r.right; wrong += r.wrong;
    if (r.last === 'wrong') wrongNow++;
  }
  const attempts = right + wrong;
  return { total: qs.length, answered, attempts, acc: attempts ? right / attempts : null, wrongNow };
}
const pct = acc => `${Math.round(acc * 100)}%`;
function bar(acc, label) {
  return `<div class="ds-bar" role="img" aria-label="${label}"><i style="width:${acc === null ? 0 : Math.max(acc * 100, 2)}%"></i></div>`;
}

function renderDash() {
  const level = levels.find(l => l.id === dashLevel);
  for (const l of levels) document.getElementById('dash-lv-' + l.id).classList.toggle('on', l === level);
  const tag = document.getElementById('dash-level-tag');
  tag.textContent = level.name; tag.className = 'lvtag ' + level.tagClass;
  const pool = bank[level.id];
  const all = stats(pool);
  const body = document.getElementById('dash-body');
  if (!all.answered) {
    body.innerHTML = `<div class="ds-empty">${level.name}還沒有作答紀錄。<br>做幾次測驗後，這裡會列出各科目與主題的正確率，並找出需要加強的主題。<br><button class="rbtn p" onclick="closeModal('dash-overlay');openQuiz('all','${level.id}')">📝 開始測驗</button></div>`;
    body.scrollTop = 0;
    return;
  }

  let h = `<div class="ds-stats">
    <div class="ds-stat"><div class="ds-num">${all.answered}<small> / ${all.total}</small></div><div class="ds-lbl">已作答題數</div></div>
    <div class="ds-stat"><div class="ds-num">${pct(all.acc)}</div><div class="ds-lbl">整體正確率（${all.attempts} 次作答）</div></div>
    <div class="ds-stat"><div class="ds-num">${all.wrongNow}</div><div class="ds-lbl">目前錯題</div></div>
  </div>`;

  // 各科目：依題目出自的試卷科目統計
  h += '<div class="ds-sec">各科目</div>';
  for (const s of level.subjects) {
    const st = stats(pool.filter(q => q.sub === s.id));
    if (!st.total) continue;
    const accText = st.acc === null ? '未作答' : pct(st.acc);
    h += `<div class="ds-row" title="${escHTML(s.label)}：正確率 ${accText}，已作答 ${st.answered} / ${st.total} 題">
      <div class="ds-name">${escHTML(s.label)}<span>${escHTML(s.name)}</span></div>
      ${bar(st.acc, `正確率 ${accText}`)}<div class="ds-val">${accText}</div>
      <div class="ds-meta">已作答 ${st.answered} / ${st.total} 題${st.wrongNow ? ` · 錯題 ${st.wrongNow}` : ''}</div>
    </div>`;
  }

  // 各主題：有作答的依正確率由低到高（同分時作答次數多的在前），未作答的列在最後
  const topics = level.subjects.flatMap(s => s.topics.map(t => t.id));
  const rows = topics.map(id => ({ id, st: stats(pool.filter(q => q.topic === id)) })).filter(r => r.st.total);
  const done = rows.filter(r => r.st.attempts).sort((a, b) => a.st.acc - b.st.acc || b.st.attempts - a.st.attempts);
  const todo = rows.filter(r => !r.st.attempts);
  const topicRow = ({ id, st }) => {
    const t = topicById[id], s = subjectById[subjectOfTopic[id]];
    const accText = st.acc === null ? '未作答' : pct(st.acc);
    const weak = st.acc !== null && st.acc < WEAK ? '<span class="ds-weak">⚠️ 需加強</span>' : '';
    return `<div class="ds-row" title="${escHTML(t.title)}：正確率 ${accText}，已作答 ${st.answered} / ${st.total} 題">
      <div class="ds-name">${escHTML(t.title)}<span>${escHTML(s.label)}</span>${weak}</div>
      ${bar(st.acc, `正確率 ${accText}`)}<div class="ds-val">${accText}</div>
      <div class="ds-meta">已作答 ${st.answered} / ${st.total} 題${st.wrongNow ? ` · 錯題 ${st.wrongNow}` : ''}
        <span class="ds-acts"><button onclick="closeModal('dash-overlay');openQuiz('topic',null,'${id}')">📝 練習</button><button onclick="closeModal('dash-overlay');gotoNote('${id}')">📖 筆記</button></span></div>
    </div>`;
  };
  h += `<div class="ds-sec">各主題（由弱到強）</div>${done.map(topicRow).join('')}`;
  if (todo.length) h += `<div class="ds-sec">尚未練習的主題（${todo.length}）</div>${todo.map(topicRow).join('')}`;
  body.innerHTML = h;
  body.scrollTop = 0;
}
