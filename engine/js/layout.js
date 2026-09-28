// 版面狀態：級別與科目切換、進度環、主題收合與已讀標記、捲動動畫與導覽高亮
import { config, levels, subjectById, levelOfSubject, subjectOfTopic, maxSubjects } from './data.js';
import { state, save } from './store.js';
import { showToast, closeSidebar } from './ui.js';

const studied = new Set(state.read);
let curSub = levels[0].subjects[0].id;
export const currentLevel = () => levelOfSubject[curSub];

/* ═══ LEVEL SWITCH ═══ */
function syncLevelUI(level) {
  // body class controls CSS
  for (const l of levels) {
    const on = l === level;
    document.body.classList.toggle('level-' + l.id, on);
    document.getElementById('lt-' + l.id)?.classList.toggle('on', on);
    document.getElementById('hero-lb-' + l.id)?.classList.toggle('on', on);
    document.getElementById('sc-' + l.id).style.display = on ? 'grid' : 'none';
  }
  const lvB = document.getElementById('logo-level');
  if (lvB) { lvB.textContent = level.name; lvB.style.background = level.accent.bg; lvB.style.color = level.accent.fg; lvB.style.borderColor = level.accent.border; }
  const he = document.getElementById('hero-title-em'), hs = document.getElementById('hero-sub-text');
  if (he) he.textContent = level.heroTitleEm;
  if (hs) hs.textContent = level.heroSub;
  // 進度環標籤；本級別沒有的科目位置顯示「—」並停用
  for (let i = 0; i < maxSubjects; i++) {
    const s = level.subjects[i];
    const el = document.getElementById('rl' + (i + 1)); if (el) el.textContent = s ? s.label : '—';
    document.getElementById('rw' + (i + 1))?.classList.toggle('off', !s);
  }
}
export function switchLevel(levelId) {
  switchSub(levels.find(l => l.id === levelId).subjects[0].id);
}
/** 切換到目前級別的第 i 個科目（進度環與數字鍵用） */
export function switchSubIndex(i) {
  const s = currentLevel().subjects[i];
  if (s) switchSub(s.id);
}

/* ═══ SUBJECT SWITCH ═══ */
export function switchSub(s) {
  curSub = s;
  const level = currentLevel();
  syncLevelUI(level);
  for (const id in subjectById) {
    document.getElementById('ng-' + id)?.classList.toggle('on', id === s);
    document.getElementById('sec-' + id)?.classList.toggle('on', id === s);
  }
  const idx = level.subjects.findIndex(x => x.id === s);
  for (let i = 0; i < maxSubjects; i++) document.getElementById('rw' + (i + 1))?.classList.toggle('on', i === idx);
  refreshRings();
  updateExpandLabel();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  requestAnimationFrame(initReveal);
}

/* ═══ TOGGLE TOPIC ═══ */
export function toggleTP(id) {
  document.getElementById(id)?.classList.toggle('open');
}

/* ═══ 一鍵展開 / 收合目前科目的所有章節 ═══ */
export function toggleAllTP() {
  const sec = document.querySelector('.sec.on'); if (!sec) return;
  const tps = [...sec.querySelectorAll('.tp')]; if (!tps.length) return;
  const anyClosed = tps.some(t => !t.classList.contains('open'));
  tps.forEach(t => t.classList.toggle('open', anyClosed));
  updateExpandLabel();
}
function updateExpandLabel() {
  const sec = document.querySelector('.sec.on');
  const tps = sec ? [...sec.querySelectorAll('.tp')] : [];
  const allOpen = tps.length > 0 && tps.every(t => t.classList.contains('open'));
  const desk = document.getElementById('expandAllBtnDesk');
  if (desk) desk.textContent = allOpen ? '⇕ 收合全部章節' : '⇕ 展開全部章節';
  const m = document.getElementById('expandAllBtn');
  if (m) { const lbl = m.querySelector('.mbl'); if (lbl) lbl.textContent = allOpen ? '收合' : '展開'; }
}

/* ═══ MARK DONE ═══ */
export function markDone(e, id) {
  e.stopPropagation();
  const btn = e.currentTarget, tp = document.getElementById(id);
  if (studied.has(id)) { studied.delete(id); btn.classList.remove('done'); tp?.classList.remove('studied'); showToast('已取消標記', '📌'); }
  else { studied.add(id); btn.classList.add('done'); tp?.classList.add('studied'); showToast('已標記為已讀', '🎯'); }
  state.read = [...studied]; save();
  refreshNav(); refreshRings();
}
function refreshNav() {
  document.querySelectorAll('.nl[data-id]').forEach(l => l.classList.toggle('done', studied.has(l.dataset.id)));
}
function refreshRings() {
  const subjects = currentLevel().subjects;
  for (let i = 0; i < maxSubjects; i++) {
    const s = subjects[i];
    const fill = document.getElementById('rf' + (i + 1)), num = document.getElementById('rn' + (i + 1));
    if (!s) { if (fill) fill.style.strokeDashoffset = 113.1; if (num) num.textContent = '—'; continue; }
    const done = s.topics.filter(t => studied.has(t.id)).length, pct = done / s.topics.length;
    if (fill) fill.style.strokeDashoffset = 113.1 * (1 - pct);
    if (num) num.textContent = Math.round(pct * 100) + '%';
  }
}

/* ═══ SCROLL REVEAL ═══ */
const revObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); revObs.unobserve(e.target); } });
}, { rootMargin: '0px 0px -50px 0px' });
function initReveal() {
  // Elements already within the viewport are shown immediately (observer
  // callbacks are async and unreliable for on-load in-view items); items
  // further down are observed so they animate in on scroll.
  const vh = window.innerHeight || document.documentElement.clientHeight;
  document.querySelectorAll('.sec.on .tp:not(.vis)').forEach(t => {
    const top = t.getBoundingClientRect().top;
    if (top < vh + 80) { t.classList.add('vis'); }
    else { revObs.observe(t); }
  });
}

/** 切到主題所屬科目、展開並捲動過去（導覽、搜尋、指令面板共用） */
export function jumpToTopic(id) {
  const sub = subjectOfTopic[id];
  if (sub && sub !== curSub) switchSub(sub);
  setTimeout(() => {
    const t = document.getElementById(id);
    if (t) { if (!t.classList.contains('open')) t.classList.add('open'); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }, 80);
}

export function initLayout() {
  /* SCROLLSPY */
  const spyObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const id = e.target.id;
        document.querySelectorAll('.nl[data-id]').forEach(l => l.classList.toggle('on', l.dataset.id === id));
      }
    });
  }, { rootMargin: '-25% 0px -65% 0px' });
  document.querySelectorAll('.tp[id]').forEach(t => spyObs.observe(t));

  document.querySelectorAll('.nl[data-id]').forEach(l => {
    l.addEventListener('click', e => {
      e.preventDefault();
      jumpToTopic(l.dataset.id);
      closeSidebar();
    });
  });

  studied.forEach(id => {
    const tp = document.getElementById(id); const btn = tp?.querySelector('.stdbtn');
    if (tp) tp.classList.add('studied'); if (btn) btn.classList.add('done');
  });
  refreshNav();
  config.site.defaultOpen.forEach(id => document.getElementById(id)?.classList.add('open'));
  // switchLevel -> switchSub -> initReveal next frame
  switchLevel(levels[0].id);
}
