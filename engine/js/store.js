// 學習進度：每張證照一筆帶版本號的物件，key 為 ipas:<證照 id>
import { config } from './data.js';

const KEY = `ipas:${config.id}`;
const VERSION = 1;
const blank = () => ({ version: VERSION, read: [], bookmarks: [] });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.version === VERSION) return { ...blank(), ...s };
  } catch (e) { /* 資料毀損或無法存取時從空白開始 */ }
  return blank();
}

export const state = load();
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 私密模式等無法寫入時忽略 */ }
}
