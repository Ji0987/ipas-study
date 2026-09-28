// 由 build 嵌入頁面的證照設定與題庫，以及常用的查詢表
const DATA = JSON.parse(document.getElementById('ipas-data').textContent);

export const config = DATA.config;
export const levels = config.levels;
/** 各級別題庫（依 id 排序，即舊版原始順序） */
export const quizBank = DATA.quiz;

export const subjectById = {};
export const levelOfSubject = {};
export const subjectOfTopic = {};
for (const level of levels) for (const subject of level.subjects) {
  subjectById[subject.id] = subject;
  levelOfSubject[subject.id] = level;
  for (const t of subject.topics) subjectOfTopic[t.id] = subject.id;
}
/** 各級別中科目最多的數量，決定進度環個數 */
export const maxSubjects = Math.max(...levels.map(l => l.subjects.length));
