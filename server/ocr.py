"""OCR for the knowledge search: scanned PDF pages and pictures of documents.

    python ocr.py --file <x.pdf|x.png|x.jpg> [--pages 1,3,4] --out <result.json>

Writes {"pages": {"1": "text", ...}} (a picture is page 1), or {"error": "..."} when the
file cannot be read. The result goes to a file, written whole and then renamed, never to
stdout: Windows consoles mangle UTF-8 and kb-index.js may read it while a job runs.
Run by kb-index.js in the background, one file at a time, from the venv that
install-ocr.ps1 made (RapidOCR on ONNX Runtime, pypdfium2 for the pages).
"""
import argparse
import json
import os
import sys

DPI = 200
MIN_SCORE = 0.5


def lines_of(result):
    """RapidOCR boxes into reading order: rows top to bottom, left to right in a row."""
    boxes = []
    for box, text, score in result or []:
        if not text or float(score) < MIN_SCORE:
            continue
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        boxes.append((min(ys), max(ys), min(xs), text))
    boxes.sort(key=lambda b: (b[0], b[2]))
    rows = []
    for top, bottom, left, text in boxes:
        mid = (top + bottom) / 2
        if rows and rows[-1]["top"] <= mid <= rows[-1]["bottom"]:
            rows[-1]["items"].append((left, text))
            rows[-1]["bottom"] = max(rows[-1]["bottom"], bottom)
        else:
            rows.append({"top": top, "bottom": bottom, "items": [(left, text)]})
    return "\n".join(" ".join(t for _, t in sorted(r["items"])) for r in rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--pages", default="")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    out = {"pages": {}}
    try:
        from rapidocr_onnxruntime import RapidOCR
        import numpy as np

        engine = RapidOCR()
        if a.file.lower().endswith(".pdf"):
            import pypdfium2 as pdfium

            pdf = pdfium.PdfDocument(a.file)
            wanted = [int(p) for p in a.pages.split(",") if p.strip()] or list(range(1, len(pdf) + 1))
            for n in wanted:
                if n < 1 or n > len(pdf):
                    continue
                img = pdf[n - 1].render(scale=DPI / 72).to_pil().convert("RGB")
                result, _ = engine(np.array(img))
                out["pages"][str(n)] = lines_of(result)
            pdf.close()
        else:
            from PIL import Image

            img = Image.open(a.file).convert("RGB")
            result, _ = engine(np.array(img))
            out["pages"]["1"] = lines_of(result)
    except Exception as e:  # noqa: BLE001  the caller records it and does not try again
        out = {"error": "%s: %s" % (type(e).__name__, str(e)[:200])}
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, a.out)
    return 0 if "error" not in out else 2


if __name__ == "__main__":
    sys.exit(main())
