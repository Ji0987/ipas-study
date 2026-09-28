"""抽取 materials/ai-planner 內官方公告試題與學習指引的全文，供 migrate-legacy.mjs 比對題目來源。

輸出到 .cache/pdftext/（已 gitignore）：每份 PDF 一個 .txt，另附 manifest.json。
需要 pypdf。
"""
import glob
import json
import os
import sys

from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MATERIALS = os.path.join(ROOT, "materials", "ai-planner")
OUT = os.path.join(ROOT, ".cache", "pdftext")
KINDS = {"歷屆試題": "official", "學習資源": "guide"}

sys.stdout.reconfigure(encoding="utf-8")
os.makedirs(OUT, exist_ok=True)
manifest = []
for path in sorted(glob.glob(os.path.join(MATERIALS, "*", "*", "*.pdf"))):
    kind = KINDS.get(os.path.basename(os.path.dirname(path)))
    if not kind or "勘誤" in path:
        continue
    level = "basic" if os.sep + "初級" + os.sep in path else "inter"
    text = "\n".join((page.extract_text() or "") for page in PdfReader(path).pages)
    name = f"{kind}_{level}_{len(manifest):02d}.txt"
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(text)
    manifest.append({"file": name, "kind": kind, "level": level, "src": os.path.relpath(path, MATERIALS)})
    print(name, len(text), os.path.relpath(path, MATERIALS))

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
