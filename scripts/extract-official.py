"""把 materials 內的官方公告試題切成單題（題幹、選項、官方答案、附圖），供 import-official.mjs 匯入題庫。

輸出到 .cache/official/（已 gitignore）：
  questions.json            [{paper, exam, level, subjectNo, no, ans, stem, opts[4], images:[{file, at}]}]
                            at 為圖片所在位置：'stem' 或選項字母 'A'～'D'
  img/<exam>-<level>-<科>-<題號>-<序>.<ext>
需要 PyMuPDF（pip install pymupdf）。
"""
import glob
import hashlib
import json
import os
import re
import sys
from collections import Counter

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATERIALS = os.path.join(ROOT, "materials", "ai-planner")
OUT = os.path.join(ROOT, ".cache", "official")
SUBJECT_NO = {"第一科": 1, "第二科": 2, "第三科": 3}

HEADER = [re.compile(p) for p in [r"公告試題", r"^第.科[:：]", r"^考試日期", r"^第\s*\d+\s*頁[,，]\s*共\s*\d+\s*頁",
                                  r"^(答\s*案?|案|題\s*目|答\s*案\s*題\s*目|一、\s*選擇題)$"]]
# 左側欄的題號行；舊版試卷會把答案字母、題號與題幹第一行放在同一行
# 部分兩位數題號在 PDF 中遺失句點（「10 下列…」），因此句點可省略，改以題號連續性過濾誤判
LEFT_MARK = re.compile(r"^(?:([A-DＡ-Ｄ])\s+)?(\d{1,2})(?:[.．]\s*|\s+|$)(.*)$")
GROUP = re.compile(r"請(?:根據|依據|依照).{0,8}?(上述|下方|以下|此)?.{0,8}?回答第\s*(\d+)\s*[~～至\-－]\s*(\d+)\s*題")
OPT_SPLIT = re.compile(r"(?=[(（][A-D][)）])")
OPT_HEAD = re.compile(r"^[(（]([A-D])[)）]\s*(.*)$", re.S)

sys.stdout.reconfigure(encoding="utf-8")
os.makedirs(os.path.join(OUT, "img"), exist_ok=True)


def fw(ch):
    """全形答案字母轉半形"""
    return chr(ord(ch) - 0xFEE0) if "Ａ" <= ch <= "Ｄ" else ch


def extract(path):
    name = os.path.basename(path)
    exam = re.match(r"(\d+-\d+)", name).group(1)
    level = "basic" if os.sep + "初級" + os.sep in path else "inter"
    subject_no = SUBJECT_NO[re.search(r"第.科", name).group(0)]
    doc = pymupdf.open(path)

    # 多頁重複出現的圖片（浮水印、頁首 logo）不是題目附圖；同一張浮水印在不同頁可能是不同物件，
    # 所以以圖片內容的雜湊判斷
    digest_of, digest_pages = {}, Counter()
    for page in doc:
        seen = set()
        for xref in {img[0] for img in page.get_images(full=True)}:
            if xref not in digest_of:
                digest_of[xref] = hashlib.md5(doc.extract_image(xref)["image"]).hexdigest()
            seen.add(digest_of[xref])
        digest_pages.update(seen)
    decor = {x for x, d in digest_of.items() if digest_pages[d] >= 2}

    # 版面：左側欄為答案字母與題號，右側為題幹與選項。題幹第一行的 y 可能略高於題號，
    # 所以每題的起點設在題號上方 START_PAD，之後的內容行與圖片都歸屬到最近的題目。
    START_PAD = 12
    answers, markers, items = [], [], []  # items: (page, y, x, kind, payload)
    for pno, page in enumerate(doc):
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for ln in b["lines"]:
                text = "".join(s["text"] for s in ln["spans"]).strip()
                if not text or any(h.search(text) for h in HEADER):
                    continue
                x, y = ln["bbox"][0], ln["bbox"][1]
                if x < 110 and re.fullmatch(r"[A-DＡ-Ｄ]", text):
                    answers.append((pno, y, fw(text)))
                    continue
                m = LEFT_MARK.match(text) if x < 118 else None
                if m:
                    markers.append({"page": pno, "y": y, "x": x, "no": int(m.group(2)), "ans": fw(m.group(1)) if m.group(1) else None,
                                    "rest": m.group(3), "text": text})
                    continue
                items.append((pno, y, x, "T", text))
        for info in page.get_image_info(xrefs=True):
            if info["xref"] and info["xref"] not in decor:
                items.append((pno, info["bbox"][1], info["bbox"][0], "I", info["xref"]))
    # 題號必須 1, 2, 3… 連續出現，且同一行或左側欄旁有答案字母；
    # 其餘（程式碼行號、清單編號、剛好從行首開始的數字）退回為一般內容
    # 左側欄的答案字母只配給同頁垂直距離最近的一個候選題號（題幹次行剛好以數字開頭時也不會搶到）
    for pno, ay, letter in answers:
        cands = [mk for mk in markers if mk["page"] == pno and mk["ans"] is None and abs(mk["y"] - ay) < 16]
        if cands:
            min(cands, key=lambda mk: abs(mk["y"] - ay))["ans"] = letter
    markers.sort(key=lambda mk: (mk["page"], mk["y"]))
    accepted = []
    for mk in markers:
        if mk["no"] == len(accepted) + 1 and mk["ans"]:
            accepted.append(mk)
            if mk["rest"]:
                items.append((mk["page"], mk["y"], mk["x"], "T", mk["rest"]))
        else:
            items.append((mk["page"], mk["y"], mk["x"], "T", mk["text"]))
    markers = accepted
    starts = sorted(((mk["page"], mk["y"] - START_PAD), i) for i, mk in enumerate(markers))
    items.sort(key=lambda t: (t[0], t[1], t[2]))

    questions = [{"exam": exam, "level": level, "subjectNo": subject_no, "no": mk["no"], "ans": mk["ans"],
                  "stem": "", "opts": ["", "", "", ""], "images": [], "paper": name} for mk in markers]

    def save_image(xref, stem_name):
        img = doc.extract_image(xref)
        fname = f"{stem_name}.{img['ext']}"
        with open(os.path.join(OUT, "img", fname), "wb") as f:
            f.write(img["image"])
        return {"file": fname, "w": img["width"], "h": img["height"]}

    # 題組：「請根據下方資訊回答第 X～Y 題」之後到下一題之前的文字與圖片，為第 X～Y 題共用的情境。
    # 「上述」型說明的情境在這句之前，無法自動判斷範圍，只記錄題號範圍供人工處理。
    cur, part, si, ctx = None, None, -1, None
    for pno, y, x, kind, payload in items:
        while si + 1 < len(starts) and starts[si + 1][0] <= (pno, y):
            si += 1
            cur, part = questions[starts[si][1]], "stem"
            if ctx and ctx["from"] <= cur["no"] <= ctx["to"]:
                cur["group"] = ctx
            if ctx and cur["no"] >= ctx["from"]:
                ctx["collecting"] = False
        if cur is None:
            continue
        if kind == "T":
            g = GROUP.search(payload)
            if g:
                ctx = {"from": int(g.group(2)), "to": int(g.group(3)), "above": g.group(1) == "上述", "note": payload,
                       "text": "", "images": [], "collecting": True}
                continue
            if ctx and ctx["collecting"]:
                ctx["text"] += payload + "\n"
                continue
            for seg in OPT_SPLIT.split(payload):
                if not seg:
                    continue
                o = OPT_HEAD.match(seg)
                if o:
                    part = o.group(1)
                    seg = o.group(2)
                if part == "stem":
                    cur["stem"] += seg + "\n"
                else:
                    cur["opts"]["ABCD".index(part)] += seg + "\n"
        elif ctx and ctx["collecting"]:
            ctx["images"].append(save_image(payload, f"{exam}-{level}-{subject_no}-g{ctx['from']:02d}-{len(ctx['images']) + 1}"))
        else:
            info = save_image(payload, f"{exam}-{level}-{subject_no}-{cur['no']:02d}-{len(cur['images']) + 1}")
            cur["images"].append({**info, "at": part})
    for q in questions:
        if "group" in q:
            q["group"] = {k: v for k, v in q["group"].items() if k != "collecting"}
    return questions


papers = sorted(glob.glob(os.path.join(MATERIALS, "*", "歷屆試題", "*.pdf")))
allq = []
for p in papers:
    qs = extract(p)
    nums = [q["no"] for q in qs]
    print(f"{os.path.basename(p)}: {len(qs)} 題，附圖 {sum(len(q['images']) for q in qs)} 張"
          + ("" if nums == list(range(1, len(nums) + 1)) else f"  ⚠ 題號不連續：{nums}"))
    allq += qs
with open(os.path.join(OUT, "questions.json"), "w", encoding="utf-8") as f:
    json.dump(allq, f, ensure_ascii=False, indent=1)
