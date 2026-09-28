// 全文搜尋：由頁面上的主題建立索引，供側欄搜尋框與指令面板使用
import { subjectById, subjectOfTopic } from './data.js';
import { jumpToTopic } from './layout.js';
import { closeSidebar } from './ui.js';

export const IDX = [];
export function buildIDX() {
  document.querySelectorAll('.tp[id]').forEach(tp => {
    IDX.push({
      id: tp.id, title: tp.querySelector('.tpt')?.textContent?.trim() || '',
      body: tp.querySelector('.tpin')?.textContent?.trim().slice(0, 400) || '',
      sub: subjectOfTopic[tp.id],
    });
  });
}
export function hlite(s, q) { return s.replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'); }

export function initSearch() {
  const siEl = document.getElementById('si'), sresEl = document.getElementById('sres');
  siEl.addEventListener('input', () => {
    const q = siEl.value.trim().toLowerCase();
    if (!q) { sresEl.classList.remove('on'); return; }
    const matches = IDX.filter(i => i.title.toLowerCase().includes(q) || i.body.toLowerCase().includes(q)).slice(0, 7);
    sresEl.innerHTML = !matches.length ? '<div class="sri"><div class="srt" style="color:var(--text3)">找不到結果</div></div>' :
      matches.map(m => `<div class="sri" data-id="${m.id}"><div class="srt">${hlite(m.title, q)}</div><div class="srs">${subjectById[m.sub].label}</div></div>`).join('');
    sresEl.classList.add('on');
    sresEl.querySelectorAll('.sri[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        sresEl.classList.remove('on'); siEl.value = ''; closeSidebar();
        jumpToTopic(el.dataset.id);
      });
    });
  });
  document.addEventListener('click', e => { if (!e.target.closest('.searchbox')) sresEl.classList.remove('on'); });
}
