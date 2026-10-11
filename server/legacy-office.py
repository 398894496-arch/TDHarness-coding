"""Text from the old binary Office formats, for the knowledge search.

    python legacy-office.py --file <x.doc|x.xls|x.ppt|x.wps|x.et|x.dps> --out <result.json>

Writes {"text": "..."} or {"error": "..."} to --out (whole, then renamed). kb-index.js sends
only OLE2 files here (it reads the first bytes: WPS saves .wps / .et as zip by default, and
those go through the docx / xlsx reader instead). Kingsoft's binary .wps / .et / .dps are
laid out as Word / Excel / PowerPoint 97, so they share the readers below.

  Word   [MS-DOC]: the piece table (Clx) in the table stream says where each run of text
         sits in the WordDocument stream, 8-bit (cp1252) or UTF-16. Field instructions
         (between 0x13 and 0x14) are dropped, their results kept.
  Excel  xlrd (BIFF8), every sheet, one row per line, cells joined by " | ".
  PPT    [MS-PPT]: text atoms (TextCharsAtom UTF-16, TextBytesAtom 8-bit) in the slide list
         (placeholders) and in each slide's drawing (text boxes); masters are skipped.
         Slides are numbered in the order PowerPoint keeps them in the file.
Runs from the venv install-ocr.ps1 makes (olefile, xlrd).
"""
import argparse
import json
import os
import re
import struct
import sys

MAX_CHARS = 2 << 20


def doc_text(ole):
    word = ole.openstream("WordDocument").read()
    if struct.unpack_from("<H", word, 0)[0] != 0xA5EC:
        raise ValueError("not-a-word-document")
    flags = struct.unpack_from("<H", word, 0x0A)[0]
    if flags & 0x0100:
        raise ValueError("encrypted")
    table_name = "1Table" if flags & 0x0200 else "0Table"
    if not ole.exists(table_name):
        raise ValueError("no-table-stream")
    table = ole.openstream(table_name).read()
    fc_clx, lcb_clx = struct.unpack_from("<II", word, 0x01A2)
    clx = table[fc_clx:fc_clx + lcb_clx]
    i = 0
    while i < len(clx) and clx[i] == 0x01:  # Prc: property modifiers, skipped
        i += 3 + struct.unpack_from("<H", clx, i + 1)[0]
    if i >= len(clx) or clx[i] != 0x02:
        raise ValueError("no-piece-table")
    lcb = struct.unpack_from("<I", clx, i + 1)[0]
    plc = clx[i + 5:i + 5 + lcb]
    n = (lcb - 4) // 12
    cps = struct.unpack_from("<%dI" % (n + 1), plc, 0)
    out = []
    for k in range(n):
        fc = struct.unpack_from("<I", plc, 4 * (n + 1) + 8 * k + 2)[0]
        count = cps[k + 1] - cps[k]
        if fc & 0x40000000:
            start = (fc & ~0x40000000) // 2
            out.append(word[start:start + count].decode("cp1252", "replace"))
        else:
            out.append(word[fc:fc + 2 * count].decode("utf-16-le", "replace"))
    text = "".join(out)
    text = re.sub(r"\x13[^\x13\x14\x15]*\x14", "", text)  # field instruction, result kept
    text = re.sub(r"\x13[^\x13\x14\x15]*\x15", "", text)  # field with no result
    text = text.replace("\x07", "\t").replace("\r", "\n").replace("\x0b", "\n").replace("\x0c", "\n")
    return re.sub(r"[\x00-\x08\x0e-\x1f]", "", text)


def xls_text(path):
    import xlrd

    book = xlrd.open_workbook(path, on_demand=True)
    lines = []
    for sh in book.sheets():
        lines.append("## " + sh.name)
        for r in range(min(sh.nrows, 5000)):
            cells = []
            for c in sh.row(r):
                if c.ctype == xlrd.XL_CELL_NUMBER:
                    v = c.value
                    cells.append(str(int(v)) if float(v).is_integer() else str(v))
                elif c.ctype == xlrd.XL_CELL_DATE:
                    try:
                        cells.append(xlrd.xldate_as_datetime(c.value, book.datemode).strftime("%Y-%m-%d %H:%M").replace(" 00:00", ""))
                    except Exception:  # noqa: BLE001
                        cells.append(str(c.value))
                elif c.ctype == xlrd.XL_CELL_BOOLEAN:
                    cells.append("TRUE" if c.value else "FALSE")
                elif c.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK, xlrd.XL_CELL_ERROR):
                    cells.append("")
                else:
                    cells.append(str(c.value))
            while cells and cells[-1] == "":
                cells.pop()
            if any(cells):
                lines.append(" | ".join(cells))
        book.unload_sheet(sh.name)
    return "\n".join(lines)


SLIDE, NOTES, MAIN_MASTER, HANDOUT, SLWT = 0x03EE, 0x03F0, 0x03F8, 0x0FC9, 0x0FF0
SLIDE_PERSIST, TEXT_CHARS, TEXT_BYTES = 0x03F3, 0x0FA0, 0x0FA8


def ppt_text(ole):
    data = ole.openstream("PowerPoint Document").read()
    outline = {0: [], 2: []}  # slide list instance 0 = slides, 2 = notes: [[texts of one slide]]
    drawn = []  # text boxes, one list per Slide container, in file order
    notes_drawn = []

    def walk(start, end, path):
        p = start
        while p + 8 <= end:
            ver_inst, rtype, rlen = struct.unpack_from("<HHI", data, p)
            body, nxt = p + 8, min(p + 8 + rlen, end)
            ver, inst = ver_inst & 0x0F, ver_inst >> 4
            if ver == 0x0F:
                if rtype == SLIDE:
                    drawn.append([])
                if rtype == NOTES:
                    notes_drawn.append([])
                if rtype in (MAIN_MASTER, HANDOUT):
                    p = nxt
                    continue
                walk(body, nxt, path + [(rtype, inst)])
            else:
                text = None
                if rtype == TEXT_CHARS:
                    text = data[body:nxt].decode("utf-16-le", "replace")
                elif rtype == TEXT_BYTES:
                    text = data[body:nxt].decode("latin-1")
                slwt = next((i for t, i in reversed(path) if t == SLWT), None)
                if rtype == SLIDE_PERSIST and slwt in outline:
                    outline[slwt].append([])
                elif text is not None:
                    text = text.replace("\r", "\n").replace("\x0b", "\n").strip()
                    if not text:
                        pass
                    elif slwt in outline and outline[slwt]:
                        outline[slwt][-1].append(text)
                    elif any(t == SLIDE for t, _ in path) and drawn:
                        drawn[-1].append(text)
                    elif any(t == NOTES for t, _ in path) and notes_drawn:
                        notes_drawn[-1].append(text)
            p = nxt

    walk(0, len(data), [])
    slides = outline[0]
    for k, texts in enumerate(drawn):
        while len(slides) <= k:
            slides.append([])
        slides[k].extend(texts)
    parts = ["## 第 %d 页\n%s" % (k + 1, "\n".join(t)) for k, t in enumerate(slides) if t]
    notes = [x for group in outline[2] for x in group] + [x for group in notes_drawn for x in group]
    if notes:
        parts.append("## 备注\n" + "\n".join(notes))
    return "\n\n".join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    try:
        import olefile

        if not olefile.isOleFile(a.file):
            raise ValueError("not-ole")
        with olefile.OleFileIO(a.file) as ole:
            if ole.exists("WordDocument"):
                text = doc_text(ole)
            elif ole.exists("Workbook") or ole.exists("Book"):
                text = xls_text(a.file)
            elif ole.exists("PowerPoint Document"):
                text = ppt_text(ole)
            elif ole.exists("EncryptedPackage"):
                raise ValueError("encrypted")
            else:
                raise ValueError("unknown-ole")
        out = {"text": text[:MAX_CHARS]}
    except Exception as e:  # noqa: BLE001  the caller records it and does not try again
        out = {"error": "%s: %s" % (type(e).__name__, str(e)[:200])}
    tmp = a.out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, a.out)
    return 0 if "error" not in out else 2


if __name__ == "__main__":
    sys.exit(main())
