// 建置：每張證照打包成一個自足的 dist/<證照>/index.html
// 用法：node build.mjs [證照 id ...]（不指定則建置全部）；npm run build 會先執行驗證
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as render from './engine/render.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJSON = f => JSON.parse(read(f));

const template = read('engine/template.html');
const styles = read('engine/styles.css').trimEnd();
const { outputFiles: [bundle] } = await esbuild.build({
  entryPoints: [path.join(ROOT, 'engine/js/main.js')],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false, charset: 'utf8',
});
// 內嵌於 <script> 內的內容不可出現 </script
const script = bundle.text.trimEnd().replace(/<\/script/gi, '<\\/script');

const only = process.argv.slice(2);
for (const id of fs.readdirSync(path.join(ROOT, 'certs')).filter(d => !only.length || only.includes(d))) {
  const dir = `certs/${id}`;
  const config = readJSON(`${dir}/config.json`);
  const notes = {};
  for (const s of config.levels.flatMap(l => l.subjects)) for (const t of s.topics) notes[t.id] = read(`${dir}/notes/${s.id}/${t.id}.html`);
  // 各級別題庫＝該級別所有科目檔合併後依 id 排序
  const quiz = {};
  for (const l of config.levels) {
    quiz[l.id] = l.subjects.flatMap(s => fs.existsSync(path.join(ROOT, `${dir}/quiz/${s.id}.json`)) ? readJSON(`${dir}/quiz/${s.id}.json`) : [])
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  const first = config.levels[0];
  const slots = {
    title: render.esc(config.site.title),
    styles,
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
    sections: render.sections(config, notes),
    cheatTitle: render.esc(config.cheatsheet.title),
    cheatSub: render.esc(config.cheatsheet.sub),
    cheatsheet: read(`${dir}/cheatsheet.html`),
    bankTabs: render.bankTabs(config),
    subjectKeys: render.subjectKeys(config),
    data: JSON.stringify({ config, quiz }).replace(/</g, '\\u003c'),
    script,
  };
  const html = template.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in slots)) throw new Error(`模板插槽沒有對應內容：${k}`);
    return slots[k];
  });
  const out = path.join(ROOT, 'dist', id, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`${id} → ${path.relative(ROOT, out)}（${(Buffer.byteLength(html) / 1024).toFixed(0)} KB）`);
}
