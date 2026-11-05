// 從題庫產生可列印的分回模擬卷 PDF（A4 雙欄，答案縮在最後一頁底部）。
// 排版用 HTML/CSS，再交給本機 Edge 的 headless 模式轉 PDF。
//
// 用法：
//   node scripts/make-exams.mjs <證照>          repo 題庫，每個學科、每 50 題一回（固定種子洗牌）
//   node scripts/make-exams.mjs --from <json>   外部題庫，依原順序每 50 題一回（例如 extract-tutor900.py 的輸出）
// 輸出：exports/<證照>/<模擬卷資料夾>/<前綴>_第NN回.pdf
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const PER = 50;
const WORKERS = Math.min(4, os.cpus().length);
const EDGE = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
].find(p => fs.existsSync(p));

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cssStr = s => '"' + String(s).replace(/["\\]/g, '\\$&') + '"';
const pad = n => String(n).padStart(2, '0');
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));

/** 固定種子的亂數，讓每次重產的分回都一樣 */
function rng(seedText) {
  let a = [...seedText].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619), 2166136261) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 題組（連續且 ctx 相同的題目）綁成一個單位，洗牌與分回時不拆開 */
function units(qs) {
  const out = [];
  for (const q of qs) {
    const last = out.at(-1);
    if (q.ctx && last && last[0].ctx === q.ctx) last.push(q);
    else out.push([q]);
  }
  return out;
}

/** 洗牌後分成 ceil(n/PER) 回；最後一回不足時，從前面的題目補滿 */
function deal(qs, seed) {
  const us = units(qs), rand = rng(seed);
  for (let i = us.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [us[i], us[j]] = [us[j], us[i]];
  }
  const rounds = Array.from({ length: Math.ceil(qs.length / PER) }, () => []);
  for (const u of us) (rounds.find(r => r.length + u.length <= PER) || rounds.at(-1)).push(...u);
  for (const r of rounds) {
    for (const u of us) {
      if (r.length >= PER) break;
      if (!r.includes(u[0]) && r.length + u.length <= PER) r.push(...u);
    }
  }
  return rounds;
}

/** repo 題庫：每個級別、每個學科各自分回 */
function papersFromRepo(cert) {
  const cfg = readJSON(path.join(ROOT, 'certs', cert, 'config.json'));
  const papers = [];
  for (const level of cfg.levels) {
    for (const s of level.subjects.filter(s => !s.practical)) {
      const qs = readJSON(path.join(ROOT, 'certs', cert, 'quiz', `${s.id}.json`));
      const prefix = (cfg.levels.length > 1 ? level.name : '') + s.label;
      const rounds = deal(qs, `${cert}:${level.id}:${s.id}`);
      const seen = new Set(rounds.flat());
      if (seen.size !== qs.length || rounds.some(r => new Set(r).size !== r.length))
        throw new Error(`${prefix} 分回有漏題或同回重複`);
      rounds.forEach((qs, i) => papers.push({
        file: `${prefix}_第${pad(i + 1)}回`,
        title: `iPAS ${cfg.name}${level.name}認證　${s.label} 模擬卷 第 ${i + 1} 回`,
        subtitle: `${s.label} ${s.name}`,
        exam: level.exam, questions: qs,
      }));
    }
  }
  return { cert, outDir: '模擬卷', papers };
}

/** 外部題庫：依原順序切回，回數跨段連號 */
function papersFromFile(file) {
  const src = readJSON(file);
  const cfg = readJSON(path.join(ROOT, 'certs', src.cert, 'config.json'));
  const level = cfg.levels.find(l => l.id === src.level);
  const papers = [];
  for (const sec of src.sections) {
    for (let i = 0; i < sec.questions.length; i += PER) {
      const n = papers.length + 1, qs = sec.questions.slice(i, i + PER);
      papers.push({
        file: `${sec.name}_第${pad(n)}回`,
        title: `iPAS ${cfg.name}${level.name}認證　模擬卷 第 ${n} 回`,
        subtitle: `${sec.subtitle}　原題號 ${sec.start + i}–${sec.start + i + qs.length - 1}`,
        exam: level.exam, questions: qs,
      });
    }
  }
  return { cert: src.cert, outDir: src.outDir, papers };
}

const L = 'ABCD';
const figs = (q, at) => (q.figs || []).filter(f => f.at === at).map(f => `<img src="${esc(f.src)}" alt="">`).join('');

function questionHTML(q, n, ctxRange) {
  const ctx = ctxRange && (q.ctx || figs(q, 'ctx'))
    ? `<div class="ctx"><b>題組（第 ${ctxRange} 題）</b>${q.ctx ? `<div>${esc(q.ctx)}</div>` : ''}${figs(q, 'ctx')}</div>` : '';
  const media = (q.img ? `<img src="${esc(q.img)}" alt="">` : q.code ? `<pre>${esc(q.code)}</pre>` : '') + figs(q, 'stem');
  const opts = q.opts.map((o, i) => `<li><b>(${L[i]})</b><span${q.codeOpts ? ' class="mono"' : ''}>${esc(o)}${figs(q, L[i])}</span></li>`).join('');
  return `${ctx}<div class="q"><div class="stem"><b>${n}.</b><span>${esc(q.q)}</span></div>${media ? `<div class="media">${media}</div>` : ''}<ol>${opts}</ol></div>`;
}

function paperHTML(p, cert) {
  const qs = p.questions, pts = +(100 / qs.length).toFixed(2), ex = p.exam;
  let body = '';
  qs.forEach((q, i) => {
    let range = '';
    if (q.ctx && qs[i - 1]?.ctx !== q.ctx) {
      let j = i;
      while (qs[j + 1]?.ctx === q.ctx) j++;
      range = j > i ? `${i + 1}–${j + 1}` : `${i + 1}`;
    }
    body += questionHTML(q, i + 1, range);
  });
  const key = [];
  for (let i = 0; i < qs.length; i += 25) {
    const row = qs.slice(i, i + 25);
    key.push(`<tr class="n">${row.map((_, j) => `<td>${i + j + 1}</td>`).join('')}</tr><tr>${row.map(q => `<td>${L[q.ans]}</td>`).join('')}</tr>`);
  }
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<base href="${pathToFileURL(path.join(ROOT, 'certs', cert)).href}/">
<title>${esc(p.title)}</title><style>
@page { size: A4; margin: 11mm 12mm 13mm;
  @bottom-left { content: ${cssStr(p.title.replace(/\s+/g, ' '))}; font: 7pt "Microsoft JhengHei", sans-serif; color: #666; }
  @bottom-right { content: "第 " counter(page) " 頁／共 " counter(pages) " 頁"; font: 7pt "Microsoft JhengHei", sans-serif; color: #666; } }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font: 9.3pt/1.38"Microsoft JhengHei", "Noto Sans TC", sans-serif; color: #000; }
h1 { font-size: 14pt; text-align: center; letter-spacing: .5pt; }
.meta { display: flex; gap: 3em; border-bottom: 1.2pt solid #000; padding: 4pt 0 2pt; font-size: 9pt; }
.meta span:last-child { margin-left: auto; }
.rule { font-weight: bold; margin: 4pt 0 6pt; border-left: 3pt solid #000; padding-left: 4pt; }
.cols { columns: 2; column-gap: 7mm; column-rule: .4pt solid #bbb; }
.q { break-inside: avoid; margin-bottom: 5pt; }
.stem { display: flex; gap: 3pt; font-weight: bold; }
ol { list-style: none; padding-left: 1.2em; }
li { display: flex; gap: 3pt; }
li b { font-weight: normal; flex: none; }
.ctx { break-inside: avoid; border: .6pt solid #888; padding: 3pt 5pt; margin-bottom: 5pt; font-size: 9pt; }
.ctx b { display: block; }
img { display: block; max-width: 100%; max-height: 55mm; margin: 2pt 0; }
pre, .mono { font: 8pt/1.3 Consolas, "Microsoft JhengHei", monospace; white-space: pre-wrap; }
pre { border: .4pt solid #bbb; padding: 2pt 4pt; margin: 2pt 0; }
.key { break-inside: avoid; margin-top: 6pt; border-top: 1.2pt solid #000; padding-top: 3pt; }
.key .hd { display: flex; font-weight: bold; margin-bottom: 2pt; }
.key .hd span:last-child { margin-left: auto; font-weight: normal; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 3pt; }
td { border: .5pt solid #888; text-align: center; font-weight: bold; font-size: 9pt; }
tr.n td { font-weight: normal; font-size: 7pt; background: #eee; }
</style></head><body>
<h1>${esc(p.title)}</h1>
<div class="meta"><span>姓名：＿＿＿＿＿＿</span><span>考試日期：＿＿＿＿＿＿</span><span>${esc(p.subtitle)}</span></div>
<div class="rule">單選題，每題 ${pts} 分，共 ${qs.length} 題，總分 100 分（作答 ${ex.minutes} 分鐘，${ex.pass} 分及格）</div>
<div class="cols">${body}</div>
<div class="key"><div class="hd"><span>▌ 正確答案</span><span>答對 ＿＿ 題 × ${pts} ＝ 得分 ＿＿＿ / 100</span></div><table>${key.join('</table><table>')}</table></div>
</body></html>`;
}

const run = promisify(execFile);

async function printAll(jobs) {
  const tmp = path.join(ROOT, '.cache', 'exams');
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    while (next < jobs.length) {
      const { html, pdf } = jobs[next++];
      await run(EDGE, ['--headless', '--disable-gpu', '--no-first-run', '--disable-extensions',
        `--user-data-dir=${path.join(tmp, `edge-${w}`)}`, '--no-pdf-header-footer',
        `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { timeout: 60000 });
      if (!fs.existsSync(pdf)) throw new Error(`Edge 沒有產出 ${pdf}`);
    }
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const set = args[0] === '--from' && args[1] ? papersFromFile(path.resolve(args[1]))
    : args[0] && !args[0].startsWith('-') ? papersFromRepo(args[0]) : null;
  if (!set) {
    console.error('用法：node scripts/make-exams.mjs <證照> | --from <json>');
    process.exit(1);
  }
  if (!EDGE) throw new Error('找不到 Microsoft Edge（msedge.exe）');
  const outDir = path.join(ROOT, 'exports', set.cert, set.outDir);
  const htmlDir = path.join(ROOT, '.cache', 'exams', 'html', set.cert, set.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(htmlDir, { recursive: true });
  // 先清掉舊的分回 PDF，回數變少時才不會留下過期的卷
  for (const f of fs.readdirSync(outDir)) if (/_第\d+回\.pdf$/.test(f)) fs.rmSync(path.join(outDir, f));
  const jobs = set.papers.map(p => {
    const html = path.join(htmlDir, `${p.file}.html`);
    fs.writeFileSync(html, paperHTML(p, set.cert));
    return { html, pdf: path.join(outDir, `${p.file}.pdf`) };
  });
  await printAll(jobs);
  console.log(`${path.relative(ROOT, outDir)}：${jobs.length} 回`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
