// 進入點：初始化各模組、註冊鍵盤快捷鍵，並把 HTML inline 事件用到的函式掛到 window
import * as ui from './ui.js';
import { loadQuiz } from './data.js';
import * as layout from './layout.js';
import { buildIDX, initSearch } from './search.js';
import * as quiz from './quiz.js';
import * as bank from './bank.js';
import { openCmd, closeCmd, initCmd } from './cmd.js';
import { openBackup, exportProgress, importProgress } from './backup.js';
import { openDash, dashSetLevel } from './dash.js';
import * as exam from './exam.js';

Object.assign(window, {
  toggleSidebar: ui.toggleSidebar, closeSidebar: ui.closeSidebar, closeModal: ui.closeModal,
  openKeys: ui.openKeys, openCheat: ui.openCheat, copyFm: ui.copyFm,
  switchLevel: layout.switchLevel, switchSub: layout.switchSub, switchSubIndex: layout.switchSubIndex,
  toggleTP: layout.toggleTP, toggleAllTP: layout.toggleAllTP, markDone: layout.markDone,
  openQuiz: quiz.openQuiz, answerQz: quiz.answerQz, qzNext: quiz.qzNext, qzRestart: quiz.qzRestart, qzWrong: quiz.qzWrong,
  practiceTopic: quiz.practiceTopic, gotoNote: quiz.gotoNote,
  openBank: bank.openBank, bankSetLevel: bank.bankSetLevel, bankSetFilter: bank.bankSetFilter,
  bankSearchFn: bank.bankSearchFn, bankMark: bank.bankMark, bankPracticeWrong: bank.bankPracticeWrong,
  openCmd, closeCmd,
  openBackup, exportProgress, importProgress,
  openDash, dashSetLevel,
  openExamSetup: exam.openExamSetup, examSetLevel: exam.examSetLevel, startExam: exam.startExam,
  examPick: exam.examPick, examGo: exam.examGo, examMove: exam.examMove, examFlag: exam.examFlag,
  examSubmit: exam.examSubmit, examClose: exam.examClose, examReview: exam.examReview,
  examRetry: exam.examRetry, examOther: exam.examOther, examNote: exam.examNote,
});

/* ═══ KEYBOARD ═══ */
document.addEventListener('keydown', e => {
  const inInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  // 考試視窗開啟時只處理考試操作，避免數字鍵等全域快捷鍵切換頁面
  if (exam.examKey(e)) { e.preventDefault(); return; }
  if (e.key === 'Escape') {
    ['qz-overlay', 'keys-overlay', 'bk-overlay', 'cheat-overlay', 'backup-overlay', 'dash-overlay', 'exam-setup-overlay'].forEach(ui.closeModal); closeCmd(); ui.closeSidebar(); return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openCmd(); return; }
  if (inInput) return;
  if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); quiz.openQuiz(); }
  if (e.key === 'w' || e.key === 'W') { e.preventDefault(); quiz.openQuiz('wrong'); }
  if (e.key === 'e' || e.key === 'E') { e.preventDefault(); exam.openExamSetup(); }
  if (e.key === 'b' || e.key === 'B') { e.preventDefault(); bank.openBank(); }
  if (e.key === 'c' || e.key === 'C') { e.preventDefault(); ui.openCheat(); }
  if (e.key === 'd' || e.key === 'D') { e.preventDefault(); openDash(); }
  if (/^[1-9]$/.test(e.key)) layout.switchSubIndex(+e.key - 1);
});

/* ═══ INIT ═══ */
ui.initCanvas();
ui.initScrollProgress();
initSearch();
initCmd();
buildIDX();
layout.initLayout();
// 題庫在背景先載入，開啟測驗／題庫時不必等待；失敗時留待開啟時提示
loadQuiz().catch(() => {});
