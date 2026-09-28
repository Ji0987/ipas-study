// 將官方學習指引的章末練習題匯入題庫（src: guide）。
// 用法：node scripts/import-guide.mjs [證照 id]（預設 aiot）
// 前置：scripts/extract-guide.py <證照> 產生 .cache/guide/<證照>/questions.json。
// 讀 scripts/guide-additions-<證照>.json（key 為「節 題號」，如 "3-1 4"），內容
//   {}（照官方原文收錄，主題依所在的節）、或 { topic?, stem?, opts?, ans?, exp? } 覆寫，或 { skip: "理由" }（題目有瑕疵不收錄）。
// 只匯入 additions 中有列出的題目（逐題檢查過才收錄）；已匯入的（以 ref 判斷）不會重複加入，可安全重跑。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT_ID = process.argv[2] || 'aiot';
const CERTS = {
  // 學習指引各節 → 筆記主題、題目所屬科目
  aiot: {
    subject: 's1',
    topic: { '3-1': 'ai-basic', '3-2': 'aiot-cases', '4-1': 'iot-arch', '4-2': 'iot-protocol', '4-3': 'ind-std', '4-4': 'middleware', '4-5': 'iot-sec', '5-1': 'sensor-basic', '5-2': 'sensor-signal' },
  },
};
const C = CERTS[CERT_ID];
const CERT = path.join(ROOT, 'certs', CERT_ID);
const ADDITIONS = path.join(ROOT, 'scripts', `guide-additions-${CERT_ID}.json`);
const PREFIX = JSON.parse(fs.readFileSync(path.join(CERT, 'config.json'), 'utf8')).idPrefix;

// 與 import-official.mjs 相同的清理：中文字之間的換行／空白刪除，其餘換行改成空白
const WIDE = '\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef';
const WIDE_GAP = new RegExp(`(?<=[${WIDE}])\\s+(?=[${WIDE}])`, 'gu');
// CJK 相容表意文字（外觀相同、碼位不同，如 U+F98E「年」）轉回一般漢字
const tidy = t => t.replace(/[\uF900-\uFAFF]/g, c => c.normalize('NFKC')).replace(WIDE_GAP, '').replace(/([A-Za-z])-\s+([a-z])/g, '$1-$2').replace(/\s+/g, ' ').trim();

const guide = JSON.parse(fs.readFileSync(path.join(ROOT, '.cache', 'guide', CERT_ID, 'questions.json'), 'utf8'));
const additions = fs.existsSync(ADDITIONS) ? JSON.parse(fs.readFileSync(ADDITIONS, 'utf8')) : {};
const quizFile = s => path.join(CERT, 'quiz', `${s}.json`);
const bank = fs.existsSync(quizFile(C.subject)) ? JSON.parse(fs.readFileSync(quizFile(C.subject), 'utf8')) : [];
const allIds = fs.existsSync(path.join(CERT, 'quiz')) ? fs.readdirSync(path.join(CERT, 'quiz')).flatMap(f => JSON.parse(fs.readFileSync(path.join(CERT, 'quiz', f), 'utf8')).map(q => q.id)) : [];
const used = new Set(bank.map(q => q.ref));

const ref = g => `指引 ${g.section} ${g.no}`;
const key = g => `${g.section} ${g.no}`;
const todo = guide.filter(g => !additions[key(g)]);
const skipped = guide.filter(g => additions[key(g)]?.skip);
const ready = guide.filter(g => additions[key(g)] && !additions[key(g)].skip && !used.has(ref(g)));
console.log(`學習指引練習題 ${guide.length}：未檢查 ${todo.length}、不收錄 ${skipped.length}、待匯入 ${ready.length}`);
if (!ready.length) process.exit(0);

let next = Math.max(0, ...allIds.map(id => +id.slice(-4))) + 1;
for (const g of ready) {
  const a = additions[key(g)];
  bank.push({
    id: `${PREFIX}-q-${String(next++).padStart(4, '0')}`, topic: a.topic ?? C.topic[g.section], src: 'guide', ref: ref(g),
    q: a.stem ?? tidy(g.stem),
    opts: a.opts ?? g.opts.map(tidy),
    ans: 'ABCD'.indexOf(a.ans ?? g.ans), exp: a.exp ?? tidy(g.exp),
  });
}
fs.mkdirSync(path.join(CERT, 'quiz'), { recursive: true });
fs.writeFileSync(quizFile(C.subject), '[\n' + bank.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n');
console.log(`已匯入 ${ready.length} 題（${ref(ready[0])} … ${ref(ready.at(-1))}）`);
