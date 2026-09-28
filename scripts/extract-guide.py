"""把官方學習指引各節末的練習題（題目、選項、答案、官方解析）抽成 JSON，供 import-guide.mjs 匯入題庫。

用法：python scripts/extract-guide.py aiot
輸出：.cache/guide/<證照>/questions.json  [{section, no, stem, opts[4], ans, exp}]
學習指引的版面：每節末先列題目（1. … (A)～(D)），下一頁起為「1. Ans（B）」加逐選項解析。
需要 PyMuPDF（pip install pymupdf）。
"""
import json
import os
import re
import sys

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT = sys.argv[1] if len(sys.argv) > 1 else "aiot"
GUIDES = {
    # 各節依序對應的評鑑內容（學習指引 3-1、3-2、4-1～4-5、5-1、5-2）
    "aiot": (os.path.join(ROOT, "materials", "aiot", "科目1_AIoT基礎概論.pdf"),
             ["3-1", "3-2", "4-1", "4-2", "4-3", "4-4", "4-5", "5-1", "5-2"]),
}
PDF, SECTIONS = GUIDES[CERT]
OUT = os.path.join(ROOT, ".cache", "guide", CERT)
os.makedirs(OUT, exist_ok=True)
sys.stdout.reconfigure(encoding="utf-8")

# 頁首（章名）、頁碼（3-14）與空行不是內容；私用區字元是符號字型的裝飾與項目符號
NOISE = re.compile(r"^\s*(第.章\s.*|\d-\d+|附錄.*|A-\d+)?\s*$")
PUA = re.compile("[-]")
PAGE = "\f"  # 分頁標記，用來判斷每節最後一題解析的結尾
lines = []
for page in pymupdf.open(PDF):
    lines.append(PAGE)
    for ln in page.get_text().split("\n"):
        ln = PUA.sub("", ln)
        if not NOISE.match(ln):
            lines.append(ln.strip())
text = "\n".join(lines)

ANS = re.compile(r"^(\d+)\.\s*Ans\s*[（(]\s*([A-D])\s*[）)]\s*$", re.M)
QNUM = lambda k: re.compile(rf"^{k}\.\s*(?!Ans)", re.M)
OPT = re.compile(r"^\(([A-D])\)\s*", re.M)

# 答案區塊：編號從 1 連續遞增的一串 Ans
blocks, cur = [], []
for m in ANS.finditer(text):
    n = int(m.group(1))
    if n == 1 and cur:
        blocks.append(cur)
        cur = []
    cur.append(m)
if cur:
    blocks.append(cur)
if len(blocks) != len(SECTIONS):
    sys.exit(f"答案區塊 {len(blocks)} 個，與節數 {len(SECTIONS)} 不符")

out = []
prev_end = 0
for section, answers in zip(SECTIONS, blocks):
    n = len(answers)
    start = answers[0].start()
    # 題目區塊：答案區塊之前，最後一個「1.」且其後依序有 2.～n. 題、每題含 (A)
    region = text[prev_end:start]
    q_start = None
    for m in reversed(list(QNUM(1).finditer(region))):
        seg = region[m.start():]
        if all(QNUM(k).search(seg) for k in range(2, n + 1)) and "(A)" in seg[:seg.find("\n2.") if n > 1 else None]:
            q_start = m.start()
            break
    if q_start is None:
        sys.exit(f"{section} 找不到題目區塊")
    qtext = region[q_start:]
    bounds = []
    pos = 0
    for k in range(1, n + 1):
        m = QNUM(k).search(qtext, pos)
        bounds.append(m.start())
        pos = m.end()
    bounds.append(len(qtext))
    for k in range(n):
        body = QNUM(k + 1).sub("", qtext[bounds[k]:bounds[k + 1]], count=1)
        parts = OPT.split(body)
        stem, opts = parts[0], {parts[i]: parts[i + 1] for i in range(1, len(parts) - 1, 2)}
        # 解析：本題 Ans 到下一題 Ans；每節最後一題到「下一頁不是以選項解析 (A)～(D) 開頭」的分頁處（新的一節從新頁開始）
        a = answers[k]
        if k + 1 < n:
            end = answers[k + 1].start()
        else:
            rest = text[a.end():]
            end = a.end() + next((p.start() for p in re.finditer(PAGE, rest) if not re.match(r"\n\([A-D]\)", rest[p.end():])), len(rest))
        clean = lambda s: s.replace(PAGE, "").strip()
        out.append({"section": section, "no": k + 1, "stem": clean(stem),
                    "opts": [clean(opts.get(L, "")) for L in "ABCD"], "ans": a.group(2),
                    "exp": clean(text[a.end():end])})
    prev_end = answers[-1].end()
    print(f"{section}: {n} 題")

with open(os.path.join(OUT, "questions.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"共 {len(out)} 題")
