// 作答紀錄與錯題本：錯題＝最近一次作答答錯的題目，之後答對即移出
import { state, save } from './store.js';

/** 記錄一次作答；紀錄格式 { right, wrong, last: 'right'|'wrong', at } */
export function recordAnswer(id, correct) {
  const r = state.answers[id] ||= { right: 0, wrong: 0, last: null, at: 0 };
  r[correct ? 'right' : 'wrong']++;
  r.last = correct ? 'right' : 'wrong';
  r.at = Date.now();
  save();
}
export const isWrong = id => state.answers[id]?.last === 'wrong';
export const wrongIn = pool => pool.filter(q => isWrong(q.id));
