// 指令面板（⌘K）：執行指令或跳到主題
import { IDX } from './search.js';
import { currentLevel, switchSub, jumpToTopic } from './layout.js';
import { openQuiz } from './quiz.js';
import { openKeys } from './ui.js';
import { openBackup } from './backup.js';

const NUM_ICONS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
// 科目切換指令依目前級別產生
const commands = () => [
  { ico: '📝', label: '開啟知識測驗', kbd: 'Q', fn: () => openQuiz() },
  { ico: '❌', label: '練習錯題', kbd: 'W', fn: () => openQuiz('wrong') },
  ...currentLevel().subjects.map((s, i) => ({ ico: NUM_ICONS[i], label: `切換到${s.label}`, kbd: String(i + 1), fn: () => switchSub(s.id) })),
  { ico: '💾', label: '進度備份（匯出／匯入）', kbd: '', fn: openBackup },
  { ico: '⌨️', label: '查看鍵盤快捷鍵', kbd: '', fn: openKeys },
];

export function openCmd() {
  document.getElementById('cmd-wrap').classList.add('on');
  document.getElementById('cmd-inp').value = ''; renderCmdRes('');
  setTimeout(() => document.getElementById('cmd-inp').focus(), 50);
}
export function closeCmd() { document.getElementById('cmd-wrap').classList.remove('on'); }
function renderCmdRes(q) {
  const ql = q.toLowerCase();
  const all = commands();
  const cmds = all.filter(c => !ql || c.label.includes(ql));
  const tops = IDX.filter(i => ql && (i.title.toLowerCase().includes(ql) || i.body.toLowerCase().includes(ql))).slice(0, 5);
  let h = '';
  if (cmds.length) h += '<div class="cmdslbl">指令</div>' + cmds.map(c => `<div class="cmditem" data-cmd="${all.indexOf(c)}"><span class="ci-ico">${c.ico}</span><span class="ci-lbl">${c.label}</span>${c.kbd ? `<span class="ci-kbd">${c.kbd}</span>` : ''}</div>`).join('');
  if (tops.length) h += '<div class="cmdslbl">跳轉到主題</div>' + tops.map(t => `<div class="cmditem" data-tid="${t.id}"><span class="ci-ico">📄</span><span class="ci-lbl">${t.title}</span></div>`).join('');
  document.getElementById('cmd-res').innerHTML = h || '<div style="padding:16px;text-align:center;color:var(--text3);font-size:13px">輸入關鍵字搜尋…</div>';
  document.querySelectorAll('.cmditem[data-cmd]').forEach(el => { el.addEventListener('click', () => { all[+el.dataset.cmd].fn(); closeCmd(); }); });
  document.querySelectorAll('.cmditem[data-tid]').forEach(el => {
    el.addEventListener('click', () => { closeCmd(); jumpToTopic(el.dataset.tid); });
  });
}
export function initCmd() {
  document.getElementById('cmd-inp').addEventListener('input', e => renderCmdRes(e.target.value.trim()));
}
