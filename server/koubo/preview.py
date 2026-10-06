"""See a draft without opening Jianying.

Reads the draft the tool wrote and lays its tracks over one another the way
Jianying does: footage with its zoom and blur, the drawn elements, the
subtitles. Writes contact sheets (a few frames a second) so the whole video
can be checked at a glance. Jianying's own text rendering and effects are
approximated; everything the tool draws itself is exact.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter

import design as D


def _frames(ffmpeg: str, path: str, start: float, length: float, fps: float, size: tuple, alpha: bool, out: Path) -> list:
    out.mkdir(parents=True, exist_ok=True)
    w, h = size
    vf = "fps=%s,scale=%d:%d" % (fps, w, h)
    cmd = [ffmpeg, "-v", "error", "-y", "-ss", "%.3f" % start, "-t", "%.3f" % max(0.05, length), "-i", path, "-vf", vf,
           "-pix_fmt", "rgba" if alpha else "rgb24", str(out / "%05d.png")]
    subprocess.run(cmd)
    return sorted(out.glob("*.png"))


def preview(draft_dir: Path, ffmpeg: str, out_dir: Path, fps: float = 5.0, scale: float = 1 / 3, per_sheet: int = 60, cols: int = 10) -> list:
    d = json.loads((draft_dir / "draft_content.json").read_text(encoding="utf-8"))
    cw, ch = d["canvas_config"]["width"], d["canvas_config"]["height"]
    W, H = int(cw * scale) // 2 * 2, int(ch * scale) // 2 * 2
    total = max((s["target_timerange"]["start"] + s["target_timerange"]["duration"]) for t in d["tracks"] for s in t["segments"]) / 1e6
    n = int(total * fps)
    videos = {m["id"]: m for m in d["materials"].get("videos", [])}
    texts = {m["id"]: m for m in d["materials"].get("texts", [])}
    blurred = {e["id"] for e in d["materials"].get("video_effects", []) if "模糊" in str(e.get("name", ""))}
    work = Path(tempfile.mkdtemp(prefix="koubo-prev-"))
    canvas = [Image.new("RGB", (W, H), (0, 0, 0)) for _ in range(n)]
    font = D.font("sans-medium", max(10, int(54 * scale)))

    for ti, track in enumerate(d["tracks"]):
        for si, seg in enumerate(track["segments"]):
            t0 = seg["target_timerange"]["start"] / 1e6
            dur = seg["target_timerange"]["duration"] / 1e6
            first = int(t0 * fps + 0.999)
            last = min(n - 1, int((t0 + dur) * fps - 1e-6))
            if last < first:
                continue
            clip = seg.get("clip") or {}
            sx = (clip.get("scale") or {}).get("x", 1.0)
            tx = (clip.get("transform") or {}).get("x", 0.0)
            ty = (clip.get("transform") or {}).get("y", 0.0)
            al = clip.get("alpha", 1.0)
            if track["type"] == "video":
                m = videos.get(seg["material_id"])
                if not m or al <= 0:
                    continue
                mw, mh = m.get("width") or cw, m.get("height") or ch
                fit = min(cw / mw, ch / mh) * sx  # Jianying fits a clip inside the canvas, then applies its scale
                pw, ph = max(2, int(mw * fit * scale)), max(2, int(mh * fit * scale))
                px = int(W / 2 + tx * W / 2 - pw / 2)
                py = int(H / 2 - ty * H / 2 - ph / 2)
                path = m["path"]
                still = path.lower().endswith(".png")
                is_alpha = still or path.lower().endswith(".mov")
                blur = any(r in blurred for r in seg.get("extra_material_refs", []))
                if still:
                    im = Image.open(path).convert("RGBA").resize((pw, ph))
                    for k in range(first, last + 1):
                        canvas[k].paste(im, (px, py), im)
                    continue
                src0 = seg["source_timerange"]["start"] / 1e6 + (first / fps - t0)
                fr = _frames(ffmpeg, path, src0, (last - first + 1) / fps, fps, (pw, ph), is_alpha, work / ("t%d-s%d" % (ti, si)))
                for k in range(first, last + 1):
                    if not fr:
                        break
                    im = Image.open(fr[min(k - first, len(fr) - 1)])  # a very short clip can decode a frame short; hold its last one
                    if blur:
                        im = im.filter(ImageFilter.GaussianBlur(max(2, int(24 * scale))))
                    if is_alpha:
                        im = im.convert("RGBA")
                        canvas[k].paste(im, (px, py), im)
                    else:
                        canvas[k].paste(im.convert("RGB"), (px, py))
            elif track["type"] == "text":
                m = texts.get(seg["material_id"])
                if not m:
                    continue
                content = json.loads(m["content"])
                text = content.get("text", "")
                tw = D.text_w(text, font, 1)
                y = int(H / 2 - ty * H / 2 - font.size * 0.6)
                for k in range(first, last + 1):
                    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                    x = (W - tw) / 2 + tx * W / 2
                    for st in content.get("styles", []):
                        a, b = st.get("range", [0, len(text)])
                        col = tuple(int(c * 255) for c in st["fill"]["content"]["solid"]["color"][:3])
                        D.put(lay, (x, y), text[a:b], font, col, 1.0, tracking=1, shadow=0.85)
                        x += D.text_w(text[a:b], font, 1) + 1
                    canvas[k].paste(lay, (0, 0), lay)

    out_dir.mkdir(parents=True, exist_ok=True)
    sheets = []
    rows = -(-per_sheet // cols)
    for s0 in range(0, n, per_sheet):
        sheet = Image.new("RGB", (W * cols, H * rows), (16, 16, 16))
        for k in range(s0, min(n, s0 + per_sheet)):
            sheet.paste(canvas[k], (((k - s0) % cols) * W, ((k - s0) // cols) * H))
        p = out_dir / ("preview-%02d.jpg" % (s0 // per_sheet))
        sheet.save(p, quality=82)
        sheets.append(p)
    return sheets
