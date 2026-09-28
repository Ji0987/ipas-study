// 一次性轉換：legacy 單檔 HTML → certs/ai-planner 的 config.json 與 quiz/<科目>.json，
// 並產出 reports/migration-review.md 供人工檢查。
// 前置：先執行 scripts/extract-pdf-text.py 產生 .cache/pdftext/。
// 主題對應以 scripts/topic-assignments.json 為準（人工判讀結果）；未列出的題目才用字元相似度自動推測。
// 注意：重跑會覆寫輸出檔；資料定稿後應直接改 JSON，不要再重跑本腳本。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CERT = path.join(ROOT, 'certs', 'ai-planner');
const PDFTEXT = path.join(ROOT, '.cache', 'pdftext');
const LEGACY = path.join(ROOT, 'legacy', 'iPAS｜AI 應用規劃師完整筆記.html');
const ASSIGNMENTS = path.join(ROOT, 'scripts', 'topic-assignments.json');
const PREFIX = 'aip';
const LEVEL_NAMES = { basic: '初級', inter: '中級' };
const N = 6;                  // 比對來源用的字元 n-gram 長度
const OFFICIAL_MIN = 0.15;    // 題幹覆蓋率達此值視為官方題
const OFFICIAL_SURE = 0.5;    // 低於此值列入人工確認

// ── 讀取 legacy ─────────────────────────────────────────────
const html = fs.readFileSync(LEGACY, 'utf8');
const js = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
const body = html.replace(/<script[\s\S]*?<\/script>/, '').replace(/<style[\s\S]*?<\/style>/, '');

// 以括號配對取出頂層常數的字面值（題庫擠在超長單行，不能逐行 regex）
function grabLiteral(name) {
  const i = js.search(new RegExp('(const|let|var)\\s+' + name + '\\s*='));
  if (i < 0) throw new Error(`legacy 找不到 ${name}`);
  let s = js.indexOf('=', i) + 1;
  while (/\s/.test(js[s])) s++;
  let depth = 0, quote = null, j = s;
  for (; j < js.length; j++) {
    const c = js[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('[{('.includes(c)) depth++;
    else if (']})'.includes(c) && --depth === 0) break;
  }
  return vm.runInNewContext('(' + js.slice(s, j + 1) + ')');
}
const QUIZ_BANK = grabLiteral('QUIZ_BANK');

const stripTags = h => h.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').replace(/&[a-z]+;/g, ' ');
const normText = t => t.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const normHtml = h => normText(stripTags(h));

// 文字清理：刪除 PDF 換行殘留在中文字／全形標點之間的空白（中英文之間的空白保留）
const WIDE = '\\p{Script=Han}\\u3000-\\u303f\\uff00-\\uffef';
const WIDE_GAP = new RegExp(`(?<=[${WIDE}])\\s+(?=[${WIDE}])`, 'gu');
const tidy = t => t.replace(WIDE_GAP, '').replace(/([A-Za-z])- +([a-z])/g, '$1-$2').replace(/[ \t]{2,}/g, ' ').trim();
// 舊版題幹裡殘留的試卷欄名「答案 題目」
const LEGACY_JUNK = /\s*答\s*案\s*題\s*目\s*/g;

// 科目名稱來自首頁科目卡
const subjectNames = {};
for (const m of body.matchAll(/switchSub\('(\w+)'\)"><div class="sc-n">([^<]*)<\/div><div class="sc-t">([^<]*)/g)) {
  subjectNames[m[1]] = { label: m[2], name: m[3].trim() };
}

// 科目區塊與主題（依 DOM 順序）
const secs = [...body.matchAll(/<div class="sec[^"]*" id="sec-([^"]+)"/g)].map(m => ({ id: m[1], at: m.index }));
const tps = [...body.matchAll(/<div class="tp" id="([^"]+)"/g)].map(m => ({ id: m[1], at: m.index }));
for (const [k, t] of tps.entries()) {
  const end = Math.min(...[tps[k + 1]?.at, ...secs.map(s => s.at)].filter(x => x > t.at), body.length);
  const chunk = body.slice(t.at, end);
  const tpt = chunk.match(/<div class="tpt">([\s\S]*?)<\/div>/)[1];
  const badge = tpt.match(/<span class="badge (\w+)">([^<]*)<\/span>/);
  t.title = stripTags(tpt.replace(/<span class="badge[\s\S]*?<\/span>/, '')).replace(/\s+/g, ' ').trim();
  t.badge = badge && { text: badge[2], cls: badge[1] };
  t.text = normHtml(chunk);
  t.subject = secs.filter(s => s.at < t.at).pop().id;
  t.level = t.subject.startsWith('b') ? 'basic' : 'inter';
}
const topicById = Object.fromEntries(tps.map(t => [t.id, t]));

// ── 版面資訊：科目卡、側欄導覽、區塊章節、筆記片段 ──────────
// 以 <div 深度計數找出元素的結尾（筆記內只有 div 會巢狀影響結構）
function divEnd(src, start) {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(src))) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error('div 未閉合');
}
const cards = {};
for (const m of body.matchAll(/<div class="sc (\w+)" onclick="switchSub\('(\w+)'\)"><div class="sc-n">([^<]*)<\/div><div class="sc-t">([^<]*)<\/div><div class="sc-tags">(.*?)<\/div><\/div>/g)) {
  cards[m[2]] = { cardClass: m[1], cardTitle: m[3], tags: [...m[5].matchAll(/<span class="stag">([^<]*)<\/span>/g)].map(x => x[1]) };
}
const navLabel = {}, navGroups = {};
for (const g of body.matchAll(/<div class="navg[^"]*" id="ng-(\w+)">/g)) {
  const chunk = body.slice(g.index, divEnd(body, g.index));
  navGroups[g[1]] = [];
  for (const m of chunk.matchAll(/<div class="navch">([^<]*)<\/div>|<a class="nl" data-id="([^"]+)"[^>]*><span class="ndot"><\/span>(.*?)<span class="nchk">/g)) {
    if (m[1] !== undefined) navGroups[g[1]].push({ title: m[1].replace(/&amp;/g, '&'), topics: [] });
    else { navGroups[g[1]].at(-1).topics.push(m[2]); navLabel[m[2]] = m[3]; }
  }
}
const sections = {};
const notes = {};
for (const s of secs) {
  const secHtml = body.slice(s.at, divEnd(body, s.at));
  // 初級區塊的標籤列在 .sec 內第一行
  const label = secHtml.match(/<span class="sec-label (\S+)">([^<]*)<\/span>/);
  const chapters = [];
  for (const m of secHtml.matchAll(/<div class="chap"><span class="cnum (\S+)">([^<]*)<\/span><span class="ctit">([^<]*)<\/span><\/div>|<div class="tp" id="([^"]+)">/g)) {
    if (m[4] === undefined) { chapters.push({ num: m[2], cls: m[1], title: m[3], topics: [] }); continue; }
    chapters.at(-1).topics.push(m[4]);
    const tpStart = s.at + m.index;
    const tpHtml = body.slice(tpStart, divEnd(body, tpStart));
    const inStart = tpHtml.indexOf('<div class="tpin">');
    notes[m[4]] = tpHtml.slice(inStart + '<div class="tpin">'.length, divEnd(tpHtml, inStart) - '</div>'.length);
  }
  sections[s.id] = { secLabel: label && { text: label[2], cls: label[1] }, chapters };
}
const chapnote = body.match(/<div class="chapnote">(.*?)<\/div>/)[1];
const cheatStart = body.indexOf('<div class="cheat-body">');
const cheatsheet = body.slice(cheatStart + '<div class="cheat-body">'.length, divEnd(body, cheatStart) - '</div>'.length);
const pick = re => body.match(re)[1];
const initOpen = js.match(/\[([^\]]*)\]\.forEach\(id=>\{\s*const tp=document\.getElementById\(id\);if\(tp\)tp\.classList\.add\('open'\)/)[1];

// ── config.json ────────────────────────────────────────────
// 各級別的標題文字與配色原本寫在舊版 JS（syncLevelUI）的三元運算中，照抄於此
const LEVEL_UI = {
  basic: { heroTitleEm: '初級兩科完整筆記', heroSub: '涵蓋初級科目一、二全部重點章節。點擊科目卡片切換，按 ✓ 標記已讀追蹤進度。', tagClass: 'lv-b', accent: { fg: 'var(--teal)', bg: 'var(--teald)', border: 'rgba(6,214,160,.3)' } },
  inter: { heroTitleEm: '中級三科完整筆記', heroSub: '涵蓋中級科目一、二、三全部重點章節。點擊科目卡片切換，按 ✓ 標記已讀追蹤進度。', tagClass: 'lv-i', accent: { fg: 'var(--blue)', bg: 'var(--blued)', border: 'rgba(79,155,255,.3)' } },
};
const SUBJECT_LABELS = ['科目一', '科目二', '科目三', '科目四'];
const config = {
  id: 'ai-planner',
  name: 'AI 應用規劃師',
  idPrefix: PREFIX,
  site: {
    title: pick(/<title>([^<]*)<\/title>/),
    mobTitle: pick(/<div class="mob-title">([^<]*)<\/div>/),
    logo: pick(/<div class="logo-row">([^<]*)</),
    logoSub: pick(/<div class="lsub">([^<]*)<\/div>/),
    eyebrow: pick(/<div class="eyebrow">([^<]*)<\/div>/),
    heroTitle: pick(/<h1>([^<]*)<br>/),
    chapnote,
    defaultOpen: [...initOpen.matchAll(/'([^']+)'/g)].map(m => m[1]),
  },
  cheatsheet: { title: pick(/<div class="cheat-title">([^<]*)<\/div>/), sub: pick(/<div class="cheat-sub">([^<]*)<\/div>/) },
  levels: ['basic', 'inter'].map(level => ({
    id: level,
    name: LEVEL_NAMES[level],
    badge: pick(new RegExp(`id="hero-lb-${level}"[^>]*>([^<]*)<`)),
    ...LEVEL_UI[level],
    subjects: secs.filter(s => tps.some(t => t.subject === s.id && t.level === level)).map((s, i) => ({
      id: s.id,
      label: SUBJECT_LABELS[i],
      name: subjectNames[s.id].name,
      ...cards[s.id],
      ...(sections[s.id].secLabel && { secLabel: sections[s.id].secLabel }),
      topics: tps.filter(t => t.subject === s.id).map(t => ({ id: t.id, title: t.title, ...(t.badge && { badge: t.badge }), nav: navLabel[t.id] })),
      chapters: sections[s.id].chapters,
      navGroups: navGroups[s.id],
    })),
  })),
};

// ── 主題自動推測（備援）：字元 bigram TF-IDF 餘弦相似度 ──────
const bigrams = t => { const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
const df = new Map();
for (const t of tps) { t.grams = bigrams(t.text); for (const g of t.grams.keys()) df.set(g, (df.get(g) || 0) + 1); }
const idf = g => Math.log((tps.length + 1) / ((df.get(g) || 0) + 1)) + 1;
const toVec = grams => { const v = new Map(); let n = 0; for (const [g, c] of grams) { const w = (1 + Math.log(c)) * idf(g); v.set(g, w); n += w * w; } return { v, n: Math.sqrt(n) }; };
for (const t of tps) t.vec = toVec(t.grams);
const cosine = (a, b) => { let s = 0; for (const [g, w] of a.v) { const x = b.v.get(g); if (x) s += w * x; } return s / (a.n * b.n || 1); };
const guessTopic = (text, level) => {
  const v = toVec(bigrams(normHtml(text)));
  return tps.filter(t => t.level === level).map(t => ({ id: t.id, s: cosine(v, t.vec) })).sort((a, b) => b.s - a.s)[0].id;
};
const assignments = fs.existsSync(ASSIGNMENTS) ? JSON.parse(fs.readFileSync(ASSIGNMENTS, 'utf8')) : { assign: {}, unsure: {} };

// ── 官方試題：切成單題（含標準答案與原文題幹）───────────────
const manifest = JSON.parse(fs.readFileSync(path.join(PDFTEXT, 'manifest.json'), 'utf8'));
const PAPER_SUBJECT = { basic: { 第一科: 'bs1', 第二科: 'bs2' }, inter: { 第一科: 's1', 第二科: 's2', 第三科: 's3' } };
// 每頁頁首：試卷名稱／科目／考試日期／頁碼／「答案 題目」欄名（有時拆成多行）
const PAGE_HEADER = [/公告試題/, /^第.科:/, /^考試日期/, /^第\s*\d+\s*頁,共\s*\d+\s*頁/, /^(答\s*案?|案|題\s*目|答\s*案\s*題\s*目|一、選擇題)\s*$/];
const isHeader = line => PAGE_HEADER.some(re => re.test(line.normalize('NFKC').trim()));
const officialQs = [];
for (const d of manifest.filter(d => d.kind === 'official')) {
  const file = path.basename(d.src);
  const exam = file.match(/^(\d+-\d+)/)[1];
  const subject = PAPER_SUBJECT[d.level][file.match(/第.科/)[0]];
  const text = fs.readFileSync(path.join(PDFTEXT, d.file), 'utf8').split(/\r?\n/).filter(line => !isHeader(line)).join('\n');
  const marks = [...text.matchAll(/^([A-DＡ-Ｄ])\s+(\d{1,2})\.\s/gm)];
  for (const [k, m] of marks.entries()) {
    const raw = text.slice(m.index + m[0].length, marks[k + 1]?.index ?? text.length);
    const t = normText(raw);
    const set = new Set(); for (let i = 0; i + N <= t.length; i++) set.add(t.slice(i, i + N));
    const stemText = tidy(raw.split(/[(（]A[)）]/)[0].replace(/\s*\n\s*/g, ' '));
    officialQs.push({ level: d.level, exam, subject, no: +m[2], ans: m[1].normalize('NFKC'), stemText, stem: normText(stemText), norm: t, head: stemText.slice(0, 50), set, used: [] });
  }
}
// 「只比題幹」與「題幹＋選項」取較高者：官方卷的程式碼／附圖是圖片抽不出字，只比題幹會誤配；
// 但舊版有時在選項後補註解，只比題幹＋選項又會拉低分數。
// 平手時（例如被截斷的短題幹同時出現在兩題中）以「題幹＋選項」覆蓋率決勝。
function coverage(t, set) {
  let hit = 0, n = 0;
  for (let i = 0; i + N <= t.length; i++) { n++; if (set.has(t.slice(i, i + N))) hit++; }
  return n ? hit / n : 0;
}
function bestOfficial(q, level) {
  const stem = normText(stripTags(q.q));
  const full = normText(stripTags(q.q + ' ' + q.opts.join(' ')));
  let best = null;
  for (const o of officialQs.filter(o => o.level === level)) {
    const fullCov = coverage(full, o.set);
    const cov = Math.max(coverage(stem, o.set), fullCov);
    if (!best || cov > best.cov || (cov === best.cov && fullCov > best.fullCov)) best = { o, cov, fullCov };
  }
  return best;
}
// 舊版題幹開頭出現在官方題幹「中間」→ 開頭被截掉，回傳官方原文中缺少的前綴；
// 完全找不到則是刻意改寫過的題目，不處理
function missingPrefix(qText, o) {
  const head = normText(qText).slice(0, 8);
  const k = o.stem.indexOf(head);
  if (k <= 0) return null;
  // 把正規化後的位置對回原文位置；接縫處被正規化刪掉的標點／空白／連字號要保留在前綴裡
  let seen = 0, i = 0;
  for (; i < o.stemText.length && seen < k; i++) seen += normText(o.stemText[i]).length;
  while (i < o.stemText.length && normText(o.stemText[i]) === '') i++;
  let prefix = o.stemText.slice(0, i);
  // 舊版題幹開頭若本身就有這些標點（例如「（Categorical」），從前綴末尾扣掉避免重複
  const lead = qText.trimStart().match(/^[^\p{L}\p{N}]*/u)[0].replace(/\s/g, '');
  if (lead && prefix.replace(/\s+$/, '').endsWith(lead)) prefix = prefix.replace(/\s+$/, '').slice(0, -lead.length);
  // 前後都是英數字時補一個空白（PDF 換行處的空白已被 tidy 以外的步驟吃掉）
  if (/[A-Za-z0-9]$/.test(prefix) && /^[A-Za-z0-9]/.test(qText.trimStart())) prefix += ' ';
  return prefix;
}

// 舊版把下一題題幹的第一行誤黏在本題最後一個選項尾端：找出尾端恰為某官方題幹開頭、
// 且不在本題官方原文中的部分，回傳切除後的選項
function stripLeak(opt, level, own) {
  const n = normText(opt);
  const stems = officialQs.filter(o => o.level === level).map(o => o.stem);
  for (let p = 1; p <= n.length - 6; p++) {
    const tail = n.slice(p);
    if (own?.norm.includes(tail) || !stems.some(s => s.startsWith(tail))) continue;
    // 正規化位置 p 對回原文位置；緊接的右括號／右引號屬於選項本身
    let seen = 0, i = 0;
    for (; i < opt.length && seen < p; i++) seen += normText(opt[i]).length;
    while (i > 0 && /\s/.test(opt[i - 1])) i--;
    const closers = opt.slice(i).match(/^\s*[)）」』】\]]+/);
    if (closers) i += closers[0].length;
    return { kept: opt.slice(0, i).trimEnd(), leaked: opt.slice(i).trim() };
  }
  return null;
}

// ── 轉換題目 ─────────────────────────────────────────────────
const LETTERS = ['A', 'B', 'C', 'D'];
const quizBySubject = {};
const review = { lowSource: [], ansMismatch: [], sharedOfficial: [], repaired: [], leaks: [], optJunk: [], guessed: [] };
let qn = 0;
for (const level of ['basic', 'inter']) {
  for (const [idx, q] of QUIZ_BANK[level].entries()) {
    const id = `${PREFIX}-q-${String(++qn).padStart(4, '0')}`;
    const m = bestOfficial(q, level);
    const isOfficial = m.cov >= OFFICIAL_MIN;
    const ctx = { id, legacy: `${level}#${idx + 1}` };
    const ref = `${m.o.exam} ${m.o.subject} 第${m.o.no}題`;

    // 題幹修復：清掉欄名雜訊、補回被截掉的開頭、清理空白；選項（非程式碼）與詳解只清理空白
    let stem = q.q.replace(LEGACY_JUNK, ' ');
    const fixes = [];
    if (stem !== q.q) fixes.push('移除頁首雜訊');
    const prefix = isOfficial && m.cov >= OFFICIAL_SURE ? missingPrefix(stem, m.o) : null;
    if (prefix) { stem = prefix + stem.trimStart(); fixes.push('補回開頭'); }
    stem = tidy(stem);
    if (fixes.length) review.repaired.push({ ...ctx, ref, fixes: fixes.join('、'), before: q.q, after: stem });
    const opts = q.opts.map((o, k) => {
      if (q.codeOpts) return o;
      const clean = o.replace(LEGACY_JUNK, ' ');
      if (clean !== o) review.optJunk.push(`${id}(${LETTERS[k]})`);
      const leak = k === q.opts.length - 1 ? stripLeak(clean, level, isOfficial ? m.o : null) : null;
      if (!leak) return tidy(clean);
      review.leaks.push({ ...ctx, option: LETTERS[k], after: tidy(leak.kept), leaked: leak.leaked });
      return tidy(leak.kept);
    });
    const fixed = { ...q, q: stem, opts, exp: tidy(q.exp.replace(LEGACY_JUNK, ' ')) };

    let topic = assignments.assign[id];
    if (!topic) { topic = guessTopic(fixed.q + ' ' + fixed.opts.join(' ') + ' ' + fixed.exp, level); review.guessed.push(id); }
    const subject = isOfficial ? m.o.subject : topicById[topic].subject;
    (quizBySubject[subject] ||= []).push({ id, topic, src: isOfficial ? 'official' : 'self', ...fixed });

    if (isOfficial) {
      m.o.used.push(id);
      if (m.cov < OFFICIAL_SURE) review.lowSource.push({ ...ctx, cov: m.cov, ref, head: stem.slice(0, 40), officialHead: m.o.head });
      if (LETTERS[q.ans] !== m.o.ans) review.ansMismatch.push({ ...ctx, cov: m.cov, ref, legacyAns: LETTERS[q.ans], officialAns: m.o.ans, head: stem.slice(0, 40) });
    } else {
      review.lowSource.push({ ...ctx, cov: m.cov, ref: '（判定為非官方）', head: stem.slice(0, 40), officialHead: m.o.head });
    }
  }
}
for (const o of officialQs) if (o.used.length > 1) review.sharedOfficial.push({ ref: `${o.exam} ${o.subject} 第${o.no}題`, ids: o.used });
const missingOfficial = officialQs.filter(o => o.used.length === 0);
const order = config.levels.flatMap(l => l.subjects.map(s => s.id));

// ── 輸出 ─────────────────────────────────────────────────────
const writeJSON = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const writeRecords = (file, items) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '[\n' + items.map(o => '  ' + JSON.stringify(o)).join(',\n') + '\n]\n');
};
writeJSON(path.join(CERT, 'config.json'), config);
for (const t of tps) {
  const file = path.join(CERT, 'notes', t.subject, `${t.id}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, notes[t.id]);
}
fs.writeFileSync(path.join(CERT, 'cheatsheet.html'), cheatsheet);
for (const s of order) if (quizBySubject[s]) writeRecords(path.join(CERT, 'quiz', `${s}.json`), quizBySubject[s]);

// ── 審閱報告 ─────────────────────────────────────────────────
const allItems = order.flatMap(s => quizBySubject[s] || []);
const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
const L = [];
L.push('# 資料轉換審閱清單', '', `產生時間：${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC（由 scripts/migrate-legacy.mjs 產生）`, '');
L.push('## 摘要', '');
L.push('| 項目 | 數量 |', '|---|---|');
for (const s of order) if (quizBySubject[s]) L.push(`| 題庫 ${s}（${subjectNames[s].name}） | ${quizBySubject[s].length} 題（official ${quizBySubject[s].filter(i => i.src === 'official').length}） |`);
L.push(`| 題幹已修復 | ${review.repaired.length} 題 |`, `| 主題由人工判讀 | ${allItems.length - review.guessed.length} 題 |`, `| 主題由程式推測 | ${review.guessed.length} 題 |`);
L.push(`| 官方試卷總題數 | ${officialQs.length} |`, `| 舊版未收錄的官方題 | ${missingOfficial.length} |`, '');

L.push('## 1. 答案與官方公告不一致', '');
if (!review.ansMismatch.length) L.push('無。', '');
else {
  L.push('| id | 對應官方題 | 覆蓋率 | 舊版答案 | 官方答案 | 題幹開頭 |', '|---|---|---|---|---|---|');
  for (const r of review.ansMismatch) L.push(`| ${r.id} | ${r.ref} | ${r.cov.toFixed(2)} | ${r.legacyAns} | ${r.officialAns} | ${esc(r.head)} |`);
  L.push('');
}
L.push('## 2. 來源判定需確認（題幹與官方試題文字差異較大，多為舊版改寫過的題目）', '');
L.push('| id | 最接近的官方題 | 覆蓋率 | 題幹開頭 | 官方題開頭 |', '|---|---|---|---|---|');
for (const r of review.lowSource) L.push(`| ${r.id} | ${r.ref} | ${r.cov.toFixed(2)} | ${esc(r.head)} | ${esc(r.officialHead)} |`);
L.push('');
if (review.sharedOfficial.length) {
  L.push('## 2b. 多題對應到同一官方題（可能重複收錄）', '');
  for (const r of review.sharedOfficial) L.push(`- ${r.ref}：${r.ids.join('、')}`);
  L.push('');
}
L.push('## 3. 題幹修復前後對照', '');
L.push('另外，所有題幹、選項（程式碼選項除外）與詳解都刪除了中文字之間的多餘空白，此處不逐一列出。', '');
for (const r of review.repaired) L.push(`### ${r.id}（${r.ref}，${r.fixes}）`, '', `- 修復前：${esc(r.before)}`, `- 修復後：${esc(r.after)}`, '');
L.push('## 3b. 選項尾端誤黏下一題題幹（已切除）', '');
if (!review.leaks.length) L.push('無。', '');
else {
  L.push('| id | 選項 | 切除後 | 被切除的文字 |', '|---|---|---|---|');
  for (const r of review.leaks) L.push(`| ${r.id} | ${r.option} | ${esc(r.after)} | ${esc(r.leaked)} |`);
  L.push('');
}
if (review.optJunk.length) L.push(`選項中移除「答案 題目」雜訊：${review.optJunk.join('、')}`, '');
L.push('## 4. 主題對應沒把握的題目', '');
const unsure = Object.entries(assignments.unsure || {});
if (!unsure.length && !review.guessed.length) L.push('無。', '');
else {
  L.push('| id | 題幹開頭 | 指定主題 | 備註 |', '|---|---|---|---|');
  for (const [id, note] of unsure) {
    const it = allItems.find(i => i.id === id);
    L.push(`| ${id} | ${esc(it.q.slice(0, 40))} | \`${it.topic}\` ${topicById[it.topic].title} | ${esc(note)} |`);
  }
  for (const id of review.guessed) {
    const it = allItems.find(i => i.id === id);
    L.push(`| ${id} | ${esc(it.q.slice(0, 40))} | \`${it.topic}\` ${topicById[it.topic].title} | 程式推測，未經人工判讀 |`);
  }
  L.push('');
}
L.push('## 5. 舊版未收錄的官方題', '');
L.push('| 試卷 | 題號 | 答案 | 題幹開頭 |', '|---|---|---|---|');
for (const o of missingOfficial) L.push(`| ${o.exam} ${o.subject} | ${o.no} | ${o.ans} | ${esc(o.head)} |`);
L.push('');
L.push('## 6. 各主題的題目', '');
for (const lv of config.levels) for (const s of lv.subjects) for (const t of s.topics) {
  const items = allItems.filter(i => i.topic === t.id);
  L.push(`### \`${t.id}\` ${t.title}（${lv.name}${s.label}，${items.length} 題）`, '');
  for (const i of items) L.push(`- ${i.id}［${i.id && Object.keys(quizBySubject).find(k => quizBySubject[k].includes(i))}］${esc(stripTags(i.q).slice(0, 50))}`);
  L.push('');
}
fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'reports', 'migration-review.md'), L.join('\n'));

console.log('quiz:', Object.fromEntries(order.map(s => [s, quizBySubject[s]?.length || 0])));
console.log('official papers questions:', officialQs.length, 'missing from legacy:', missingOfficial.length);
console.log('review — ansMismatch:', review.ansMismatch.length, 'lowSource:', review.lowSource.length, 'sharedOfficial:', review.sharedOfficial.length,
  'repaired:', review.repaired.length, 'leaks:', review.leaks.length, 'optJunk:', review.optJunk.length, 'guessedTopic:', review.guessed.length, 'unsureTopic:', unsure.length);
