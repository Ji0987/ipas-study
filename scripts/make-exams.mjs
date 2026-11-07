// 從題庫產生可列印的分回模擬卷 PDF（A4 雙欄，答案縮在最後一頁底部）。
// 排版用 HTML/CSS，再交給本機 Edge 的 headless 模式（DevTools 協定）轉 PDF。
//
// 列印方式是一張紙雙面、每面兩頁，4 頁剛好一張：每回的頁數必須是 4 的倍數，
// 因此每回各自調整字級，在不超過目標頁數的前提下取最大字級，把版面填滿。
//
// 用法：
//   node scripts/make-exams.mjs <證照>          repo 題庫，每個學科、每 50 題一回（固定種子洗牌）
//   node scripts/make-exams.mjs --from <json>   外部題庫，依原順序每 50 題一回（例如 extract-tutor900.py 的輸出）
// 輸出：exports/<證照>/<模擬卷資料夾>/<前綴>_第NN回.pdf，以及整批依序合併的 <模擬卷資料夾>_合併列印.pdf
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const ROOT = path.resolve(import.meta.dirname, '..');
const PER = 50;
const SHEET = 4;              // 一張紙印 4 頁
const FS_MIN = 80, FS_MAX = 140; // 字級搜尋範圍，單位 0.1pt
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
  // 情境放進第一題的方塊裡，兩者才不會被拆到不同欄或不同頁
  const ctx = ctxRange && (q.ctx || figs(q, 'ctx'))
    ? `<div class="ctx"><b>${ctxRange.includes('–') ? `題組（第 ${ctxRange} 題）` : '說明'}</b>${q.ctx ? `<div>${esc(q.ctx)}</div>` : ''}${figs(q, 'ctx')}</div>` : '';
  const media = (q.img ? `<img src="${esc(q.img)}" alt="">` : q.code ? `<pre>${esc(q.code)}</pre>` : '') + figs(q, 'stem');
  const opts = q.opts.map((o, i) => `<li><b>(${L[i]})</b><span${q.codeOpts ? ' class="mono"' : ''}>${esc(o)}${figs(q, L[i])}</span></li>`).join('');
  return `<div class="q">${ctx}<div class="stem"><b>${n}.</b><span>${esc(q.q)}</span></div>${media ? `<div class="media">${media}</div>` : ''}<ol>${opts}</ol></div>`;
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
/* 字級全部跟著 --fs 縮放，make-exams 逐回調整 --fs 讓頁數剛好是 4 的倍數 */
:root { --fs: 9.6pt; }
body { font: var(--fs)/1.4 "Microsoft JhengHei", "Noto Sans TC", sans-serif; color: #000; }
h1 { font-size: 1.45em; text-align: center; letter-spacing: .5pt; }
.meta { display: flex; gap: 3em; border-bottom: 1.2pt solid #000; padding: .4em 0 .2em; font-size: .94em; }
.meta span:last-child { margin-left: auto; }
.rule { font-weight: bold; margin: .4em 0 .6em; border-left: 3pt solid #000; padding-left: .4em; }
.cols { columns: 2; column-gap: 7mm; column-rule: .4pt solid #bbb; }
.q { break-inside: avoid; margin-bottom: .55em; }
.stem { display: flex; gap: .3em; font-weight: bold; }
ol { list-style: none; padding-left: 1.2em; }
li { display: flex; gap: .3em; }
li b { font-weight: normal; flex: none; }
/* 長程式碼、網址要能在任意處斷行；否則內容比紙寬時 Edge 會整頁縮小，字級就失準 */
.stem span, li span, pre, .ctx { min-width: 0; overflow-wrap: anywhere; }
.ctx { break-inside: avoid; border: .6pt solid #888; padding: .3em .5em; margin-bottom: .55em; font-size: .94em; }
.ctx b { display: block; }
img { display: block; max-width: 100%; max-height: 17em; margin: .2em 0; }
pre, .mono { font: .85em/1.3 Consolas, "Microsoft JhengHei", monospace; white-space: pre-wrap; }
pre { border: .4pt solid #bbb; padding: .2em .4em; margin: .2em 0; }
.key { break-inside: avoid; margin-top: calc(.6em + var(--keygap, 0mm));border-top: 1.2pt solid #000; padding-top: .3em; }
.key .hd { display: flex; font-weight: bold; margin-bottom: .2em; }
.key .hd span:last-child { margin-left: auto; font-weight: normal; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: .3em; }
td { border: .5pt solid #888; text-align: center; font-weight: bold; font-size: .94em; }
tr.n td { font-weight: normal; font-size: .75em; background: #eee; }
</style></head><body>
<h1>${esc(p.title)}</h1>
<div class="meta"><span>姓名：＿＿＿＿＿＿</span><span>考試日期：＿＿＿＿＿＿</span><span>${esc(p.subtitle)}</span></div>
<div class="rule">單選題，每題 ${pts} 分，共 ${qs.length} 題，總分 100 分（作答 ${ex.minutes} 分鐘，${ex.pass} 分及格）</div>
<div class="cols">${body}</div>
<div class="key"><div class="hd"><span>▌ 正確答案</span><span>答對 ＿＿ 題 × ${pts} ＝ 得分 ＿＿＿ / 100</span></div><table>${key.join('</table><table>')}</table></div>
</body></html>`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 一個 headless Edge 分頁，透過 DevTools 協定反覆調字級、轉 PDF，不必每次重開瀏覽器 */
class Tab {
  static async open() {
    // 每次用新的設定檔資料夾：沿用舊資料夾時，剛結束的 Edge 偶爾還鎖著檔案刪不掉
    const base = path.join(ROOT, '.cache', 'exams');
    fs.mkdirSync(base, { recursive: true });
    const dir = fs.mkdtempSync(path.join(base, 'edge-'));
    const proc = spawn(EDGE, ['--headless', '--disable-gpu', '--no-first-run', '--disable-extensions',
      `--user-data-dir=${dir}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
    const portFile = path.join(dir, 'DevToolsActivePort');
    for (let i = 0; !fs.existsSync(portFile) || !fs.readFileSync(portFile, 'utf8').includes('\n'); i++) {
      if (i > 100) throw new Error('Edge 沒有開啟 DevTools 連接埠');
      await sleep(100);
    }
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
    const tab = new Tab(proc, new WebSocket(page.webSocketDebuggerUrl), dir);
    await new Promise((ok, fail) => { tab.ws.onopen = ok; tab.ws.onerror = fail; });
    await tab.send('Page.enable');
    return tab;
  }
  constructor(proc, ws, dir) {
    Object.assign(this, { proc, ws, dir, id: 0, pending: new Map(), waiters: [] });
    ws.onmessage = ({ data }) => {
      const m = JSON.parse(data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, fail } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? fail(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) {
        this.waiters = this.waiters.filter(w => w.method !== m.method || (w.ok(m.params), false));
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  once(method) { return new Promise(ok => this.waiters.push({ method, ok })); }
  async load(url) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
  }
  async print(fsTenths, gapMm = 0) {
    const set = (k, v) => `document.documentElement.style.setProperty('${k}','${v}');`;
    await this.send('Runtime.evaluate', { expression: set('--fs', `${fsTenths / 10}pt`) + set('--keygap', `${gapMm}mm`) });
    const { data } = await this.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    const buf = Buffer.from(data, 'base64');
    return { buf, pages: (await PDFDocument.load(buf)).getPageCount() };
  }
  async close() {
    this.ws.close();
    // Edge 會派生多個子程序，只結束主程序會留下殘留，所以整棵程序樹一起結束，並等它結束才放開設定檔資料夾
    if (process.platform !== 'win32') this.proc.kill();
    else await new Promise(ok => spawn('taskkill', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', ok));
    try { fs.rmSync(this.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* 下次執行再清 */ }
  }
}

/**
 * 找出不超過目標頁數（最小字級時頁數進位到 4 的倍數）的最大字級，
 * 再找答案表上方最多能留多少空白而不多出一頁，讓答案表貼齊最後一頁底部
 */
async function fit(tab) {
  const cache = new Map();
  const at = async f => cache.get(f) || cache.set(f, await tab.print(f)).get(f);
  const target = Math.ceil((await at(FS_MIN)).pages / SHEET) * SHEET;
  let lo = FS_MIN, hi = FS_MAX;
  if ((await at(hi)).pages <= target) lo = hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await at(mid)).pages <= target) lo = mid; else hi = mid;
  }
  const best = await at(lo);
  let gap = 0, gapHi = 270; // A4 高 297mm，扣掉上下邊界
  let pinned = best;
  while (gapHi - gap > 1) {
    const mid = (gap + gapHi) >> 1, r = await tab.print(lo, mid);
    if (r.pages === best.pages) { gap = mid; pinned = r; } else gapHi = mid;
  }
  return { ...pinned, fs: lo / 10, target };
}

async function printAll(jobs) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(WORKERS, jobs.length) }, async (_, w) => {
    let tab = await Tab.open();
    try {
      while (next < jobs.length) {
        const job = jobs[next++];
        for (let tries = 1; ; tries++) {
          try {
            await tab.load(pathToFileURL(job.html).href);
            Object.assign(job, await fit(tab));
            break;
          } catch (e) {
            // Edge 偶爾回「Printing is not available」，重開瀏覽器再試一次
            if (tries > 1) throw new Error(`${path.basename(job.pdf)}：${e.message}`);
            await tab.close();
            tab = await Tab.open();
          }
        }
      }
    } finally { await tab.close(); }
  }));
}

/** 整批依序合併成一個檔，方便一次送印；頁數不足 4 的倍數時補空白頁，讓每回都從新的一張紙開始 */
async function merge(jobs, file) {
  const out = await PDFDocument.create();
  for (const job of jobs) {
    const src = await PDFDocument.load(job.buf);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
    for (let i = job.pages; i < job.target; i++) out.addPage([595.28, 841.89]); // A4
  }
  fs.writeFileSync(file, await out.save());
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
  // 清掉上次執行沒刪成的 Edge 設定檔資料夾（當時還被鎖著）
  const base = path.join(ROOT, '.cache', 'exams');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (d.startsWith('edge-')) try { fs.rmSync(path.join(base, d), { recursive: true, force: true }); } catch { /* 還在用就留著 */ }
  }
  const outDir = path.join(ROOT, 'exports', set.cert, set.outDir);
  const htmlDir = path.join(ROOT, '.cache', 'exams', 'html', set.cert, set.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(htmlDir, { recursive: true });
  const jobs = set.papers.map(p => {
    const html = path.join(htmlDir, `${p.file}.html`);
    fs.writeFileSync(html, paperHTML(p, set.cert));
    return { html, pdf: path.join(outDir, `${p.file}.pdf`) };
  });
  await printAll(jobs);
  // 全部成功才寫檔；這批沒有的舊分回 PDF（回數變少時）一併清掉
  const keep = new Set(jobs.map(j => path.basename(j.pdf)));
  for (const f of fs.readdirSync(outDir)) if (/_第\d+回\.pdf$/.test(f) && !keep.has(f)) fs.rmSync(path.join(outDir, f));
  for (const j of jobs) fs.writeFileSync(j.pdf, j.buf);
  const merged = path.join(outDir, `${set.outDir}_合併列印.pdf`);
  await merge(jobs, merged);
  for (const j of jobs) {
    const note = j.pages === j.target ? '' : `（只有 ${j.pages} 頁，合併檔補了空白頁）`;
    console.log(`  ${path.basename(j.pdf)}：${j.pages} 頁，字級 ${j.fs}pt${note}`);
  }
  console.log(`${path.relative(ROOT, outDir)}：${jobs.length} 回，合併檔 ${path.basename(merged)}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
