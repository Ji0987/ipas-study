// 進度備份：匯出／匯入已讀主題、題庫書籤與作答紀錄（跨裝置、跨瀏覽器搬移用）
import { config, subjectOfTopic, subjectById } from './data.js';
import { state, save } from './store.js';
import { showToast } from './ui.js';

const APP = 'ipas-study';

export function openBackup() { document.getElementById('backup-overlay').classList.add('on'); }

export function exportProgress() {
  const data = { app: APP, cert: config.id, version: state.version, exportedAt: new Date().toISOString(), read: state.read, bookmarks: state.bookmarks, answers: state.answers, exams: state.exams };
  const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `ipas-${config.id}-進度-${ymd}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showToast('進度已匯出', '💾');
}

export async function importProgress(input) {
  const file = input.files[0];
  input.value = '';  // 允許重選同一個檔案
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { showToast('檔案不是有效的 JSON', '⚠️'); return; }
  if (data?.app !== APP || data.cert !== config.id) { showToast(`這不是「${config.name}」的進度檔`, '⚠️'); return; }
  if (data.version !== state.version || !Array.isArray(data.read) || !Array.isArray(data.bookmarks)) { showToast('進度檔版本或格式不符', '⚠️'); return; }
  // 只保留目前仍存在的主題與格式正確的題目 id
  const qid = new RegExp(`^${config.idPrefix}-q-\\d+$`);
  const read = [...new Set(data.read.filter(id => typeof id === 'string' && subjectOfTopic[id]))];
  const bookmarks = [...new Set(data.bookmarks.filter(id => typeof id === 'string' && qid.test(id)))];
  // 作答紀錄為較晚加入的欄位，舊的進度檔沒有時視為空
  const answers = {};
  for (const [id, r] of Object.entries(data.answers && typeof data.answers === 'object' ? data.answers : {})) {
    if (!qid.test(id) || !r || !['right', 'wrong'].includes(r.last)) continue;
    answers[id] = { right: Math.max(0, +r.right || 0), wrong: Math.max(0, +r.wrong || 0), last: r.last, at: +r.at || 0 };
  }
  const wrong = Object.values(answers).filter(r => r.last === 'wrong').length;
  // 模擬考成績：只保留仍存在的科目與合理的分數
  const exams = (Array.isArray(data.exams) ? data.exams : [])
    .filter(r => r && subjectById[r.subject] && Number.isFinite(+r.score) && +r.score >= 0 && +r.score <= 100)
    .map(r => ({ subject: r.subject, score: Math.round(+r.score), correct: +r.correct || 0, total: +r.total || 0, secs: +r.secs || 0, at: +r.at || 0 }));
  if (!confirm(`匯入後會取代目前的進度：\n已讀主題 ${read.length} 個、題庫書籤 ${bookmarks.length} 題、作答紀錄 ${Object.keys(answers).length} 題（錯題 ${wrong} 題）、模擬考成績 ${exams.length} 筆。\n確定要匯入嗎？`)) return;
  state.read = read; state.bookmarks = bookmarks; state.answers = answers; state.exams = exams; save();
  showToast('進度已匯入，重新載入中…', '✅');
  setTimeout(() => location.reload(), 800);
}
