// 把一批 additions（JSON 物件）併入 additions 檔，每筆一行、依試卷與題號排序，讓 git diff 易讀。
// 用法：node scripts/merge-additions.mjs <additions 檔> <批次 JSON 檔>
import fs from 'node:fs';

const [target, batch] = process.argv.slice(2);
const cur = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const add = JSON.parse(fs.readFileSync(batch, 'utf8'));
const dup = Object.keys(add).filter(k => k in cur);
if (dup.length) console.warn(`覆寫既有項目：${dup.join('、')}`);
Object.assign(cur, add);
// ref 形如「113-2 iot1 5」：試卷代碼、科目代碼、題號
const parse = k => { const [exam, subj, no] = k.split(' '); return [exam, subj, +no]; };
const keys = Object.keys(cur).sort((a, b) => {
  const [ea, sa, na] = parse(a), [eb, sb, nb] = parse(b);
  return sa.localeCompare(sb) || ea.localeCompare(eb) || na - nb;
});
fs.writeFileSync(target, '{\n' + keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(cur[k])}`).join(',\n') + '\n}\n');
console.log(`${target}：共 ${keys.length} 筆（本批 ${Object.keys(add).length}）`);
