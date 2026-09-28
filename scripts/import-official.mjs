// 將官方公告試題中尚未收錄的題目匯入題庫。
// 前置：scripts/extract-official.py 產生 .cache/official/questions.json 與附圖。
//
// 階段一（沒有 additions 檔或缺項時）：比對現有題庫，找出未收錄的官方題，輸出
//   .cache/official/pending.md   供人工逐題撰寫主題與詳解的清單
// 階段二：讀 scripts/official-additions.json（key 為「試卷代碼 題號」，如 "115-1 s2 8"），
//   內容 { topic, exp, stem?, opts?, ctx?, figs? }（可覆寫自動抽取的文字與附圖位置），
//   依試卷與題號順序接續編 id 寫入 certs/ai-planner/quiz/<科目>.json，附圖複製到 certs/ai-planner/img/。
// 已匯入的題目（以 ref 判斷）不會重複加入，可安全重跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT = path.join(ROOT, 'certs', 'ai-planner');
const OFFICIAL = path.join(ROOT, '.cache', 'official');
const ADDITIONS = path.join(ROOT, 'scripts', 'official-additions.json');
const SUBJECT = { basic: { 1: 'bs1', 2: 'bs2' }, inter: { 1: 's1', 2: 's2', 3: 's3' } };
const N = 6;

const normText = t => t.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
// 與 migrate-legacy.mjs 相同的清理：中文字之間的換行／空白刪除，其餘換行改成空白
const WIDE = '\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef';
const WIDE_GAP = new RegExp(`(?<=[${WIDE}])\\s+(?=[${WIDE}])`, 'gu');
const tidy = t => t.replace(WIDE_GAP, '').replace(/([A-Za-z])-\s+([a-z])/g, '$1-$2').replace(/\s+/g, ' ').trim();
const tidyOpt = t => tidy(t).replace(/[；;]$/, '');

const official = JSON.parse(fs.readFileSync(path.join(OFFICIAL, 'questions.json'), 'utf8'));
for (const o of official) {
  o.subject = SUBJECT[o.level][o.subjectNo];
  o.ref = `${o.exam} ${o.subject} ${o.no}`;
  const t = normText(o.stem + o.opts.join(''));
  o.set = new Set(); for (let i = 0; i + N <= t.length; i++) o.set.add(t.slice(i, i + N));
}

const quizFile = s => path.join(CERT, 'quiz', `${s}.json`);
const bank = {};
for (const s of Object.values(SUBJECT).flatMap(Object.values)) bank[s] = fs.existsSync(quizFile(s)) ? JSON.parse(fs.readFileSync(quizFile(s), 'utf8')) : [];
const allBank = Object.values(bank).flat();

// 找出現有題庫已收錄的官方題：新匯入的題目帶 ref；舊版題目以文字覆蓋率比對（與 migrate-legacy.mjs 相同）
const used = new Set(allBank.filter(q => q.ref).map(q => q.ref));
const coverage = (t, set) => { let hit = 0, n = 0; for (let i = 0; i + N <= t.length; i++) { n++; if (set.has(t.slice(i, i + N))) hit++; } return n ? hit / n : 0; };
for (const q of allBank.filter(q => !q.ref)) {
  const stem = normText(q.q), full = normText(q.q + q.opts.join(''));
  const level = q.id && Object.entries(SUBJECT).find(([, m]) => Object.values(m).some(s => bank[s].includes(q)))[0];
  let best = null;
  for (const o of official.filter(o => o.level === level)) {
    const fullCov = coverage(full, o.set), cov = Math.max(coverage(stem, o.set), fullCov);
    if (!best || cov > best.cov || (cov === best.cov && fullCov > best.fullCov)) best = { o, cov, fullCov };
  }
  if (best && best.cov >= 0.15) used.add(best.o.ref);
}
const pending = official.filter(o => !used.has(o.ref));
const imgSrc = f => `img/${f}`;

// ── 階段一：待辦清單 ─────────────────────────────────────────
const additions = fs.existsSync(ADDITIONS) ? JSON.parse(fs.readFileSync(ADDITIONS, 'utf8')) : {};
const L = ['# 待匯入的官方題', '', `共 ${pending.length} 題；已有 additions 的 ${pending.filter(o => additions[o.ref]).length} 題。`, ''];
for (const o of pending) {
  L.push(`## ${o.ref}（答案 ${o.ans}）${additions[o.ref] ? ' ✅' : ''}`, '');
  if (o.group) L.push(`- 題組 ${o.group.from}～${o.group.to}${o.group.above ? '（情境在說明句之前，需人工補）' : ''}：${tidy(o.group.text) || '（無文字）'}${o.group.images.map(i => ` [圖 ${i.file}]`).join('')}`);
  L.push(`- 題幹：${tidy(o.stem)}`);
  o.opts.forEach((t, i) => L.push(`- (${'ABCD'[i]}) ${tidyOpt(t)}`));
  for (const im of o.images) L.push(`- [圖 ${im.file} @${im.at} ${im.w}×${im.h}]`);
  L.push('');
}
fs.writeFileSync(path.join(OFFICIAL, 'pending.md'), L.join('\n'));
console.log(`未收錄的官方題：${pending.length}（${[...new Set(pending.map(o => o.exam + ' ' + o.subject))].map(k => `${k}:${pending.filter(o => o.exam + ' ' + o.subject === k).length}`).join('、')}）`);

// ── 階段二：匯入 ─────────────────────────────────────────────
const ready = pending.filter(o => additions[o.ref]);
if (!ready.length) { console.log('沒有可匯入的題目（scripts/official-additions.json 尚無對應項目）'); process.exit(0); }
let next = Math.max(...allBank.map(q => +q.id.slice(-4))) + 1;
fs.mkdirSync(path.join(CERT, 'img'), { recursive: true });
const copyImg = f => fs.copyFileSync(path.join(OFFICIAL, 'img', f), path.join(CERT, 'img', f));
for (const o of ready) {
  const a = additions[o.ref];
  // 附圖位置：ctx（題組情境）、stem（題幹）或選項字母；additions 可用 figs:[{file, at}] 整組覆寫
  const autoFigs = [...(o.group ? o.group.images.map(im => ({ file: im.file, at: 'ctx' })) : []), ...o.images.map(im => ({ file: im.file, at: im.at }))];
  const figs = (a.figs ?? autoFigs).map(f => { copyImg(f.file); return { src: imgSrc(f.file), at: f.at }; });
  const ctx = a.ctx ?? (o.group ? tidy(o.group.text) : '');
  const item = {
    id: `aip-q-${String(next++).padStart(4, '0')}`, topic: a.topic, src: 'official', ref: o.ref,
    ...(ctx && { ctx }),
    q: a.stem ?? tidy(o.stem),
    opts: a.opts ?? o.opts.map(tidyOpt),
    ans: 'ABCD'.indexOf(o.ans), exp: a.exp,
    ...(figs.length && { figs }),
  };
  bank[o.subject].push(item);
}
for (const [s, items] of Object.entries(bank)) {
  if (!items.length) continue;
  fs.writeFileSync(quizFile(s), '[\n' + items.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n');
}
console.log(`已匯入 ${ready.length} 題（${ready[0].ref} … ${ready.at(-1).ref}）`);
