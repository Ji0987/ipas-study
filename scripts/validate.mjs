// 驗證 certs/*/ 的 config 與題庫。有錯誤時以 exit code 1 結束，build 前強制執行。
// 用法：node scripts/validate.mjs [證照 id ...]（不指定則驗證全部）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEAR_DUP = 0.85;   // 題幹＋選項 bigram Jaccard 相似度達此值視為近似重複（警告）
const LEGACY_JUNK = /答\s*案\s*題\s*目|第\s*\d+\s*頁\s*[,，]\s*共|公告試題/;

const ajv = new Ajv({ allErrors: true });
const schema = name => ajv.compile(JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', `${name}.schema.json`), 'utf8')));
const validators = { config: schema('config'), quiz: schema('quiz') };

const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const listJSON = dir => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [];
const norm = t => t.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
const bigramSet = t => { const s = new Set(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; };
const jaccard = (a, b) => { let n = 0; for (const g of a) if (b.has(g)) n++; return n / (a.size + b.size - n || 1); };

function validateCert(certDir) {
  const errors = [], warnings = [];
  const rel = f => path.relative(ROOT, f).replaceAll('\\', '/');
  const schemaErrors = (file, validate, data) => {
    if (validate(data)) return true;
    for (const e of validate.errors.slice(0, 20)) errors.push(`${rel(file)}${e.instancePath} ${e.message}`);
    return false;
  };

  const configFile = path.join(certDir, 'config.json');
  const config = readJSON(configFile);
  if (!schemaErrors(configFile, validators.config, config)) return { errors, warnings };

  // 主題索引：topic id → { level, subject }
  const topics = new Map(), subjects = new Map();
  for (const level of config.levels) for (const subject of level.subjects) {
    subjects.set(subject.id, level.id);
    for (const t of subject.topics) {
      if (topics.has(t.id)) errors.push(`config.json 主題 id 重複：${t.id}`);
      topics.set(t.id, { level: level.id, subject: subject.id });
    }
    // 內文章節與側欄導覽分組各自必須剛好涵蓋本科目每個主題一次
    const own = subject.topics.map(t => t.id).sort().join();
    for (const key of ['chapters', 'navGroups']) {
      if (subject[key].flatMap(g => g.topics).sort().join() !== own) errors.push(`config.json ${subject.id}.${key} 未剛好涵蓋本科目所有主題`);
    }
  }
  for (const id of config.site.defaultOpen) if (!topics.has(id)) errors.push(`config.json site.defaultOpen 的主題不存在：${id}`);
  const ids = new Map();
  const quizItems = [];
  for (const f of listJSON(path.join(certDir, 'quiz'))) {
    const file = path.join(certDir, 'quiz', f), subject = path.basename(f, '.json');
    if (!subjects.has(subject)) { errors.push(`${rel(file)} 檔名不是 config 中的科目 id`); continue; }
    const items = readJSON(file);
    if (!schemaErrors(file, validators.quiz, items)) continue;
    const level = subjects.get(subject);
    for (const q of items) {
      if (ids.has(q.id)) errors.push(`${rel(file)} id 重複：${q.id}（亦見於 ${ids.get(q.id)}）`);
      ids.set(q.id, rel(file));
      if (!q.id.startsWith(`${config.idPrefix}-q-`)) errors.push(`${rel(file)} ${q.id} 前綴應為 ${config.idPrefix}-q-`);
      // 主題可跨科目（詳解連回最相關的筆記段落），但必須同級別
      const t = topics.get(q.topic);
      if (!t) errors.push(`${rel(file)} ${q.id} 的 topic 不存在：${q.topic}`);
      else if (t.level !== level) errors.push(`${rel(file)} ${q.id} 的 topic ${q.topic} 屬於 ${t.level}，不是 ${level}`);
      if (q.ans >= q.opts.length) errors.push(`${rel(file)} ${q.id} 的 ans 超出選項範圍`);
      if (LEGACY_JUNK.test(q.q + q.opts.join('') + q.exp)) warnings.push(`${rel(file)} ${q.id} 含試卷頁首雜訊`);
      quizItems.push({ file, q, key: norm(q.q), grams: bigramSet(norm(q.q + q.opts.join(''))) });
    }
  }

  // 重複與近似重複
  for (let i = 0; i < quizItems.length; i++) for (let j = i + 1; j < quizItems.length; j++) {
    const a = quizItems[i], b = quizItems[j];
    if (a.key === b.key) errors.push(`題幹完全相同：${a.q.id}、${b.q.id}`);
    else {
      const s = jaccard(a.grams, b.grams);
      if (s >= NEAR_DUP) warnings.push(`近似重複（${s.toFixed(2)}）：${a.q.id}、${b.q.id}`);
    }
  }

  // 筆記：notes/ 建立後，每個主題都要有對應片段
  const notesDir = path.join(certDir, 'notes');
  if (fs.existsSync(notesDir)) {
    for (const [id, t] of topics) if (!fs.existsSync(path.join(notesDir, t.subject, `${id}.html`))) errors.push(`缺少筆記片段：notes/${t.subject}/${id}.html`);
  }

  console.log(`${config.id}：題目 ${quizItems.length}、主題 ${topics.size}`);
  return { errors, warnings };
}

const certsDir = path.join(ROOT, 'certs');
const only = process.argv.slice(2);
let failed = false;
for (const id of fs.readdirSync(certsDir).filter(d => !only.length || only.includes(d))) {
  const { errors, warnings } = validateCert(path.join(certsDir, id));
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  if (errors.length) failed = true;
  console.log(`  → 錯誤 ${errors.length}、警告 ${warnings.length}`);
}
process.exit(failed ? 1 : 0);
