// 知識測驗：從目前級別的題庫隨機抽 10 題
import { loadQuiz } from './data.js';
import { currentLevel } from './layout.js';
import { escHTML, fireConfetti, showToast } from './ui.js';

let QUIZ = [];
let qzIdx = 0, qzScore = 0, qzAns = false;

export async function openQuiz() {
  const level = currentLevel();
  let bank;
  try { bank = await loadQuiz(); } catch (e) { showToast('題庫載入失敗，請透過網址開啟頁面', '⚠️'); return; }
  const pool = bank[level.id];
  // random sample (Fisher-Yates) up to 10 questions per session
  const arr = [...pool];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  QUIZ = arr.slice(0, Math.min(10, arr.length));
  const tag = document.getElementById('qz-level-tag');
  tag.textContent = level.name; tag.className = 'lvtag ' + level.tagClass;
  document.getElementById('qz-meta-text').textContent = `從 ${pool.length} 題歷屆題庫隨機抽出 ${QUIZ.length} 題`;
  qzIdx = 0; qzScore = 0; qzAns = false;
  document.getElementById('qz-content').style.display = '';
  document.getElementById('qz-result').classList.remove('on');
  renderQz(); document.getElementById('qz-overlay').classList.add('on');
}
function renderQz() {
  const q = QUIZ[qzIdx]; qzAns = false;
  document.getElementById('qz-num').textContent = `第 ${qzIdx + 1} 題，共 ${QUIZ.length} 題`;
  document.getElementById('qz-pf').style.width = (qzIdx / QUIZ.length * 100) + '%';
  document.getElementById('qz-q').textContent = q.q;
  // media: image or code block beneath the stem
  const media = document.getElementById('qz-media');
  if (q.img) { media.innerHTML = `<img class="qz-img" src="${q.img}" alt="${q.imgAlt || '題目附圖：請參閱圖中數據判讀'}">`; }
  else if (q.code) { media.innerHTML = `<pre class="qz-code">${escHTML(q.code)}</pre>`; }
  else { media.innerHTML = ''; }
  document.getElementById('qz-exp').className = 'qz-exp';
  document.getElementById('qz-nxt').className = 'qz-nxt';
  const optCls = 'qz-o' + (q.codeOpts ? ' qz-o-code' : '');
  document.getElementById('qz-opts').innerHTML = ['A', 'B', 'C', 'D'].map((l, i) =>
    `<div class="${optCls}" role="button" tabindex="0" aria-label="選項 ${l}" onclick="answerQz(${i})" id="qzo-${i}"><div class="qltr">${l}</div><span>${q.codeOpts ? escHTML(q.opts[i]) : q.opts[i]}</span></div>`).join('');
}
export function answerQz(i) {
  if (qzAns) return; qzAns = true;
  const q = QUIZ[qzIdx];
  document.querySelectorAll('.qz-o').forEach((o, idx) => {
    o.setAttribute('disabled', '');
    if (idx === q.ans) o.classList.add(i === q.ans && idx === i ? 'cor' : 'rev');
    else if (idx === i && i !== q.ans) o.classList.add('wrg');
  });
  if (i === q.ans) qzScore++;
  const exp = document.getElementById('qz-exp'); exp.textContent = '💡 解析：' + q.exp; exp.classList.add('on');
  const nxt = document.getElementById('qz-nxt'); nxt.textContent = qzIdx < QUIZ.length - 1 ? '下一題 →' : '查看結果'; nxt.classList.add('on');
}
export function qzNext() { qzIdx++; if (qzIdx >= QUIZ.length) showResult(); else renderQz(); }
function showResult() {
  document.getElementById('qz-content').style.display = 'none';
  const r = document.getElementById('qz-result'); r.classList.add('on');
  document.getElementById('qz-pf').style.width = '100%';
  document.getElementById('r-score').textContent = `${qzScore} / ${QUIZ.length}`;
  const pct = qzScore / QUIZ.length;
  setTimeout(() => { document.getElementById('rring-fill').style.strokeDashoffset = 264 * (1 - pct); }, 200);
  const m = document.getElementById('r-msg');
  if (pct >= .9) { m.className = 'rmsg great'; m.textContent = '🎉 優秀！核心知識已掌握，考試加油！'; fireConfetti(); }
  else if (pct >= .6) { m.className = 'rmsg ok'; m.textContent = '📚 不錯！建議再複習答錯的部分。'; }
  else { m.className = 'rmsg retry'; m.textContent = '💪 再多複習幾遍筆記後重新挑戰！'; }
}
export function qzRestart() {
  openQuiz();  // re-sample a fresh random set from the same level bank
}
