"""The look of a koubo video: every designed element, drawn here.

One system, so a video reads as one piece: warm ivory type, a muted gold
accent, a near-black green for panels; a serif for anything that is a
statement (names, chapter titles, keywords, quotes) and a sans for anything
that is information (subtitles, labels); hairlines instead of boxes; things
arrive by fading in while rising a little, and leave by fading.

Each element is a function of time: it returns the picture at `p` seconds
into its life. The builder turns that into a short video with transparency
and lays it over the footage. Jianying only has to place it.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
W, H = 1080, 1920

IVORY = (244, 239, 228)
GOLD = (216, 180, 106)
GOLD_SOFT = (233, 207, 149)
INK = (14, 21, 18)
MUTED = (176, 182, 172)

_fonts: dict = {}


def font(kind: str, size: int) -> ImageFont.FreeTypeFont:
    """serif / serif-bold / serif-light / sans / sans-medium, at a pixel size."""
    key = (kind, size)
    if key in _fonts:
        return _fonts[key]
    own = {
        "serif-bold": "SourceHanSerifCN-Bold.otf",
        "serif": "SourceHanSerifCN-SemiBold.otf",
        "serif-light": "SourceHanSerifCN-Regular.otf",
        "sans-medium": "SourceHanSansCN-Medium.otf",
        "sans": "SourceHanSansCN-Regular.otf",
        "sans-heavy": "SourceHanSansCN-Heavy.otf",
        "serif-heavy": "SourceHanSerifCN-Heavy.otf",
        "smiley": "SmileySans-Oblique.ttf",
    }[kind]
    spare = [r"C:\Windows\Fonts\msyhbd.ttc" if "bold" in kind or "medium" in kind or "heavy" in kind or kind == "smiley" else r"C:\Windows\Fonts\msyh.ttc",
             r"C:\Windows\Fonts\simhei.ttf", "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]
    for path in [str(HERE / "fonts" / own)] + spare:
        if os.path.isfile(path):
            try:
                _fonts[key] = ImageFont.truetype(path, size)
                return _fonts[key]
            except Exception:
                continue
    raise RuntimeError("no-font-for-" + kind)


def ease(t: float) -> float:
    """Fast at first, settling gently."""
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def arrive(p: float, start: float = 0.0, length: float = 0.32) -> float:
    return ease((p - start) / length)


def leave(p: float, total: float, length: float = 0.22) -> float:
    return max(0.0, min(1.0, (total - p) / length))


def layer(size=(W, H)) -> Image.Image:
    return Image.new("RGBA", size, (0, 0, 0, 0))


def text_w(s: str, f, tracking: float = 0.0) -> float:
    return sum(f.getlength(ch) for ch in s) + tracking * max(0, len(s) - 1)


def put(img: Image.Image, xy, s: str, f, fill, alpha: float = 1.0, tracking: float = 0.0, shadow: float = 0.0) -> None:
    """Text with letter spacing and opacity; an optional soft shadow under it."""
    if alpha <= 0 or not s:
        return
    x, y = xy
    tw = int(text_w(s, f, tracking)) + 40
    th = int(f.size * 1.5) + 40
    tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    cx = 20.0
    for ch in s:
        d.text((cx, 20), ch, font=f, fill=fill + (255,))
        cx += f.getlength(ch) + tracking
    if shadow > 0:
        sh = Image.new("RGBA", tile.size, (0, 0, 0, 0))
        sh.putalpha(tile.getchannel("A").point(lambda v: int(v * shadow)))
        sh = sh.filter(ImageFilter.GaussianBlur(max(2, f.size // 9)))
        if alpha < 1:
            sh.putalpha(sh.getchannel("A").point(lambda v: int(v * alpha)))
        img.alpha_composite(sh, (int(x) - 20, int(y) - 20 + max(2, f.size // 14)))
    if alpha < 1:
        tile.putalpha(tile.getchannel("A").point(lambda v: int(v * alpha)))
    img.alpha_composite(tile, (int(x) - 20, int(y) - 20))


def rule(img: Image.Image, x0: float, y: float, x1: float, color=GOLD, width: int = 3, alpha: float = 1.0) -> None:
    if x1 - x0 < 1 or alpha <= 0:
        return
    ImageDraw.Draw(img).rounded_rectangle((x0, y, x1, y + width), radius=width // 2, fill=color + (int(255 * alpha),))


def panel(img: Image.Image, box, alpha: float = 0.86, radius: int = 0, color=INK) -> None:
    tile = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle(box, radius=radius, fill=color + (int(255 * alpha),))
    img.alpha_composite(tile)


# ----------------------------------------------------------------- elements

def name_plate(p: float, total: float, name: str, lines: list) -> Image.Image:
    """The presenter: a hairline, the name in serif, what they are in small spaced sans.
    Region 1080 x 420."""
    img = layer((W, 420))
    out = leave(p, total)
    a_line = arrive(p, 0.0, 0.35) * out
    a_name = arrive(p, 0.12, 0.4) * out
    # a band that fades away to the right, so the type always has something to sit on
    band = Image.new("L", (W, 420), 0)
    bd = ImageDraw.Draw(band)
    for x in range(0, 760, 4):
        bd.rectangle((x, 30, x + 4, 390), fill=int(150 * (1 - x / 760) ** 1.4 * a_line))
    band = band.filter(ImageFilter.GaussianBlur(18))
    shade = Image.new("RGBA", (W, 420), INK + (0,))
    shade.putalpha(band)
    img.alpha_composite(shade)
    rule(img, 64, 70 + (1 - a_line) * 140, 67, GOLD, 3, a_line) if False else ImageDraw.Draw(img).rounded_rectangle(
        (64, 70 + (1 - a_line) * 140, 67, 350 - (1 - a_line) * 140), radius=2, fill=GOLD + (int(255 * a_line),))
    f_name = font("serif-bold", 92)
    put(img, (98, 62 + (1 - a_name) * 18), name, f_name, IVORY, a_name, tracking=10, shadow=0.55)
    f_line = font("sans-medium", 34)
    for k, line in enumerate(lines[:3]):
        a = arrive(p, 0.26 + 0.09 * k, 0.4) * out
        put(img, (100, 200 + k * 54 + (1 - a) * 12), line, f_line, IVORY if k else GOLD_SOFT, a * (0.86 if k else 1.0), tracking=3.5, shadow=0.7)
    return img


SUB_FACES = {"得意黑": "smiley", "思源黑体": "sans-heavy", "思源宋体": "serif-heavy"}


def subtitle(text: str, marks: list, face: str = "得意黑", size: int = 80) -> Image.Image:
    """One subtitle line, drawn: heavy type with corners, a thin ink edge and a
    soft shadow so it reads on any picture; the marked stretches in gold.
    Region 1080 x 200, the line centred."""
    img = layer((W, 200))
    kind = SUB_FACES.get(face, "smiley")
    f = font(kind, size)
    spare = font("sans-heavy", int(size * 0.92))  # for a character the display face does not have
    faces = []
    for ch in text:
        try:
            has = f.getmask(ch).getbbox() is not None or ch.isspace()
        except Exception:
            has = False
        faces.append(f if has else spare)
    track = 2.0
    width = sum(faces[k].getlength(ch) for k, ch in enumerate(text)) + track * max(0, len(text) - 1)
    if width > W - 120:  # a line a little too long is set a little smaller rather than cut
        return subtitle(text, marks, face, int(size * (W - 120) / width)) if size > 40 else img
    edge = max(2, size // 22)
    ink = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)
    x, y = (W - width) / 2, (200 - size * 1.18) / 2
    spots = []
    for k, ch in enumerate(text):
        hot = any(a <= k < b for a, b in marks)
        d.text((x, y), ch, font=faces[k], fill=(GOLD_SOFT if hot else IVORY) + (255,), stroke_width=edge, stroke_fill=INK + (255,))
        spots.append((x, ch, faces[k], hot))
        x += faces[k].getlength(ch) + track
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.putalpha(ink.getchannel("A").point(lambda v: int(v * 0.7)))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(7)), (0, 5))
    img.alpha_composite(ink)
    return img


def keyword(p: float, total: float, word: str) -> Image.Image:
    """The word a sentence turns on: large serif, a short gold rule drawing in under it.
    Region 1080 x 230, the word centred."""
    img = layer((W, 230))
    out = leave(p, total, 0.18)
    a = arrive(p, 0.0, 0.26) * out
    size = 104 if len(word) <= 4 else (88 if len(word) <= 6 else 72)
    f = font("serif-bold", size)
    tw = text_w(word, f, 6)
    x = (W - tw) / 2
    glow = Image.new("L", (W, 230), 0)
    ImageDraw.Draw(glow).ellipse((x - 90, 6, x + tw + 90, 214), fill=int(150 * a))
    back = Image.new("RGBA", (W, 230), INK + (0,))
    back.putalpha(glow.filter(ImageFilter.GaussianBlur(40)))
    img.alpha_composite(back)
    put(img, (x, 30 + (1 - a) * 22), word, f, IVORY, a, tracking=6, shadow=0.7)
    r = arrive(p, 0.1, 0.4) * out
    half = min(tw, 220) / 2 * r
    rule(img, W / 2 - half, 30 + size * 1.36, W / 2 + half, GOLD, 4, out)
    return img


def chapter_card(p: float, total: float, number: int, title: str) -> Image.Image:
    """Between chapters: a number, a hairline, the title. Sits on the blurred, darkened picture.
    Full canvas."""
    img = layer()
    out = leave(p, total, 0.25)
    cy = 820
    a_no = arrive(p, 0.0, 0.4) * out
    f_no = font("serif-light", 190)
    no = "%02d" % number
    put(img, ((W - text_w(no, f_no, 8)) / 2, cy - 250 + (1 - a_no) * 24), no, f_no, GOLD, a_no, tracking=8)
    r = arrive(p, 0.12, 0.45) * out
    rule(img, W / 2 - 150 * r, cy + 10, W / 2 + 150 * r, GOLD, 2, 0.9 * out)
    a_t = arrive(p, 0.2, 0.45) * out
    f_t = font("serif-bold", 96 if len(title) <= 6 else 80)
    put(img, ((W - text_w(title, f_t, 12)) / 2, cy + 56 + (1 - a_t) * 20), title, f_t, IVORY, a_t, tracking=12, shadow=0.5)
    return img


def chapter_mark(number: int, title: str) -> Image.Image:
    """While a chapter runs: its number and name, small, top left. Full canvas, still."""
    img = layer()
    f_no, f_t = font("serif", 52), font("sans-medium", 42)
    no = "%02d" % number
    x, y = 64, 132
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).rounded_rectangle((0, y - 40, x + 150 + text_w(title, f_t, 5), y + 100), radius=50, fill=120)
    back = Image.new("RGBA", (W, H), INK + (0,))
    back.putalpha(glow.filter(ImageFilter.GaussianBlur(36)))
    img.alpha_composite(back)
    put(img, (x, y - 6), no, f_no, GOLD, 1.0, tracking=2, shadow=0.6)
    wn = text_w(no, f_no, 2)
    ImageDraw.Draw(img).rectangle((x + wn + 18, y + 10, x + wn + 20, y + 56), fill=IVORY + (130,))
    put(img, (x + wn + 38, y + 4), title, f_t, IVORY, 0.97, tracking=5, shadow=0.6)
    return img


def list_panel(p: float, total: float, heading: str, items: list, current: int, since: float) -> Image.Image:
    """The lower third of the split layout: a heading and the points made so far, the
    current one lit. `since` is how long the current point has been showing. Full canvas;
    the footage sits in a card above (see `split_card_box`)."""
    img = layer()
    top = 1250
    panel(img, (0, top - 40, W, H), 1.0)
    fade = Image.new("L", (W, 120), 0)
    fd = ImageDraw.Draw(fade)
    for y in range(120):
        fd.line((0, y, W, y), fill=int(255 * (y / 120) ** 1.5))
    edge = Image.new("RGBA", (W, 120), INK + (0,))
    edge.putalpha(fade)
    img.alpha_composite(edge, (0, top - 160))
    f_h = font("sans-medium", 32)
    put(img, (84, top + 6), heading, f_h, GOLD_SOFT, 1.0, tracking=10)
    rule(img, 84, top + 62, 84 + 70, GOLD, 3)
    f_no, f_it = font("serif-light", 50), font("serif-bold", 72)
    step = 118 if len(items) <= 4 else 96
    y = top + 104
    for k, item in enumerate(items):
        if k > current:
            break
        lit = k == current
        a = arrive(since, 0.0, 0.34) if lit else 1.0
        col = IVORY if lit else MUTED
        put(img, (84, y + 12 + (1 - a) * 16), "%02d" % (k + 1), f_no, GOLD if lit else (120, 110, 84), a * (1.0 if lit else 0.75))
        put(img, (196, y - 4 + (1 - a) * 16), item, f_it if lit else font("serif", 62), col, a * (1.0 if lit else 0.6), tracking=4)
        y += step
    return img


def split_card_box() -> tuple:
    """Where the footage card sits in the split layout: x, y, w, h."""
    return (60, 150, 960, 1030)


def quote_card(p: float, total: float, lines: list, hot: str) -> Image.Image:
    """A line worth keeping: set like a pull quote, the key word in gold. Full canvas, over
    the blurred, darkened picture."""
    img = layer()
    out = leave(p, total, 0.25)
    a_q = arrive(p, 0.0, 0.4) * out
    f_q = font("serif-bold", 300)
    put(img, (86, 470 + (1 - a_q) * 20), "“", f_q, GOLD, 0.9 * a_q)
    size = 104 if max(len(x) for x in lines) <= 7 else 88
    f = font("serif-bold", size)
    y = 760
    for k, line in enumerate(lines):
        a = arrive(p, 0.14 + 0.12 * k, 0.45) * out
        x = 110.0
        at = line.find(hot) if hot else -1
        parts = [(line, IVORY)] if at < 0 else [(line[:at], IVORY), (hot, GOLD_SOFT), (line[at + len(hot):], IVORY)]
        for seg, col in parts:
            put(img, (x, y + (1 - a) * 22), seg, f, col, a, tracking=6, shadow=0.5)
            x += text_w(seg, f, 6) + (6 if seg else 0)
        y += int(size * 1.42)
    r = arrive(p, 0.3, 0.5) * out
    rule(img, 112, y + 34, 112 + 180 * r, GOLD, 4, out)
    return img


def end_card(p: float, total: float, line: str, name: str) -> Image.Image:
    """The last word: what to do next, and who was speaking. Full canvas."""
    img = layer()
    a = arrive(p, 0.0, 0.45)
    f = font("serif-bold", 84 if len(line) <= 9 else 68)
    put(img, ((W - text_w(line, f, 6)) / 2, 800 + (1 - a) * 20), line, f, IVORY, a, tracking=6, shadow=0.5)
    r = arrive(p, 0.15, 0.5)
    rule(img, W / 2 - 110 * r, 950, W / 2 + 110 * r, GOLD, 3)
    a2 = arrive(p, 0.3, 0.5)
    f2 = font("sans", 34)
    tag = "关注  " + name if name else "关注我"
    put(img, ((W - text_w(tag, f2, 8)) / 2, 990 + (1 - a2) * 12), tag, f2, GOLD_SOFT, a2, tracking=8)
    return img


def soft_vignette(strength: float = 0.5) -> Image.Image:
    """Depth, not a spotlight: the edges fall off gently. Always on, under everything drawn."""
    import numpy as np
    yy, xx = np.mgrid[0:H, 0:W].astype("float32")
    r = np.sqrt(((xx - W / 2) / (W * 0.78)) ** 2 + ((yy - H * 0.47) / (H * 0.66)) ** 2)
    a = np.clip((r - 0.55) / 0.75, 0, 1) ** 1.8 * strength
    out = np.zeros((H, W, 4), dtype="uint8")
    out[..., 0], out[..., 1], out[..., 2] = INK
    out[..., 3] = (a * 255).astype("uint8")
    return Image.fromarray(out, "RGBA")


def focus_vignette(strength: float = 0.78) -> Image.Image:
    """For a line that matters: the room dims, the speaker stays lit. Wide and soft."""
    import numpy as np
    yy, xx = np.mgrid[0:H, 0:W].astype("float32")
    r = np.sqrt(((xx - W / 2) / (W * 0.74)) ** 2 + ((yy - H * 0.44) / (H * 0.56)) ** 2)
    a = np.clip((r - 0.34) / 0.78, 0, 1) ** 1.5 * strength
    out = np.zeros((H, W, 4), dtype="uint8")
    out[..., 0], out[..., 1], out[..., 2] = INK
    out[..., 3] = (a * 255).astype("uint8")
    return Image.fromarray(out, "RGBA")


def progress_strip(fraction: float, ticks: list) -> Image.Image:
    """A hairline along the very top that fills as the video plays, with a tick at each chapter.
    Region 1080 x 10."""
    img = layer((W, 10))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 4), fill=IVORY + (46,))
    d.rectangle((0, 0, int(W * max(0.0, min(1.0, fraction))), 4), fill=GOLD + (235,))
    for t in ticks:
        x = int(W * t)
        d.rectangle((x - 1, 0, x + 1, 9), fill=IVORY + (150,))
    return img
