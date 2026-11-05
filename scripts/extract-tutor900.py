"""把「輔考小老師」900 題 PDF 解析成 JSON，給 make-exams.mjs 出模擬卷。

非官方題庫、著作權屬原作者，輸出只放 .cache/，不進版控。

用法：python scripts/extract-tutor900.py
輸出：.cache/exams/ai-planner-tutor900.json
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / 'materials' / 'ai-planner'
OUT = ROOT / '.cache' / 'exams' / 'ai-planner-tutor900.json'

# 分段標題 → (檔名前綴, 卷頭副標)
SECTIONS = {
    '一': ('L11', 'L11 人工智慧基礎概論'),
    '二': ('L12', 'L12 生成式 AI 應用與規劃'),
    '三': ('混合', '混合題型（難、中、易）'),
}

RE_SECTION = re.compile(r'^([一二三])、')
RE_Q = re.compile(r'^Q(\d+)[.．]\s*(.*)')
RE_OPT = re.compile(r'^([A-D])[.．]\s*(.*)')
RE_ANS = re.compile(r'^(?:✅\s*)?正確答案\s*[:：]\s*([A-D])')
RE_SKIP = re.compile(r'^(iPAS A應用規劃師模擬練習題庫|\d+|探索更多.*)$')


def join(a, b):
    """接回 PDF 折行：兩邊都是英數字時補空白，中文直接相接。"""
    if a and b and re.match(r'[A-Za-z0-9]', a[-1]) and re.match(r'[A-Za-z0-9]', b[0]):
        return a + ' ' + b
    return a + b


def parse(pdf):
    sections, q, mode = [], None, None
    for raw in '\n'.join(p.get_text() for p in pymupdf.open(pdf)).split('\n'):
        s = raw.strip()
        if not s or RE_SKIP.match(s):
            continue
        if m := RE_SECTION.match(s):
            name, subtitle = SECTIONS[m.group(1)]
            sections.append({'name': name, 'subtitle': subtitle, 'questions': []})
            q, mode = None, None
        elif m := RE_Q.match(s):
            q = {'n': int(m.group(1)), 'q': m.group(2), 'opts': []}
            sections[-1]['questions'].append(q)
            mode = 'stem'
        elif q and mode in ('stem', 'opt') and (m := RE_OPT.match(s)):
            q['opts'].append(m.group(2))
            mode = 'opt'
        elif q and (m := RE_ANS.match(s)):
            q['ans'] = 'ABCD'.index(m.group(1))
            mode = 'exp'
        elif s.startswith('解析'):
            mode = 'exp'
        elif mode == 'stem':
            q['q'] = join(q['q'], s)
        elif mode == 'opt':
            q['opts'][-1] = join(q['opts'][-1], s)
    return sections


def check(sections):
    errs = []
    if [s['name'] for s in sections] != [v[0] for v in SECTIONS.values()]:
        errs.append(f'分段不符：{[s["name"] for s in sections]}')
    for s in sections:
        nums = [q['n'] for q in s['questions']]
        if nums != list(range(nums[0], nums[0] + len(nums))):  # L12 接續 L11 編號 301 起
            errs.append(f'{s["name"]} 題號不連續')
        for q in s['questions']:
            if len(q['opts']) != 4 or 'ans' not in q or not q['q']:
                errs.append(f'{s["name"]} Q{q["n"]} 缺題幹、選項或答案')
    return errs


def main():
    pdf = next(SRC_DIR.rglob('*900題.pdf'))
    sections = parse(pdf)
    if errs := check(sections):
        sys.exit('\n'.join(errs))
    for s in sections:
        s['start'] = s['questions'][0]['n']
        for q in s['questions']:
            del q['n']
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        'cert': 'ai-planner',
        'level': 'basic',
        'outDir': '模擬卷-輔考小老師',
        'sections': sections,
    }, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}：' + '、'.join(f'{s["name"]} {len(s["questions"])} 題' for s in sections))


if __name__ == '__main__':
    main()
