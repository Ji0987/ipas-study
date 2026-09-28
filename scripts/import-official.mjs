// 將官方公告試題中尚未收錄的題目匯入題庫。
// 用法：node scripts/import-official.mjs [證照 id]（預設 ai-planner）
// 前置：scripts/extract-official.py <證照> 產生 .cache/official/<證照>/questions.json 與附圖。
//
// 階段一（沒有 additions 檔或缺項時）：比對現有題庫，找出未收錄的官方題，輸出
//   .cache/official/<證照>/pending.md   供人工逐題撰寫主題與詳解的清單
//   歷屆試卷重複出現的同一題（題幹與選項皆相似）只列最新一次，其餘記為同題；疑義題（皆給分等）略過。
// 階段二：讀 additions 檔（key 為出處 ref，如 "115-1 s2 8"），內容
//   { topic, exp, stem?, opts?, ans?, ctx?, figs? }（可覆寫自動抽取的文字、答案與附圖位置），或 { skip: "理由" }（不收錄，如超出評鑑範圍），
//   依試卷與題號順序接續編 id 寫入 certs/<證照>/quiz/<科目>.json，附圖複製到 certs/<證照>/img/。
// 已匯入的題目（以 ref 判斷）不會重複加入，可安全重跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT_ID = process.argv[2] || 'ai-planner';
const CERTS = {
  // 舊版題目（沒有 ref）以文字覆蓋率比對是否已收錄
  'ai-planner': { subject: { basic: { 1: 'bs1', 2: 'bs2' }, inter: { 1: 's1', 2: 's2', 3: 's3' } }, ref: o => `${o.exam} ${o.subject} ${o.no}`, additions: 'official-additions.json', legacy: true },
  // 舊版「物聯網應用工程師（初級）」試卷：ref 保留舊科目代碼（iot1／iot2），歷屆重複題去重
  aiot: { subject: { basic: { iot1: 's1', iot2: 's2' } }, ref: o => `${o.exam} ${o.subjectNo} ${o.no}`, additions: 'official-additions-aiot.json', dedupe: true },
};
const C = CERTS[CERT_ID];
const CERT = path.join(ROOT, 'certs', CERT_ID);
const OFFICIAL = path.join(ROOT, '.cache', 'official', CERT_ID);
const ADDITIONS = path.join(ROOT, 'scripts', C.additions);
const PREFIX = JSON.parse(fs.readFileSync(path.join(CERT, 'config.json'), 'utf8')).idPrefix;
const N = 6;

const normText = t => t.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
// 與 migrate-legacy.mjs 相同的清理：中文字之間的換行／空白刪除，其餘換行改成空白
const WIDE = '\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef';
const WIDE_GAP = new RegExp(`(?<=[${WIDE}])\\s+(?=[${WIDE}])`, 'gu');
// CJK 相容表意文字（外觀相同、碼位不同，如 U+F98E「年」）轉回一般漢字
const tidy = t => t.replace(/[\uF900-\uFAFF]/g, c => c.normalize('NFKC')).replace(WIDE_GAP, '').replace(/([A-Za-z])-\s+([a-z])/g, '$1-$2').replace(/\s+/g, ' ').trim();
const tidyOpt = t => tidy(t).replace(/[；;]$/, '');
const bigrams = t => { const s = new Set(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; };
const jaccard = (a, b) => { let n = 0; for (const g of a) if (b.has(g)) n++; return n / (a.size + b.size - n || 1); };

const all = JSON.parse(fs.readFileSync(path.join(OFFICIAL, 'questions.json'), 'utf8'));
for (const o of all) {
  o.subject = C.subject[o.level][o.subjectNo];
  o.ref = C.ref(o);
}
// 疑義題（答案為「*」加官方標示，如皆給分）不收錄
const disputed = all.filter(o => o.ans.startsWith('*'));
let official = all.filter(o => !o.ans.startsWith('*'));
for (const o of official) {
  const t = normText(o.stem + o.opts.join(''));
  o.set = new Set(); for (let i = 0; i + N <= t.length; i++) o.set.add(t.slice(i, i + N));
}

// 歷屆重複題：題幹與（排序後的）選項都相似即視為同一題，保留最新一次（試卷代碼較大者）
// 選項幾乎相同時，題幹只是換句話說（「何者不正確」↔「哪一項錯誤」）也算同一題
const similar = (a, b) => { const s = jaccard(a.s, b.s), p = jaccard(a.p, b.p); return (s >= 0.6 && p >= 0.6) || (s >= 0.3 && p >= 0.9); };
const sig = (stem, opts) => ({ s: bigrams(normText(stem)), p: bigrams(opts.map(normText).sort().join('|')) });
const dupOf = new Map();  // ref → 保留的 ref
if (C.dedupe) {
  const g = official.map(o => ({ o, ...sig(o.stem, o.opts) }));
  const parent = g.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    if (similar(g[i], g[j])) parent[find(i)] = find(j);
  }
  const groups = new Map();
  g.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x.o); });
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => b.exam.localeCompare(a.exam) || a.no - b.no);
    const keep = members[0];
    keep.same = members.slice(1).map(o => `${o.ref}（答案 ${o.ans}）`);
    for (const o of members.slice(1)) dupOf.set(o.ref, keep.ref);
  }
  official = official.filter(o => !dupOf.has(o.ref));
}

const quizFile = s => path.join(CERT, 'quiz', `${s}.json`);
const bank = {};
for (const s of Object.values(C.subject).flatMap(Object.values)) bank[s] = fs.existsSync(quizFile(s)) ? JSON.parse(fs.readFileSync(quizFile(s), 'utf8')) : [];
const allBank = Object.values(bank).flat();

// 找出現有題庫已收錄的官方題：新匯入的題目帶 ref；舊版題目以文字覆蓋率比對（與 migrate-legacy.mjs 相同）
const used = new Set(allBank.filter(q => q.ref).map(q => q.ref));
const coverage = (t, set) => { let hit = 0, n = 0; for (let i = 0; i + N <= t.length; i++) { n++; if (set.has(t.slice(i, i + N))) hit++; } return n ? hit / n : 0; };
if (C.legacy) for (const q of allBank.filter(q => !q.ref)) {
  const stem = normText(q.q), full = normText(q.q + q.opts.join(''));
  const level = q.id && Object.entries(C.subject).find(([, m]) => Object.values(m).some(s => bank[s].includes(q)))[0];
  let best = null;
  for (const o of official.filter(o => o.level === level)) {
    const fullCov = coverage(full, o.set), cov = Math.max(coverage(stem, o.set), fullCov);
    if (!best || cov > best.cov || (cov === best.cov && fullCov > best.fullCov)) best = { o, cov, fullCov };
  }
  if (best && best.cov >= 0.15) used.add(best.o.ref);
}
// 題庫中其他來源的題目（如學習指引練習題，ref 為「指引 …」）若與官方題相同，官方題視為已收錄
const inBank = new Map();  // 官方 ref → 題庫中相同題目的 id
if (C.dedupe) for (const q of allBank.filter(q => q.ref?.startsWith('指引'))) {
  const a = sig(q.q, q.opts);
  for (const o of official) if (!used.has(o.ref) && similar(a, sig(o.stem, o.opts))) { used.add(o.ref); inBank.set(o.ref, q.id); }
}
const additions = fs.existsSync(ADDITIONS) ? JSON.parse(fs.readFileSync(ADDITIONS, 'utf8')) : {};
const skipped = official.filter(o => !used.has(o.ref) && additions[o.ref]?.skip);
const pending = official.filter(o => !used.has(o.ref) && !additions[o.ref]?.skip);
const imgSrc = f => `img/${f}`;

// ── 階段一：待辦清單 ─────────────────────────────────────────
const L = ['# 待匯入的官方題', '',
  `共 ${pending.length} 題；已有 additions 的 ${pending.filter(o => additions[o.ref]).length} 題。` +
  `另有歷屆重複 ${dupOf.size} 題、與題庫其他來源重複 ${inBank.size} 題、疑義題 ${disputed.length} 題、標記不收錄 ${skipped.length} 題。`, ''];
for (const o of pending) {
  L.push(`## ${o.ref}（答案 ${o.ans}）${additions[o.ref] ? ' ✅' : ''}`, '');
  if (o.same) L.push(`- 同題：${o.same.join('、')}`);
  if (o.group) L.push(`- 題組 ${o.group.from}～${o.group.to}${o.group.above ? '（情境在說明句之前，需人工補）' : ''}：${tidy(o.group.text) || '（無文字）'}${o.group.images.map(i => ` [圖 ${i.file}]`).join('')}`);
  L.push(`- 題幹：${tidy(o.stem)}`);
  o.opts.forEach((t, i) => L.push(`- (${'ABCD'[i]}) ${tidyOpt(t)}`));
  for (const im of o.images) L.push(`- [圖 ${im.file} @${im.at} ${im.w}×${im.h}]`);
  L.push('');
}
if (inBank.size) L.push('# 與題庫其他來源重複（不另收錄）', '', ...[...inBank].map(([r, id]) => `- ${r} → ${id}`), '');
if (disputed.length) L.push('# 疑義題（不收錄）', '', ...disputed.map(o => `- ${o.ref}：${o.ans.slice(1)}｜${tidy(o.stem)}`), '');
fs.writeFileSync(path.join(OFFICIAL, 'pending.md'), L.join('\n'));
const byPaper = [...new Set(pending.map(o => o.exam + ' ' + o.subject))].map(k => `${k}:${pending.filter(o => o.exam + ' ' + o.subject === k).length}`);
console.log(`未收錄的官方題：${pending.length}（${byPaper.join('、')}）；歷屆重複 ${dupOf.size}、與題庫重複 ${inBank.size}、疑義 ${disputed.length}、不收錄 ${skipped.length}`);

// ── 階段二：匯入 ─────────────────────────────────────────────
const ready = pending.filter(o => additions[o.ref]);
if (!ready.length) { console.log(`沒有可匯入的題目（scripts/${C.additions} 尚無對應項目）`); process.exit(0); }
let next = Math.max(0, ...allBank.map(q => +q.id.slice(-4))) + 1;
fs.mkdirSync(path.join(CERT, 'img'), { recursive: true });
const copyImg = f => fs.copyFileSync(path.join(OFFICIAL, 'img', f), path.join(CERT, 'img', f));
for (const o of ready) {
  const a = additions[o.ref];
  // 附圖位置：ctx（題組情境）、stem（題幹）或選項字母；additions 可用 figs:[{file, at}] 整組覆寫
  const autoFigs = [...(o.group ? o.group.images.map(im => ({ file: im.file, at: 'ctx' })) : []), ...o.images.map(im => ({ file: im.file, at: im.at }))];
  const figs = (a.figs ?? autoFigs).map(f => { copyImg(f.file); return { src: imgSrc(f.file), at: f.at }; });
  const ctx = a.ctx ?? (o.group ? tidy(o.group.text) : '');
  const item = {
    id: `${PREFIX}-q-${String(next++).padStart(4, '0')}`, topic: a.topic, src: 'official', ref: o.ref,
    ...(ctx && { ctx }),
    q: a.stem ?? tidy(o.stem),
    opts: a.opts ?? o.opts.map(tidyOpt),
    ans: 'ABCD'.indexOf(a.ans ?? o.ans), exp: a.exp,
    ...(figs.length && { figs }),
  };
  bank[o.subject].push(item);
}
fs.mkdirSync(path.join(CERT, 'quiz'), { recursive: true });
for (const [s, items] of Object.entries(bank)) {
  if (!items.length) continue;
  fs.writeFileSync(quizFile(s), '[\n' + items.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n');
}
console.log(`已匯入 ${ready.length} 題（${ready[0].ref} … ${ready.at(-1).ref}）`);
