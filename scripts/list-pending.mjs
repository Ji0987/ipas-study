// 以精簡格式列出尚未寫 additions 的官方題，供逐卷審閱（import-official.mjs 階段一的輔助工具）。
// 用法：node scripts/list-pending.mjs <證照> <試卷代碼> [科目代碼]，如 node scripts/list-pending.mjs aiot 113-2 iot1
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cert, exam, subj] = process.argv.slice(2);
const md = fs.readFileSync(path.join(ROOT, '.cache', 'official', cert, 'pending.md'), 'utf8');
// pending.md 每題一節：「## <ref>（答案 X）」後接 - 題幹／- (A)…／- [圖 …]／- 同題：…
for (const sec of md.split(/^## /m).slice(1).map(s => s.split(/^# /m)[0])) {
  const head = sec.slice(0, sec.indexOf('\n'));
  if (head.includes('✅') || !head.startsWith(exam + ' ') || (subj && !head.startsWith(`${exam} ${subj} `))) continue;
  const lines = sec.split('\n').slice(1).filter(l => l.startsWith('- ')).map(l => l.slice(2));
  console.log(`## ${head.replace('（答案 ', ' [').replace('）', ']')}`);
  for (const l of lines) console.log(l.startsWith('題幹：') ? l.slice(3) : '  ' + l);
}
