// 內嵌於頁面的證照設定、常用查詢表，以及題庫的非同步載入
const DATA = JSON.parse(document.getElementById('ipas-data').textContent);

export const config = DATA.config;
export const levels = config.levels;

export const subjectById = {};
export const levelOfSubject = {};
export const subjectOfTopic = {};
export const topicById = {};
/** 主題 → 所屬章節 key（科目 id:章節序號）；章節對應官方成績單的「評鑑主題」 */
export const chapterOfTopic = {};
for (const level of levels) for (const subject of level.subjects) {
  subjectById[subject.id] = subject;
  levelOfSubject[subject.id] = level;
  for (const t of subject.topics) { subjectOfTopic[t.id] = subject.id; topicById[t.id] = t; }
  subject.chapters.forEach((ch, i) => { for (const id of ch.topics) chapterOfTopic[id] = `${subject.id}:${i}`; });
}
/** 各級別中科目最多的數量，決定進度環個數 */
export const maxSubjects = Math.max(...levels.map(l => l.subjects.length));

let quizPromise = null;
/**
 * 載入題庫（只載一次）：回傳 { 級別 id: 題目陣列 }，各級別為所屬科目檔合併後依 id 排序（即舊版原始順序）。
 * 題庫檔與頁面同目錄的 quiz/<科目>.json，需透過網址開啟頁面才能載入。
 */
export function loadQuiz() {
  quizPromise ||= Promise.all(levels.map(async l => {
    const files = DATA.quizFiles[l.id];
    const parts = await Promise.all(files.map(async s => {
      const res = await fetch(`quiz/${s}.json`);
      if (!res.ok) throw new Error(`quiz/${s}.json ${res.status}`);
      // sub：題目所屬的科目檔（即出自哪一科的試卷），供統計使用；topic 可能跨科目
      return (await res.json()).map(q => ({ ...q, sub: s }));
    }));
    return [l.id, parts.flat().sort((a, b) => a.id.localeCompare(b.id))];
  })).then(Object.fromEntries);
  return quizPromise;
}
