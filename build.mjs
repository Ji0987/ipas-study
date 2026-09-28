// 建置：產出可部署的多檔網站
//   dist/assets/app-<hash>.js、styles-<hash>.css  所有證照共用的引擎（檔名帶內容雜湊，更新後不會吃到舊快取）
//   dist/<證照>/index.html                        頁面標記（含筆記），證照設定內嵌
//   dist/<證照>/quiz/<科目>.json                   題庫，執行時載入
//   dist/index.html                               網站首頁（證照列表）
// 用法：node build.mjs；npm run build 會先執行驗證。需透過網址（GitHub Pages 或本機伺服器）開啟。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as render from './engine/render.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJSON = f => JSON.parse(read(f));
const write = (rel, content) => {
  const out = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, content);
  return rel;
};
const hashed = (name, ext, content) => `assets/${name}-${crypto.createHash('sha256').update(content).digest('hex').slice(0, 8)}.${ext}`;

fs.rmSync(DIST, { recursive: true, force: true });

// ── 共用引擎 ───────────────────────────────────────────────
const { outputFiles: [bundle] } = await esbuild.build({
  entryPoints: [path.join(ROOT, 'engine/js/main.js')],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false, charset: 'utf8',
});
const styles = read('engine/styles.css');
const scriptPath = write(hashed('app', 'js', bundle.text), bundle.text);
const stylesPath = write(hashed('styles', 'css', styles), styles);

// ── 各證照 ─────────────────────────────────────────────────
const fill = (tpl, slots) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
  if (!(k in slots)) throw new Error(`模板插槽沒有對應內容：${k}`);
  return slots[k];
});
const template = read('engine/template.html');
const configs = [];
for (const id of fs.readdirSync(path.join(ROOT, 'certs'))) {
  const dir = `certs/${id}`;
  const config = readJSON(`${dir}/config.json`);
  configs.push(config);
  const notes = {};
  for (const s of config.levels.flatMap(l => l.subjects)) for (const t of s.topics) notes[t.id] = read(`${dir}/notes/${s.id}/${t.id}.html`);

  // 題庫原樣複製（壓縮成一行）；頁面只需知道各級別有哪些科目檔
  const quizFiles = {};
  const topicCounts = {};
  let questions = 0;
  for (const l of config.levels) {
    quizFiles[l.id] = [];
    for (const s of l.subjects) {
      if (!fs.existsSync(path.join(ROOT, `${dir}/quiz/${s.id}.json`))) continue;
      const items = readJSON(`${dir}/quiz/${s.id}.json`);
      write(`${id}/quiz/${s.id}.json`, JSON.stringify(items));
      quizFiles[l.id].push(s.id);
      questions += items.length;
      for (const q of items) topicCounts[q.topic] = (topicCounts[q.topic] || 0) + 1;
    }
  }

  // 題目附圖
  if (fs.existsSync(path.join(ROOT, dir, 'img'))) fs.cpSync(path.join(ROOT, dir, 'img'), path.join(DIST, id, 'img'), { recursive: true });

  const first = config.levels[0];
  const slots = {
    bodyClass: config.levels.length === 1 ? ' class="single-level"' : '',
    title: render.esc(config.site.title),
    stylesHref: `../${stylesPath}`,
    mobTitle: render.esc(config.site.mobTitle),
    logo: render.esc(config.site.logo),
    firstLevelName: render.esc(first.name),
    logoSub: render.esc(config.site.logoSub),
    levelTabs: render.levelTabs(config),
    rings: render.rings(config),
    nav: render.nav(config),
    eyebrow: render.esc(config.site.eyebrow),
    heroTitle: render.esc(config.site.heroTitle),
    firstHeroTitleEm: render.esc(first.heroTitleEm),
    firstHeroSub: render.esc(first.heroSub),
    levelBadges: render.levelBadges(config),
    subjectCards: render.subjectCards(config),
    sections: render.sections(config, notes, topicCounts),
    cheatTitle: render.esc(config.cheatsheet.title),
    cheatSub: render.esc(config.cheatsheet.sub),
    cheatsheet: read(`${dir}/cheatsheet.html`),
    bankTabs: render.bankTabs(config),
    dashTabs: render.dashTabs(config),
    examTabs: render.examTabs(config),
    subjectKeys: render.subjectKeys(config),
    // 內嵌於 <script> 的 JSON 不可出現 </script
    data: JSON.stringify({ config, quizFiles }).replace(/</g, '\\u003c'),
    scriptSrc: `../${scriptPath}`,
  };
  const html = fill(template, slots);
  write(`${id}/index.html`, html);
  console.log(`${id} → dist/${id}/（頁面 ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB、題庫 ${questions} 題）`);
}

// ── 網站首頁：證照列表 ─────────────────────────────────────
write('index.html', fill(read('engine/landing.html'), { stylesHref: stylesPath, cards: render.certCards(configs) }));
console.log(`首頁 → dist/index.html（${configs.length} 張證照）`);
console.log(`共用引擎 → dist/${scriptPath}、dist/${stylesPath}`);
