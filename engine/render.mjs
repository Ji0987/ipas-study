// build 時由 config 產生頁面中會隨證照變動的區塊（標記沿用舊版結構，確保樣式一致）
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const subjectsOf = config => config.levels.flatMap(l => l.subjects);
const maxSubjects = config => Math.max(...config.levels.map(l => l.subjects.length));

export function levelTabs(config) {
  return config.levels.map((l, i) =>
    `    <button class="lt ${l.id}${i === 0 ? ' on' : ''}" id="lt-${l.id}" onclick="switchLevel('${l.id}')">${esc(l.name)}</button>`).join('\n');
}

export function rings(config) {
  const first = config.levels[0].subjects;
  return Array.from({ length: maxSubjects(config) }, (_, k) => {
    const n = k + 1;
    return `    <div class="rw${k === 0 ? ' on' : ''}" id="rw${n}" onclick="switchSubIndex(${k})">
      <svg class="ring-svg" viewBox="0 0 44 44"><circle class="rt" cx="22" cy="22" r="18"/><circle class="rf rf${n}" cx="22" cy="22" r="18" stroke-dasharray="113.1" stroke-dashoffset="113.1" id="rf${n}" transform="rotate(-90 22 22)"/></svg>
      <div class="rtext"><span class="rnum" id="rn${n}">0%</span><span id="rl${n}">${first[k] ? esc(first[k].label) : '—'}</span></div>
    </div>`;
  }).join('\n');
}

export function nav(config) {
  return subjectsOf(config).map((s, i) => {
    const byId = Object.fromEntries(s.topics.map(t => [t.id, t]));
    const groups = s.navGroups.map(g => `      <div class="navch">${esc(g.title)}</div>\n` +
      g.topics.map(id => `      <a class="nl" data-id="${id}" href="#${id}"><span class="ndot"></span>${byId[id].nav}<span class="nchk">✓</span></a>`).join('\n')).join('\n');
    return `    <div class="navg${i === 0 ? ' on' : ''}" id="ng-${s.id}">\n${groups}\n    </div>`;
  }).join('\n');
}

export function levelBadges(config) {
  return config.levels.map((l, i) =>
    `    <span class="level-badge lb-${l.id}${i === 0 ? ' on' : ''}" id="hero-lb-${l.id}" onclick="switchLevel('${l.id}')">${esc(l.badge)}</span>`).join('\n');
}

export function subjectCards(config) {
  return config.levels.map((l, i) => {
    const cards = l.subjects.map(s =>
      `    <div class="sc ${s.cardClass}" onclick="switchSub('${s.id}')"><div class="sc-n">${esc(s.cardTitle)}</div><div class="sc-t">${esc(s.name)}</div><div class="sc-tags">${s.tags.map(t => `<span class="stag">${esc(t)}</span>`).join('')}</div></div>`).join('\n');
    return `  <div id="sc-${l.id}" class="sc-grid"${i === 0 ? '' : ' style="display:none"'}>\n${cards}\n  </div>`;
  }).join('\n');
}

/** counts：主題 id → 題數，有題目的主題在標頭顯示「練習本主題」按鈕 */
export function sections(config, notes, counts = {}) {
  return subjectsOf(config).map((s, i) => {
    const byId = Object.fromEntries(s.topics.map(t => [t.id, t]));
    const parts = [`<div class="sec${i === 0 ? ' on' : ''}" id="sec-${s.id}">`];
    if (s.secLabel) parts.push(`<div style="margin-bottom:12px"><span class="sec-label ${s.secLabel.cls}">${esc(s.secLabel.text)}</span></div>`);
    parts.push(`<div class="chapnote">${config.site.chapnote}</div>`);
    for (const c of s.chapters) {
      parts.push(`<div class="chap"><span class="cnum ${c.cls}">${esc(c.num)}</span><span class="ctit">${esc(c.title)}</span></div>`);
      for (const id of c.topics) {
        const t = byId[id];
        const badge = t.badge ? `<span class="badge ${t.badge.cls}">${esc(t.badge.text)}</span>` : '';
        const practice = counts[id] ? `<button class="tpq" onclick="practiceTopic(event,'${id}')" title="練習本主題（${counts[id]} 題）" aria-label="練習本主題，共 ${counts[id]} 題">📝 ${counts[id]}</button>` : '';
        parts.push(`<div class="tp" id="${id}">
  <div class="tph" onclick="toggleTP('${id}')"><div class="tpt">${esc(t.title)}${badge}</div><div class="tpact">${practice}<button class="stdbtn" onclick="markDone(event,'${id}')">✓</button><span class="chev">▾</span></div></div>
  <div class="tpbody"><div class="tpin">${notes[id]}</div></div>
</div>`);
      }
    }
    parts.push('</div>');
    return parts.join('\n\n');
  }).join('\n\n');
}

/** 彈窗內的級別分頁（題庫、弱點分析共用樣式） */
function modalLevelTabs(config, idPrefix, fn) {
  return config.levels.map((l, i) =>
    `        <button class="bk-tab${i === 0 ? ' on' : ''}" id="${idPrefix}-${l.id}" onclick="${fn}('${l.id}')">${esc(l.name)}</button>`).join('\n');
}
export const bankTabs = config => modalLevelTabs(config, 'bk-lv', 'bankSetLevel');
export const dashTabs = config => modalLevelTabs(config, 'dash-lv', 'dashSetLevel');
export const examTabs = config => modalLevelTabs(config, 'exs-lv', 'examSetLevel');

/** 網站首頁的證照卡片 */
export function certCards(configs) {
  const CARD_CLASSES = ['c1', 'c2', 'c3'];
  return configs.map((c, i) => {
    const tags = c.levels.map(l => `<span class="stag">${esc(l.name)} ${l.subjects.length} 科</span>`).join('');
    return `    <a class="sc ${CARD_CLASSES[i % CARD_CLASSES.length]}" href="${c.id}/"><div class="sc-n">${esc(c.levels.map(l => l.name).join('・'))}</div><div class="sc-t">${esc(c.name)}</div><div class="sc-tags">${tags}</div></a>`;
  }).join('\n');
}

export function subjectKeys(config) {
  return Array.from({ length: maxSubjects(config) }, (_, k) => k + 1).join(' ');
}

export { esc };
