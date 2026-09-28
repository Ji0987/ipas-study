// 模擬考：依簡章規格（題數、時間、及格分數）從單一科目題庫抽題，限時作答、交卷後計分與逐題檢討
import { levels, subjectById, levelOfSubject, topicById, loadQuiz } from './data.js';
import { state, save } from './store.js';
import { currentLevel, jumpToTopic } from './layout.js';
import { recordAnswer } from './answers.js';
import { escHTML, showToast, closeModal, fireConfetti } from './ui.js';
import { figsAt, ctxHTML } from './figs.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const WARN_SECS = 300;      // 剩餘 5 分鐘時提醒
const HISTORY_MAX = 100;    // 保留的成績筆數
let bank = null, setupLevel = levels[0].id;
let ex = null;              // 進行中或剛交卷的考試
let reviewFilter = 'all';
const $ = id => document.getElementById(id);
const fmt = secs => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

/* ═══ 選擇科目 ═══ */
export async function openExamSetup() {
  try { bank = await loadQuiz(); } catch (e) { showToast('題庫載入失敗，請透過網址開啟頁面', '⚠️'); return; }
  setupLevel = currentLevel().id;
  renderSetup();
  $('exam-setup-overlay').classList.add('on');
}
export function examSetLevel(id) { setupLevel = id; renderSetup(); }

function renderSetup() {
  const level = levels.find(l => l.id === setupLevel), spec = level.exam;
  for (const l of levels) $('exs-lv-' + l.id).classList.toggle('on', l === level);
  const tag = $('exs-level-tag'); tag.textContent = level.name; tag.className = 'lvtag ' + level.tagClass;
  const cards = level.subjects.map(s => {
    const pool = bank[level.id].filter(q => q.sub === s.id).length;
    const hist = state.exams.filter(r => r.subject === s.id);
    const last = hist.at(-1), best = hist.length ? Math.max(...hist.map(r => r.score)) : null;
    const record = hist.length
      ? `最近 <b>${last.score}</b> 分${last.score >= spec.pass ? '（及格）' : ''} · 最佳 ${best} 分 · 已考 ${hist.length} 次`
      : '尚未考過';
    return `<div class="ex-subj">
      <div class="ex-subj-t"><b>${escHTML(s.label)}</b> ${escHTML(s.name)}</div>
      <div class="ex-subj-m">題庫 ${pool} 題 · ${record}</div>
      <button class="rbtn p" onclick="startExam('${s.id}')"${pool ? '' : ' disabled'}>開始考試</button>
    </div>`;
  }).join('');
  $('exs-body').innerHTML = `<div class="ex-rules">
      <div>📋 每科 <b>${spec.questions}</b> 題單選題，限時 <b>${spec.minutes}</b> 分鐘，滿分 100 分，<b>${spec.pass}</b> 分及格。</div>
      ${spec.rule ? `<div>🎓 ${escHTML(spec.rule)}</div>` : ''}
      <div>⏱ 作答中可自由跳題、修改答案與標記待檢查，時間到會自動交卷；交卷後才顯示對錯，作答會記入錯題本。</div>
    </div>${cards}`;
}

/* ═══ 作答 ═══ */
export function startExam(subjectId) {
  const level = levelOfSubject[subjectId], spec = level.exam;
  const pool = [...bank[level.id].filter(q => q.sub === subjectId)];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const qs = pool.slice(0, Math.min(spec.questions, pool.length));
  const secs = Math.round(spec.minutes * 60);
  ex = { subject: subjectById[subjectId], level, qs, picks: qs.map(() => null), flags: new Set(), idx: 0,
    total: secs, deadline: Date.now() + secs * 1000, startAt: Date.now(), done: false, timer: null };
  ex.timer = setInterval(tick, 1000);
  closeModal('exam-setup-overlay');
  $('exam-overlay').classList.add('on');
  renderExam();
}
const remaining = () => Math.max(0, Math.round((ex.deadline - Date.now()) / 1000));
function tick() {
  const left = remaining();
  const t = $('ex-timer');
  if (t) { t.textContent = '⏱ ' + fmt(left); t.classList.toggle('warn', left <= WARN_SECS); }
  if (left === WARN_SECS) showToast('剩餘 5 分鐘', '⏱');
  if (left <= 0) finish(true);
}

function renderExam() {
  const answered = ex.picks.filter(p => p !== null).length;
  $('ex-hd').innerHTML = `<div class="bk-title">🎯 模擬考 <span class="lvtag ${ex.level.tagClass}">${escHTML(ex.level.name)}</span></div>
    <div class="bk-sub">${escHTML(ex.subject.label)}　${escHTML(ex.subject.name)}</div>
    <div class="ex-bar"><span class="ex-timer${remaining() <= WARN_SECS ? ' warn' : ''}" id="ex-timer">⏱ ${fmt(remaining())}</span>
      <span>已作答 ${answered} / ${ex.qs.length}</span>${ex.flags.size ? `<span>🚩 ${ex.flags.size}</span>` : ''}
      <button class="ex-submit" onclick="examSubmit()">交卷</button></div>`;
  const q = ex.qs[ex.idx], pick = ex.picks[ex.idx];
  const media = (q.img ? `<img class="qz-img" src="${q.img}" alt="${q.imgAlt || '題目附圖'}">` : q.code ? `<pre class="qz-code">${escHTML(q.code)}</pre>` : '') + figsAt(q, 'stem');
  const opts = LETTERS.map((l, i) =>
    `<div class="qz-o${q.codeOpts ? ' qz-o-code' : ''}${pick === i ? ' sel' : ''}" role="button" tabindex="0" aria-label="選項 ${l}" onclick="examPick(${i})"><div class="qltr">${l}</div><span>${q.codeOpts ? escHTML(q.opts[i]) : q.opts[i]}${figsAt(q, l)}</span></div>`).join('');
  const nav = ex.qs.map((_, i) => `<button class="${[i === ex.idx && 'cur', ex.picks[i] !== null && 'ans', ex.flags.has(i) && 'flag'].filter(Boolean).join(' ')}" onclick="examGo(${i})">${i + 1}</button>`).join('');
  $('ex-body').innerHTML = `<div class="qz-num">第 ${ex.idx + 1} 題，共 ${ex.qs.length} 題${ex.flags.has(ex.idx) ? '　🚩 待檢查' : ''}</div>
    ${ctxHTML(q)}<div class="qz-q">${escHTML(q.q)}</div><div class="qz-media">${media}</div>
    <div class="qz-opts">${opts}</div>
    <div class="ex-actions">
      <button class="rbtn s" onclick="examMove(-1)"${ex.idx ? '' : ' disabled'}>← 上一題</button>
      <button class="rbtn s${ex.flags.has(ex.idx) ? ' on' : ''}" onclick="examFlag()">🚩 ${ex.flags.has(ex.idx) ? '取消標記' : '標記'}</button>
      <button class="rbtn p" onclick="examMove(1)"${ex.idx < ex.qs.length - 1 ? '' : ' disabled'}>下一題 →</button>
    </div>
    <div class="ex-nav-t">題號總覽（藍色：已作答、橘色：已標記）</div><div class="ex-nav">${nav}</div>`;
  $('ex-body').scrollTop = 0;
}
export function examPick(i) { if (ex && !ex.done) { ex.picks[ex.idx] = i; renderExam(); } }
export function examGo(i) { if (ex && !ex.done) { ex.idx = i; renderExam(); } }
export function examMove(d) { if (ex && !ex.done) { ex.idx = Math.min(ex.qs.length - 1, Math.max(0, ex.idx + d)); renderExam(); } }
export function examFlag() {
  if (!ex || ex.done) return;
  if (ex.flags.has(ex.idx)) ex.flags.delete(ex.idx); else ex.flags.add(ex.idx);
  renderExam();
}
export function examSubmit() {
  if (!ex || ex.done) return;
  const left = ex.picks.filter(p => p === null).length;
  const msg = left ? `還有 ${left} 題未作答${ex.flags.size ? `、${ex.flags.size} 題標記待檢查` : ''}，確定要交卷嗎？` : ex.flags.size ? `還有 ${ex.flags.size} 題標記待檢查，確定要交卷嗎？` : '確定要交卷嗎？';
  if (confirm(msg)) finish(false);
}
/** 關閉考試視窗：作答中要先確認放棄 */
export function examClose() {
  if (ex && !ex.done) {
    if (!confirm('確定要放棄這次模擬考嗎？本次作答不會計分，也不會記入錯題本。')) return;
    clearInterval(ex.timer); ex = null;
  }
  closeModal('exam-overlay');
}

/* ═══ 計分與檢討 ═══ */
function finish(auto) {
  clearInterval(ex.timer);
  ex.done = true;
  ex.secs = Math.min(ex.total, Math.round((Date.now() - ex.startAt) / 1000));
  ex.correct = ex.qs.filter((q, i) => ex.picks[i] === q.ans).length;
  ex.score = Math.round(ex.correct / ex.qs.length * 100);
  ex.qs.forEach((q, i) => { if (ex.picks[i] !== null) recordAnswer(q.id, ex.picks[i] === q.ans); });
  state.exams = [...state.exams, { subject: ex.subject.id, score: ex.score, correct: ex.correct, total: ex.qs.length, secs: ex.secs, at: Date.now() }].slice(-HISTORY_MAX);
  save();
  if (auto) showToast('時間到，已自動交卷', '⏱');
  reviewFilter = 'all';
  renderResult();
  if (ex.score >= ex.level.exam.pass) fireConfetti();
}
export function examReview(f) { reviewFilter = f; renderResult(); }
export function examRetry() { const id = ex.subject.id; startExam(id); }
export function examOther() { closeModal('exam-overlay'); renderSetup(); $('exam-setup-overlay').classList.add('on'); }
export function examNote(topicId) { closeModal('exam-overlay'); jumpToTopic(topicId); }

function renderResult() {
  const pass = ex.score >= ex.level.exam.pass;
  const wrong = ex.qs.filter((q, i) => ex.picks[i] !== null && ex.picks[i] !== q.ans).length;
  const blank = ex.picks.filter(p => p === null).length;
  $('ex-hd').innerHTML = `<div class="bk-title">🎯 模擬考成績 <span class="lvtag ${ex.level.tagClass}">${escHTML(ex.level.name)}</span></div>
    <div class="bk-sub">${escHTML(ex.subject.label)}　${escHTML(ex.subject.name)}</div>
    <div class="ex-score"><span class="ex-score-n${pass ? ' pass' : ''}">${ex.score}<small> 分</small></span>
      <span class="ex-verdict ${pass ? 'pass' : 'fail'}">${pass ? '✅ 及格' : `❌ 未達 ${ex.level.exam.pass} 分`}</span>
      <span>答對 ${ex.correct} / ${ex.qs.length} 題 · 用時 ${fmt(ex.secs)}</span></div>
    <div class="ex-actions"><button class="rbtn p" onclick="examRetry()">再考一次</button><button class="rbtn s" onclick="examOther()">選擇其他科目</button><button class="rbtn s" onclick="examClose()">關閉</button></div>
    <div class="bk-filters">${[['all', `全部 ${ex.qs.length}`], ['wrong', `❌ 答錯 ${wrong}`], ['blank', `⬜ 未作答 ${blank}`], ['flag', `🚩 已標記 ${ex.flags.size}`]]
      .map(([k, t]) => `<button class="bk-fb${reviewFilter === k ? ' on' : ''}" onclick="examReview('${k}')">${t}</button>`).join('')}</div>`;
  const keep = (q, i) => reviewFilter === 'all' || (reviewFilter === 'wrong' && ex.picks[i] !== null && ex.picks[i] !== q.ans)
    || (reviewFilter === 'blank' && ex.picks[i] === null) || (reviewFilter === 'flag' && ex.flags.has(i));
  const cards = ex.qs.map((q, i) => {
    if (!keep(q, i)) return '';
    const pick = ex.picks[i], ok = pick === q.ans;
    const verdict = pick === null ? '<span class="bk-tag tag-blank">未作答</span>' : ok ? '<span class="bk-tag tag-ok">✓ 答對</span>' : '<span class="bk-tag tag-wrong">✗ 答錯</span>';
    const media = (q.img ? `<img class="qz-img" src="${q.img}" alt="${q.imgAlt || '題目附圖'}">` : q.code ? `<pre class="qz-code">${escHTML(q.code)}</pre>` : '') + figsAt(q, 'stem');
    const opts = LETTERS.map((l, oi) => {
      const cls = oi === q.ans ? ' cor' : oi === pick ? ' wrg' : '';
      const txt = (q.codeOpts ? escHTML(q.opts[oi]) : q.opts[oi]) + figsAt(q, l);
      return `<div class="bk-o${cls}"><b>${l}</b><span${q.codeOpts ? ' class="mono"' : ''}>${txt}</span>${oi === q.ans ? '<span class="bk-ck">✓</span>' : oi === pick ? '<span class="bk-ck">✗</span>' : ''}</div>`;
    }).join('');
    return `<div class="bk-card"><div class="bk-head"><span class="bk-num">#${i + 1}</span>${verdict}${ex.flags.has(i) ? '<span class="bk-tag tag-code">🚩 已標記</span>' : ''}</div>
      ${ctxHTML(q)}<div class="bk-q">${escHTML(q.q)}</div>${media}<div class="bk-opts">${opts}</div>
      <div class="bk-exp">💡 ${q.exp}<button class="note-link" onclick="examNote('${q.topic}')">📖 看筆記：${escHTML(topicById[q.topic].title)}</button></div></div>`;
  }).join('');
  $('ex-body').innerHTML = cards || '<div class="bk-empty">沒有符合條件的題目</div>';
  $('ex-body').scrollTop = 0;
}

/** 考試視窗開啟時的鍵盤操作；回傳 true 表示已處理，不再執行全域快捷鍵 */
export function examKey(e) {
  if (!$('exam-overlay').classList.contains('on')) return false;
  if (e.key === 'Escape') { examClose(); return true; }
  if (ex && !ex.done) {
    const k = e.key.toUpperCase();
    if (e.key === 'ArrowLeft') examMove(-1);
    else if (e.key === 'ArrowRight') examMove(1);
    else if (LETTERS.includes(k)) examPick(LETTERS.indexOf(k));
    else if (/^[1-4]$/.test(e.key)) examPick(+e.key - 1);
  }
  return true;
}
