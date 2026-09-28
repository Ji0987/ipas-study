// 弱點分析：依作答紀錄統計各科目、各主題的正確率，找出需要加強的主題
import { levels, subjectById, subjectOfTopic, topicById, chapterOfTopic, loadQuiz } from './data.js';
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

/** 把長標籤依顯示寬度折行（中文字寬 1、英數約 0.55），優先在空白處斷行 */
function wrapLabel(text, max = 8) {
  const lines = [''];
  let width = 0;
  for (const tok of text.split(/(\s+)/)) {
    const w = [...tok].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0);
    if (w > max) {  // 單一詞（如整串中文）超過行寬時逐字切
      for (const c of tok) {
        const cw = c.charCodeAt(0) > 255 ? 1 : 0.55;
        if (width + cw > max) { lines.push(''); width = 0; }
        lines[lines.length - 1] += c; width += cw;
      }
      continue;
    }
    if (width + w > max && lines.at(-1).trim()) { lines.push(''); width = 0; }
    if (!lines.at(-1) && !tok.trim()) continue;
    lines[lines.length - 1] += tok; width += w;
  }
  return lines.map(l => l.trim()).filter(Boolean);
}

/** 單一系列雷達圖（SVG）；沒有作答的主題畫在圓心並標示「--」 */
function radar(items) {
  // 窄螢幕時 SVG 會被縮小，改用較小的半徑與較大的字（CSS .rd-sm），標籤也折得更短
  const small = matchMedia('(max-width: 560px)').matches;
  const n = items.length, R = small ? 74 : 92, LABEL_R = R + (small ? 25 : 26), LH = small ? 16 : 12, WRAP = small ? 6 : 8;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, r) => [r * Math.cos(ang(i)), r * Math.sin(ang(i))];
  const poly = r => items.map((_, i) => pt(i, r).map(v => v.toFixed(1)).join(',')).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(f => `<polygon class="rd-grid" points="${poly(R * f)}"/>`).join('')
    + items.map((_, i) => { const [x, y] = pt(i, R); return `<line class="rd-grid" x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('')
    + [0, 50, 100].map(v => `<text class="rd-tick" x="3" y="${(-R * v / 100 + 3).toFixed(1)}">${v}</text>`).join('');
  const vals = items.map((c, i) => pt(i, R * (c.st.acc ?? 0)));
  const shape = `<polygon class="rd-area" points="${vals.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
  // 已作答的主題畫點並在外側標數值；未作答的不畫點（全擠在圓心會看不清），改在軸標籤下標「--」
  const dots = items.map((c, i) => {
    if (c.st.acc === null) return '';
    const [x, y] = vals[i];
    const tip = `${c.title}：答對率 ${pct(c.st.acc)}（${c.st.attempts} 次作答）`;
    const [lx, ly] = pt(i, R * c.st.acc + 11);
    return `<g><title>${escHTML(tip)}</title><circle class="rd-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="10"/><circle class="rd-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>
      <text class="rd-val" x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="middle">${Math.round(c.st.acc * 100)}</text></g>`;
  }).join('');
  const labels = items.map((c, i) => {
    const [x, y] = pt(i, LABEL_R), lines = wrapLabel(c.title, WRAP);
    if (c.st.acc === null) lines.push('--');
    const anchor = Math.abs(x) < 8 ? 'middle' : x > 0 ? 'start' : 'end';
    const top = y - (lines.length - 1) * LH / 2 + (y > 8 ? LH / 2 : y < -8 ? -LH / 6 : LH / 4);
    return `<text class="rd-label" text-anchor="${anchor}" x="${x.toFixed(1)}" y="${top.toFixed(1)}">${lines.map((l, k) =>
      `<tspan x="${x.toFixed(1)}" dy="${k ? LH : 0}"${c.st.acc === null && k === lines.length - 1 ? ' class="rd-na"' : ''}>${escHTML(l)}</tspan>`).join('')}</text>`;
  }).join('');
  return `<div class="ds-radar"><svg class="${small ? 'rd-sm' : ''}" viewBox="-215 -162 430 324" role="img" aria-label="各評鑑主題答對率雷達圖">${grid}${shape}${dots}${labels}</svg></div>`;
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

  // 評鑑主題（章節）雷達圖：仿官方成績單，依題目所屬主題的章節統計
  const chapters = level.subjects.filter(s => !s.practical).flatMap(s => s.chapters.map((ch, i) => ({ key: `${s.id}:${i}`, title: ch.title, subject: s })));
  const chStats = chapters.map(ch => ({ ...ch, st: stats(pool.filter(q => chapterOfTopic[q.topic] === ch.key)) }));
  h += `<div class="ds-sec">評鑑主題答對率</div>${radar(chStats)}
    <div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>評鑑主題</th><th>答對率</th><th>作答</th></tr></thead><tbody>${chStats.map(c =>
      `<tr><td>${escHTML(c.title)}<span>${escHTML(c.subject.label)}</span></td><td>${c.st.acc === null ? '--' : pct(c.st.acc)}</td><td>${c.st.attempts ? `${c.st.attempts} 次` : '--'}</td></tr>`).join('')}</tbody></table></div>`;

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
