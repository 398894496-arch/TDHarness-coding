#!/usr/bin/env python3
"""Talking-head rough cut: transcript first, then a Jianying (剪映) draft.

  koubo transcribe <video> [--out DIR]
      Speech to text with per-character times (FunASR, runs on this machine).
      Writes transcript.json and transcript.txt next to the video (or in DIR).

  koubo draft <plan.json>
      Builds a Jianying draft from a plan: which sentences stay, punch-in
      zoom per cut, subtitles with highlighted keywords, big keyword text,
      a name title and B-roll. A person opens the draft in Jianying to add
      beauty retouch, music and anything else, then exports.

  koubo check
      Says whether the environment is complete.

Nothing leaves the machine. The plan format is described in 使用说明.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

PUNCT = "，。！？、；：,.!?;:\"'“”‘’（）()《》〈〉【】…—-· \t\r\n"
SUB_MAX = 12          # characters on one subtitle line
PAD = 0.06            # seconds kept before and after a sentence
JOIN_GAP = 0.30       # sentences closer than this stay in one clip
INNER_GAP = 0.60      # a pause this long inside a sentence splits it
ZOOMS = (1.0, 1.18)   # alternated at each cut when the plan gives no zoom
# How a clip is dressed. plain: nothing. spot: dark corners. frame: the picture
# made smaller on black, dark corners. circle: the face in a round window.
# cutout: the person lifted off a blurred copy of the picture.
LOOKS = ("plain", "spot", "frame", "circle", "cutout", "quote", "list", "end")
AUTO_LOOKS = (None, None, "spot", None, None, "frame", None, "spot")  # used when the plan says "package": true
CUTOUT_MAX = 6.0      # seconds; lifting a person off the background is slow
BEAUTY_DEFAULT = {"磨皮": 35, "美白": 25, "匀肤": 30, "祛法令纹": 30, "祛黑眼圈": 30, "亮眼": 20, "白牙": 20}
# Jianying's own beauty sliders: (resource id, sub type, where the strength
# goes, needs the face-analysis path, key). Values as Jianying writes them;
# taken from capcut-mate (Apache-2.0), which checked them against real drafts.
BEAUTY = {
    "匀肤": ("7106322605304451614", "auto_beauty", "adjust", True, "face_adjust_yunfu", "0"),
    "丰盈": ("7165761391037518350", "auto_beauty", "adjust", True, "face_adjust_fuling", "0"),
    "磨皮": ("6976822940608238093", "auto_beauty", "value", True, "", "1"),
    "祛法令纹": ("7127560078508429831", "auto_beauty", "adjust", True, "face_adjust_NasolabialFolds", "0"),
    "亮眼": ("7210363411970921017", "auto_beauty", "adjust", True, "face_adjust_BrightEye", "0"),
    "祛黑眼圈": ("7127559798861599268", "auto_beauty", "adjust", True, "face_adjust_Pouch", "0"),
    "美白": ("6998408303826965006", "none", "value", False, "", "1"),
    "白牙": ("6998408263892996639", "auto_beauty", "adjust", True, "", "1"),
}
# Face shape ("美型"). Not in capcut-mate; taken from the catalogue Jianying
# keeps on disk, which lists for each slider the same three things the checked
# beauty sliders above are built from (resource id, effect type, strength key)
# - those match for every slider above, so the same recipe is used here.
# Only the 0-100 sliders: how the -50..50 ones are stored is not known.
BEAUTY.update({
    "瘦脸": ("7126765507457323557", "auto_beauty", "adjust", True, "face_adjust_TotalFace", "0"),
    "小脸": ("7325345220688613914", "auto_beauty", "adjust", True, "face_adjust_YouTaiFace", "0"),
    "V脸": ("7358087335411454501", "auto_beauty", "adjust", True, "face_adjust_VFace", "0"),
    "短脸": ("7126865570653278751", "auto_beauty", "adjust", True, "face_adjust_SmallFace", "0"),
    "颧骨": ("7127587811795931662", "auto_beauty", "adjust", True, "face_adjust_ZoomCheekbone", "0"),
    "下颌骨": ("7126764917918536199", "auto_beauty", "adjust", True, "face_adjust_ZoomJawbone", "0"),
    "开眼角": ("7127587986190897677", "auto_beauty", "adjust", True, "face_adjust_inner_corner", "0"),
    # these two carry no strength key, like 白牙, and are written the way 白牙 is
    "大眼": ("6998408219898941982", "auto_beauty", "adjust", True, "", "1"),
    "瘦鼻": ("6998408142216237575", "auto_beauty", "adjust", True, "", "1"),
})
BEAUTY_PANEL = {"瘦脸": "face_shape", "小脸": "face_shape", "V脸": "face_shape", "短脸": "face_shape", "颧骨": "face_shape", "下颌骨": "face_shape",
                "开眼角": "facial_features", "大眼": "facial_features", "瘦鼻": "facial_features"}
MAKEUP_ROOT = "7273096354098844221"
YELLOW = (1.0, 0.78, 0.12)
WHITE = (1.0, 1.0, 1.0)


# The house style: everything about how a video is dressed. A style file in
# the tool's style folder overrides any of this; the plan names the style.
STYLE_DEFAULT = {
    "名称": "默认",
    "画布": [1080, 1920],
    "帧率": 60,
    "时长": {"最短": 45, "最长": 0},   # 0 = no upper limit: the full talk
    "配色": {"正文": "#FFFFFF", "强调": "#E9CF95", "描边": "#000000", "人名": "#B5342A", "人名描边": "#FFFFFF", "头衔": "#FFFFFF"},
    "字体": {"字幕": "", "大字": "", "标题卡": "", "人名": "", "头衔": ""},
    # 描边 is the outline width (0 = none); 阴影 is how strong the drop shadow is (0 = none)
    "字幕": {"方式": "绘制", "字体": "得意黑", "像素": 80, "字号": 10.5, "位置": -0.44, "每行最多": 10, "加粗": False, "描边": 0, "阴影": 0.8},
    # the big word is the sentence's keyword: it leaves the subtitle and pops in under it when it is said
    "大字": {"字号": 15, "位置": -0.55, "最多字数": 6, "动画": "弹入", "加粗": True, "描边": 35, "阴影": 0.6, "替换字幕": False},
    "标题卡": {"字号": 20, "位置": 0.66, "关键词位置": 0.56, "时长": 2.5, "动画": "打字机_I", "加粗": True, "描边": 0, "阴影": 0.8},
    "人名条": {"字号": 24, "头衔字号": 7.5, "横向": -0.42, "位置": -0.14, "头衔位置": -0.25, "头衔行距": 0.048, "时长": 5, "描边": 30},
    "景别": [1.0, 1.15],
    "暗角强度": 0.93,
    "点缀色": "#E7C27D",  # hairlines, rings, the chapter number
    "推近": 0.04,  # how much a still shot slowly moves in while it plays (0 = not at all)
    "缩框": {"大小": 0.8, "圆角": 44, "背景放大": 1.35, "背景模糊": 55, "背景压暗": 0.45},
    "圆窗": {"大小": 0.76, "位置": 0.14, "背景模糊": 60, "背景压暗": 0.6},
    "章节角标": False,
    "防抖": {"开": True, "裁切": 1.05, "平滑秒": 1.5},
    "章节转场": 1.4,   # seconds the chapter card holds the screen (0 = no card, only the corner mark)
    "分屏清单": True,   # a run of 列举 sentences becomes the split layout with a building list
    "进度线": True,
    "片尾": True,
    "氛围暗角": 0.5,
    "人名条底板": True,
    "角色包装": {"钩子": "plain", "观点": "spot", "解释": "plain", "举例": "plain", "列举": "plain", "金句": "quote", "行动": "plain"},
    "章节开头": "plain",
    "章节标题卡": False,
    # how often the picture changes its dress: a dressed phrase or a cutaway at
    # least this often, taken in turn from the list, each on one short phrase
    "节奏": {"最长素面秒数": 6.0, "轮换": ["spot", "frame"], "短句上限秒": 2.8},
    "上限": {"circle": 1, "cutout": 4, "spot占比": 0.35, "frame占比": 0.18},
    "抠像": {"大小": 0.85, "位置": -0.3, "背景模糊": 60},
    "列举打大字": False,
    "空镜": {"最短": 1.8, "最长": 4.6, "最短间隔": 5.0, "开头禁用": 5.0},
    # what the reference cut uses: a clear, steady beat around 100 a minute, about 21 dB under the voice
    "音乐": {"曲目": "", "音量": 0.18, "偏好节拍": [100, 130], "要有节拍": True,
           "喜欢": ["动感", "节奏", "律动", "商务", "企业", "宣传", "广告", "科技", "励志", "自信", "时尚", "活力", "轻快", "流行", "电子", "funk", "house", "pop", "beat", "upbeat"],
           "不要": ["抒情", "温柔", "治愈", "感性", "伤感", "舒缓", "安静", "浪漫", "钢琴", "睡眠", "冥想", "古风", "悲", "kind", "soft", "calm", "piano", "sad"]},
    # each moment tries the names in order and uses the first this machine has:
    # Jianying's own sounds by their library names, then the built-in stand-ins
    "音效": {"音量": 0.6, "大字": ["轻快的嗖", "“咻 ”3", "嗖嗖", "whoosh"], "标题卡": ["打字声", "机械键盘打字声", "打字机键盘敲击声2", "type"],
             "章节": ["换镜头", "厚重的嗖", "whoosh"], "金句": ["bling~渐进效果音", "提示音", "ding"]},
    "美颜": {"磨皮": 55, "美白": 40, "匀肤": 50, "祛法令纹": 50, "祛黑眼圈": 50, "亮眼": 30, "白牙": 30, "丰盈": 20,
             "瘦脸": 35, "小脸": 20, "V脸": 0, "大眼": 0, "瘦鼻": 0},
}
ROLES = ("钩子", "观点", "解释", "举例", "列举", "金句", "行动")


def fail(msg: str) -> None:
    print("KOUBO_FAIL " + msg)
    raise SystemExit(1)


def find_ffmpeg() -> str:
    hit = os.environ.get("KOUBO_FFMPEG") or shutil.which("ffmpeg")
    if hit and Path(hit).exists():
        return hit
    home = Path.home()
    for p in (home / "TDH" / "CompanyDesk" / "ffmpeg" / "bin" / "ffmpeg.exe",):
        if p.exists():
            return str(p)
    fail("ffmpeg-missing")
    return ""


def clock(sec: float) -> str:
    m, s = divmod(max(0.0, sec), 60)
    return "%02d:%05.2f" % (int(m), s)


# ---------------------------------------------------------------- transcribe

def audio_offset(video: Path, ext_wav: Path, out: Path) -> float:
    """Seconds to add to a time on the separate recording to get the same
    moment in the video, found by lining up the loudness curves of the two."""
    import numpy as np
    import wave
    cam = out / "camera-16k.wav"
    subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", str(cam)], check=True)

    def curve(path: Path):
        with wave.open(str(path), "rb") as wf:
            x = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32)
        n = x.size // 160  # 10 ms steps
        e = np.log1p(np.abs(x[:n * 160]).reshape(n, 160).mean(axis=1))
        return (e - e.mean()) / (e.std() + 1e-6)

    a, b = curve(cam), curve(ext_wav)
    try:
        cam.unlink()
    except OSError:
        pass
    size = 1
    while size < a.size + b.size:
        size *= 2
    corr = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    lag = int(np.argmax(corr))
    if lag > size // 2:
        lag -= size
    peak = float(corr[lag] / min(a.size, b.size))
    if peak < 0.15:
        fail("audio-does-not-match-video (score %.2f)" % peak)
    print("AUDIO_MATCH_SCORE=%.2f" % peak)
    return round(lag / 100.0, 3)


def hear_online(wav: Path, pcm, out: Path, key: str) -> list:
    """The same rows the local recogniser gives, heard by Groq's hosted Whisper.

    The recording goes up in pieces of about ten minutes, each cut at the
    quietest moment near its end so no word is split. Whisper times whole
    words; the characters of a word share its time evenly."""
    import numpy as np
    import requests
    total = pcm.size / 16000.0
    cuts, at = [0.0], 0.0
    while total - at > 720:
        lo, hi = int((at + 570) * 16000), int((at + 630) * 16000)
        step = 4800  # 0.3 s
        e = np.abs(pcm[lo:hi][:(hi - lo) // step * step]).reshape(-1, step).mean(axis=1)
        at = (lo + (int(np.argmin(e)) + 0.5) * step) / 16000.0
        cuts.append(at)
    cuts.append(total)
    rows = []
    for i in range(len(cuts) - 1):
        t0, t1 = cuts[i], cuts[i + 1]
        piece = out / ("piece-%02d.flac" % i)
        subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-ss", "%.3f" % t0, "-t", "%.3f" % (t1 - t0), "-i", str(wav), str(piece)], check=True)
        res = None
        for attempt in range(6):
            with piece.open("rb") as fh:
                r = requests.post("https://api.groq.com/openai/v1/audio/transcriptions", headers={"Authorization": "Bearer " + key},
                                  files={"file": (piece.name, fh, "audio/flac")},
                                  data=[("model", "whisper-large-v3"), ("language", "zh"), ("temperature", "0"), ("response_format", "verbose_json"),
                                        ("prompt", "以下是普通话口播，使用简体中文。"), ("timestamp_granularities[]", "word"), ("timestamp_granularities[]", "segment")],
                                  timeout=300)
            if r.status_code == 200:
                res = r.json()
                break
            if r.status_code == 429 or r.status_code >= 500:  # the free tier meters audio per hour; wait as told and go on
                wait = min(900.0, float(r.headers.get("retry-after") or 20 * (attempt + 1)))
                print("ONLINE_WAIT %ds (%d)" % (wait, r.status_code), flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError("groq %d %s" % (r.status_code, r.text[:200].replace(key, "***")))
        piece.unlink(missing_ok=True)
        if res is None:
            raise RuntimeError("groq kept refusing")
        ends = [float(g["end"]) for g in res.get("segments") or []]
        row, gi = [], 0
        for w in res.get("words") or []:
            a, b = float(w["start"]), float(w["end"])
            while gi < len(ends) and a >= ends[gi] - 0.01:
                gi += 1
                if row:
                    rows.append(row)
                    row = []
            parts = re.findall(r"[A-Za-z0-9']+|[^\sA-Za-z0-9']", "".join(c if c not in PUNCT else " " for c in str(w.get("word") or "")))
            for k, c in enumerate(parts):
                span = max(0.02, b - a) / len(parts)
                row.append((c, int((t0 + a + k * span) * 1000), int((t0 + a + (k + 1) * span) * 1000)))
        if row:
            rows.append(row)
        print("ONLINE_PIECE %d/%d" % (i + 1, len(cuts) - 1), flush=True)
    return [[" ".join(c for c, _, _ in row), [[x, y] for _, x, y in row]] for row in rows]


def on_screen_voice(video: Path, sentences: list, shift: float):
    """Which voices belong to the person in the picture: (voices, {voice: movement}), or None.

    Someone who is speaking moves — the jaw, the head, the hands. For a few
    sentences of each voice the change from frame to frame is measured around
    the head of the person on screen; the voice it moves with is theirs."""
    by = {}
    for x in sentences:
        if x.get("spk") is not None and 1.5 <= x["end"] - x["start"] <= 6.0:
            by.setdefault(x["spk"], []).append(x)
    by = {k: v for k, v in by.items() if len(v) >= 3}
    if len(by) < 2:
        return None
    try:
        import numpy as np
    except Exception:
        return None
    w, h = 360, 640
    ff = find_ffmpeg()

    def frames(t: float, d: float):
        raw = subprocess.run([ff, "-v", "error", "-ss", "%.2f" % max(0.0, t), "-t", "%.2f" % d, "-i", str(video),
                              "-vf", "fps=12,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (w, h, w, h),
                              "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True).stdout
        n = len(raw) // (w * h)
        return np.frombuffer(raw[:n * w * h], np.uint8).reshape(n, h, w).astype(np.float32)

    box = (int(w * 0.2), int(h * 0.15), int(w * 0.8), int(h * 0.6))  # where a presenter usually is
    try:
        from rembg import new_session, remove
        from PIL import Image
        first = next(iter(by.values()))[0]
        f0 = frames(first["start"] + shift + 0.3, 0.2)
        mask = np.asarray(remove(Image.fromarray(f0[0].astype(np.uint8)).convert("RGB"),
                                 session=new_session(os.environ.get("KOUBO_MATTING_MODEL") or "u2net_human_seg"), only_mask=True)) > 128
        rows = np.where(mask.sum(axis=1) >= 8)[0]
        if rows.size >= 40:
            top = int(rows[0])
            band = mask[top:top + int(h * 0.12)]
            head = float(np.median(band.sum(axis=1)))
            cx = float(np.where(band)[1].mean())
            if head > 20:
                box = (int(max(0, cx - 0.7 * head)), int(top + 0.2 * head), int(min(w, cx + 0.7 * head)), int(min(h, top + 1.7 * head)))
    except Exception:
        pass
    moves = {}
    for voice, rows in by.items():
        rows = sorted(rows, key=lambda x: x["start"])
        picks = rows[:: max(1, len(rows) // 8)][:8]  # spread over the recording
        got = []
        for x in picks:
            f = frames(x["start"] + shift + 0.2, x["end"] - x["start"] - 0.3)
            if len(f) >= 6:
                got.append(float(np.abs(np.diff(f[:, box[1]:box[3], box[0]:box[2]], axis=0)).mean()))
        if len(got) >= 3:
            moves[voice] = float(np.median(got))
    if len(moves) < 2:
        return None
    # One person can come out as two voices (reading a line, then talking
    # freely), so every voice that moves the picture about as much as the
    # liveliest one is the presenter's; the still ones are off screen.
    top = max(moves.values())
    mine = {k for k, v in moves.items() if v >= 0.6 * top}
    if len(mine) == len(moves) or top < 1.35 * min(moves.values()):
        return None
    return mine, moves


def transcribe(args) -> None:
    video = Path(args.video).expanduser().resolve()
    if not video.is_file():
        fail("video-missing " + str(video))
    out = Path(args.out).expanduser().resolve() if args.out else video.parent / (video.stem + ".koubo")
    out.mkdir(parents=True, exist_ok=True)
    wav = out / "audio-16k.wav"
    audio = Path(args.audio).expanduser().resolve() if args.audio else None
    if audio is not None and not audio.is_file():
        fail("audio-missing " + str(audio))
    subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-i", str(audio or video), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    offset = 0.0
    if audio is not None:
        offset = audio_offset(video, wav, out)

    import numpy as np
    import wave
    with wave.open(str(wav), "rb") as wf:
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0

    def loud(a: float, b: float) -> float:
        part = pcm[int(a * 16000):int(b * 16000)]
        if part.size == 0:
            return -99.0
        return round(float(20 * np.log10(max(1e-5, float(np.sqrt(np.mean(part * part)))))), 1)

    raw = out / "asr-raw.json"
    if args.reuse and raw.is_file():
        heard = json.loads(raw.read_text(encoding="utf-8"))
    else:
        # Heard by the recogniser installed here. Groq's hosted Whisper is
        # there on request only: it is quicker, but it tidies speech up
        # (leaves out fillers and repeated takes), and those are exactly
        # what a rough cut has to find.
        rows, engine = None, getattr(args, "engine", "local")
        kf = tool_home() / "keys" / "groq.key"
        key = kf.read_text(encoding="utf-8").strip() if kf.is_file() else ""
        if engine == "groq" and not key:
            fail("groq-key-missing 把密钥存成 %s（文件里只放密钥这一行）" % kf)
        if engine == "groq":
            try:
                rows = hear_online(wav, pcm, out, key)
                print("ENGINE=groq whisper-large-v3")
            except Exception as e:
                fail("online-transcribe-failed " + str(e)[:200])
        if not rows:
            from funasr import AutoModel  # heavy import, only here
            try:  # with the voice model each row also says whose voice it is
                model = AutoModel(model="paraformer-zh", vad_model="fsmn-vad", punc_model="ct-punc", spk_model="cam++", disable_update=True, disable_pbar=True)
            except Exception:
                model = AutoModel(model="paraformer-zh", vad_model="fsmn-vad", punc_model="ct-punc", disable_update=True, disable_pbar=True)
            res = model.generate(input=str(wav), batch_size_s=300, sentence_timestamp=True)
            rows = [[str(r.get("text") or ""), r.get("timestamp") or [], r.get("spk")] for r in (res[0] if res else {}).get("sentence_info") or []]
            print("ENGINE=local paraformer-zh")
        heard = {"rows": rows}
        raw.write_text(json.dumps(heard, ensure_ascii=False), encoding="utf-8")

    # The recogniser returns rows of (text, times). The times of a row are the
    # right ones for a sentence, but the text of a row can run one character
    # into the next sentence, so characters and times are paired over the
    # whole recording and the rows' time counts say where sentences end.
    words, stamps, sizes, voices = [], [], [], []
    for row in heard["rows"]:
        text, row_stamps = row[0], row[1]
        clean = "".join(c if c not in PUNCT else " " for c in text)
        words += re.findall(r"[A-Za-z0-9']+|[^\sA-Za-z0-9']", clean)
        stamps += row_stamps
        sizes.append(len(row_stamps))
        voices.append(row[2] if len(row) > 2 else None)
    if not stamps:
        fail("no-speech-found")
    if len(words) != len(stamps):
        fail("recogniser-output-unexpected chars=%d times=%d" % (len(words), len(stamps)))
    tokens = [[words[k], stamps[k][0] / 1000, stamps[k][1] / 1000] for k in range(len(words))]

    groups, group_voice, at = [], [], 0
    for n, voice in zip(sizes, voices):
        row = list(range(at, at + n))
        at += n
        part = []
        for k in row:  # a long pause inside a sentence is a cut point too
            if part and tokens[k][1] - tokens[part[-1]][2] >= INNER_GAP:
                groups.append(part)
                group_voice.append(voice)
                part = []
            part.append(k)
        if part:
            groups.append(part)
            group_voice.append(voice)

    sentences = []
    for g, voice in zip(groups, group_voice):
        chars = [[tokens[k][0], round(tokens[k][1], 3), round(tokens[k][2], 3)] for k in g]
        text = "".join((" " + c[0] + " ") if re.match(r"[A-Za-z0-9']", c[0]) else c[0] for c in chars).replace("  ", " ").strip()
        start, end = chars[0][1], chars[-1][2]
        sentences.append({"id": len(sentences) + 1, "start": start, "end": end, "text": text, "db": loud(start, end), "near": None, "spk": voice, "chars": chars})

    # Two clearly different loudness levels mean two voices: the one at the
    # microphone (the presenter) and one further away (someone reading the
    # lines out, or the crew).
    split_db = None
    v = np.array([x["db"] for x in sentences if x["db"] > -60 and len(x["chars"]) >= 3], dtype=np.float32)
    if v.size >= 12:
        lo, hi = float(np.percentile(v, 15)), float(np.percentile(v, 85))
        mid = (lo + hi) / 2
        for _ in range(12):
            a, b = v[v < mid], v[v >= mid]
            if a.size == 0 or b.size == 0:
                break
            lo, hi = float(a.mean()), float(b.mean())
            mid = (lo + hi) / 2
        if hi - lo >= 5.0 and min((v < mid).mean(), (v >= mid).mean()) >= 0.12:
            split_db = mid
    if split_db is not None:
        for x in sentences:
            x["near"] = bool(x["db"] >= split_db)
    # Better than loudness: when the recogniser heard more than one voice, the
    # presenter is the voice during which the person in the picture moves.
    how = "loudness" if split_db is not None else ""
    seen = on_screen_voice(video, sentences, offset)
    if seen is not None:
        mine, moves = seen
        for x in sentences:
            if x["spk"] is not None:
                x["near"] = bool(x["spk"] in mine)
        how = "voice+picture"
        print("VOICES=%d PRESENTER=%s MOVEMENT=%s" % (len(moves), "+".join("voice%s" % k for k in sorted(mine)), " ".join("voice%s:%.1f" % kv for kv in sorted(moves.items()))))
    elif len({x["spk"] for x in sentences if x["spk"] is not None}) > 1 and audio is None:
        print("WARN 听到不止一个人的声音，但分不出哪个是出镜的人（画面里看不出差别）。挑句子前先让用户确认谁是主讲。")

    from pymediainfo import MediaInfo
    dur = 0.0
    for track in MediaInfo.parse(str(video)).tracks:
        if track.track_type == "General" and track.duration:
            dur = float(track.duration) / 1000
            break
    data = {"video": str(video), "duration": dur, "sentences": sentences}
    if audio is not None:
        # sentence times are on the separate recording; the same moment in
        # the video is time + audio_offset
        data["audio"] = str(audio)
        data["audio_offset"] = offset
        print("AUDIO_OFFSET=%.3f" % offset)
    (out / "transcript.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    # a seal: the words and their times belong together, so a transcript changed by hand is refused later
    (out / "transcript.seal").write_text(hashlib.sha1((out / "transcript.json").read_bytes()).hexdigest(), encoding="utf-8")
    lines = []
    if how:
        lines.append("# 近 = 出镜的人自己说的；远 = 镜头外的人说的（提词、提问、现场其他人）。只能挑「近」的句子：远的句子播出来时画面里的人是闭着嘴的。")
    prev = 0.0
    for s in sentences:
        gap = s["start"] - prev
        mark = "  ⏸%.1fs" % gap if gap >= 1.0 else ""
        who = "" if s["near"] is None else (" 近" if s["near"] else " 远")
        lines.append("[%d] %s–%s%s %ddB%s  %s" % (s["id"], clock(s["start"]), clock(s["end"]), who, round(s["db"]), mark, s["text"]))
        prev = s["end"]
    (out / "transcript.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    try:
        wav.unlink()
    except OSError:
        pass
    spoken = sum(s["end"] - s["start"] for s in sentences)
    print("TRANSCRIPT=" + str(out / "transcript.txt"))
    print("TRANSCRIPT_JSON=" + str(out / "transcript.json"))
    print("SENTENCES=%d DURATION=%s SPOKEN=%s" % (len(sentences), clock(dur), clock(spoken)))
    print("KOUBO_OK=1")


# --------------------------------------------------------------------- draft

def draft_root(plan: dict) -> Path:
    given = plan.get("draft_root") or os.environ.get("KOUBO_DRAFT_ROOT")
    if given:
        return Path(given)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "JianyingPro" / "User Data" / "Projects" / "com.lveditor.draft"
    return Path.home() / "Movies" / "JianyingPro" / "User Data" / "Projects" / "com.lveditor.draft"


def keep_list(plan: dict, by_id: dict) -> list:
    """The plan's keep entries as [{id, zoom}] in the order given."""
    rows = []
    for item in plan.get("keep") or []:
        if isinstance(item, int):
            item = {"id": item}
        ids = []
        if "id" in item:
            ids = [int(item["id"])]
        elif "ids" in item:
            ids = [int(x) for x in item["ids"]]
        elif "from" in item and "to" in item:
            ids = list(range(int(item["from"]), int(item["to"]) + 1))
        for i in ids:
            if i not in by_id:
                fail("keep-id-unknown %d" % i)
            look = item.get("look")
            if look is not None and look not in LOOKS:
                fail("look-unknown %s (use one of %s)" % (look, ", ".join(LOOKS)))
            cuts = [str(x) for x in (item.get("cut") or []) if str(x)]
            pieces = cut_words(by_id[i], cuts) if cuts and len(ids) == 1 else [by_id[i]]
            for k, piece in enumerate(pieces):
                vid = i
                if cuts and len(ids) == 1:
                    # a sentence with words cut out becomes several pieces,
                    # each with an id of its own that points back at the sentence
                    vid = 1000000 + len(by_id)
                    piece = dict(piece, id=vid, of=i)
                    by_id[vid] = piece
                rows.append({"id": vid, "zoom": item.get("zoom"), "look": look, "glued": k > 0})
    if not rows:
        fail("keep-empty")
    return rows


def cut_words(sentence: dict, cuts: list) -> list:
    """The sentence without the given words (the first place each one is
    said), as the pieces that are left."""
    chars = sentence.get("chars") or []
    text = "".join(c[0] for c in chars)
    drop = [False] * len(chars)
    for word in cuts:
        at = text.find(word)
        while at >= 0 and any(drop[at:at + len(word)]):
            at = text.find(word, at + 1)
        if at < 0:
            fail("cut-word-not-in-sentence %d %s" % (sentence["id"], word))
        for k in range(at, at + len(word)):
            drop[k] = True
    pieces, cur = [], []
    for k, c in enumerate(chars):
        if drop[k]:
            if cur:
                pieces.append(cur)
            cur = []
        else:
            cur.append(c)
    if cur:
        pieces.append(cur)
    if not pieces:
        fail("cut-leaves-nothing %d" % sentence["id"])
    return [{"id": sentence["id"], "start": g[0][1], "end": g[-1][2], "text": "".join(c[0] for c in g), "chars": g} for g in pieces]


def keep_rhythm(rows: list, by_id: dict, style: dict, title_secs: float, broll_ids: set) -> None:
    """Give a dress to one short phrase whenever the picture has gone plain
    for too long. Phrases the plan already dressed, and cutaways, count."""
    rule = style.get("节奏") or {}
    gap = float(rule.get("最长素面秒数", 0) or 0)
    turn = [x for x in (rule.get("轮换") or []) if x in LOOKS]
    if gap <= 0 or not turn:
        return
    short = float(rule.get("短句上限秒", 2.8))
    t, last, k = 0.0, 0.0, 0
    for row in rows:
        s = by_id[row["id"]]
        length = s["end"] - s["start"]
        sid = s.get("of", s["id"])
        if (row.get("look") not in (None, "plain")) or sid in broll_ids:
            last = t + length
        elif (t - last >= gap and t >= title_secs and 0.9 <= length <= short and not row.get("glued")
              and not row.get("zoom")):
            row["look"] = turn[k % len(turn)]
            k += 1
            last = t + length
        t += length


def lint(rows: list, by_id: dict) -> list:
    """Things in the kept sentences a viewer would hear as a mistake."""
    import difflib
    notes = []
    seen = []
    for row in rows:
        s = by_id[row["id"]]
        sid = s.get("of", s["id"])
        text = s["text"]
        for filler in ("呃", "嗯", "额"):
            if filler in text:
                notes.append("WARN [%d] 有语气词「%s」：%s  → 在这一项加 \"cut\": [\"%s\"]，或换一遍" % (sid, filler, text, filler))
        m = re.search(r"(.{1,3})\1", text)
        if m and len(m.group(1)) == 1:
            # 聊聊、看看 are words; 关关键词 is a stumble. A word list tells them apart.
            try:
                import jieba
                import logging
                jieba.setLogLevel(logging.ERROR)
                if m.group(0) in list(jieba.cut(text)):
                    m = None
            except Exception:
                m = None
        if m and not re.fullmatch(r"[一二三四五六七八九十百千万]+", m.group(0)):
            notes.append("WARN [%d] 有重复「%s」：%s  → 口吃就加 \"cut\": [\"%s\"]" % (sid, m.group(0), text, m.group(1)))
        if s.get("near") is False:
            notes.append("WARN [%d] 是远处的声音（提词或场外），不该留：%s" % (sid, text))
        for other_id, other in seen:
            if other_id == sid or len(text) < 2:
                continue
            same = text == other or (len(text) >= 4 and len(other) >= 4 and difflib.SequenceMatcher(None, text, other).ratio() >= 0.82)
            if same:
                notes.append("WARN [%d] 和 [%d] 说的是同一句，只留一遍：%s ／ %s" % (sid, other_id, text, other))
                break
        seen.append((sid, text))
    return notes


def clips_of(rows: list, by_id: dict, duration: float, shift: float = 0.0) -> list:
    """Kept sentences merged into clips: neighbours in the source that are
    close together and share a zoom stay one clip; everything else is a cut."""
    clips = []
    for row in rows:
        s = by_id[row["id"]]
        a = max(0.0, -shift, s["start"] - PAD)
        b = min((duration - shift) if duration else s["end"] + PAD, s["end"] + PAD)
        last = clips[-1] if clips else None
        if last and not row.get("glued") and not row.get("solo") and not last.get("solo") and last["zoom"] == row["zoom"] and last["look"] == row["look"] and row["id"] == last["ids"][-1] + 1 and a - last["b"] <= JOIN_GAP:
            last["b"] = b
            last["ids"].append(row["id"])
            continue
        if last and a < last["b"] and row["id"] == last["ids"][-1] + 1:
            a = last["b"]  # paddings of two neighbours must not overlap
        if row.get("glued"):
            # the rest of a sentence after a word was cut out: no room for
            # padding on the cut side, and the picture should not change
            a = max(a, s["start"] - 0.02)
            if last:
                last["b"] = min(last["b"], by_id[last["ids"][-1]]["end"] + 0.02)
        clips.append({"a": a, "b": b, "ids": [row["id"]], "zoom": row["zoom"], "look": row["look"], "glued": bool(row.get("glued")),
                      "solo": bool(row.get("solo")), "list": row.get("list")})
    step = 0
    prev = None
    for c in clips:
        if c["glued"] and prev is not None:
            c["zoom"], c["look"] = prev["zoom"], prev["look"]
        elif c["zoom"] is None:
            c["zoom"] = ZOOMS[step % len(ZOOMS)]
            step += 1
        else:
            c["zoom"] = float(c["zoom"])
        prev = c
    return clips


def sub_lines(sentence: dict) -> list:
    """A sentence as subtitle lines [(text, start, end)]. A long one is
    broken between words, into lines of about the same length."""
    bare = sentence["text"]
    chars = sentence.get("chars") or []
    if len(bare) <= SUB_MAX or len(chars) < 2:
        return [(bare, sentence["start"], sentence["end"])]
    joined = "".join(c[0] for c in chars)
    try:
        import jieba
        import logging
        jieba.setLogLevel(logging.ERROR)
        for w in ("评论区",) + tuple(sentence.get("keep_whole") or ()):
            jieba.add_word(w)
        words = [w for w in jieba.cut(joined) if w]
    except Exception:
        words = list(joined)
    # word ends, counted in entries of `chars` (an English word is one entry)
    ends, pos = [], 0
    spans = [len(c[0]) for c in chars]
    acc, idx = 0, 0
    for w in words:
        pos += len(w)
        while idx < len(spans) and acc < pos:
            acc += spans[idx]
            idx += 1
        if acc == pos:
            ends.append(idx)
    if not ends or ends[-1] != len(chars):
        ends.append(len(chars))
    parts = -(-len(chars) // SUB_MAX)
    out, start = [], 0
    for k in range(parts, 0, -1):
        want = start + (len(chars) - start) / k
        ok = [e for e in ends if start < e <= start + SUB_MAX] or [min(len(chars), start + SUB_MAX)]
        cut = len(chars) if k == 1 and len(chars) - start <= SUB_MAX else min(ok, key=lambda e: abs(e - want))
        chunk = chars[start:cut]
        out.append(("".join(c[0] for c in chunk), chunk[0][1], chunk[-1][2]))
        start = cut
        if start >= len(chars):
            break
    if start < len(chars):
        chunk = chars[start:]
        out.append(("".join(c[0] for c in chunk), chunk[0][1], chunk[-1][2]))
    return out


def tool_home() -> Path:
    return Path(os.environ.get("KOUBO_HOME") or Path(__file__).resolve().parent)


def load_style(name: str) -> dict:
    """The default style with the named style file laid over it."""
    style = json.loads(json.dumps(STYLE_DEFAULT))
    f = tool_home() / "style" / ((name or "默认") + ".json")
    if f.is_file():
        over = json.loads(f.read_text(encoding="utf-8-sig"))
        for k, v in over.items():
            if isinstance(v, dict) and isinstance(style.get(k), dict):
                style[k].update(v)
            else:
                style[k] = v
    elif name and name != "默认":
        fail("style-missing " + str(f))
    return style


def rgb(code: str) -> tuple:
    code = str(code).lstrip("#")
    return tuple(int(code[k:k + 2], 16) / 255 for k in (0, 2, 4))


def expand_sections(plan: dict, style: dict, by_id: dict) -> list:
    """A plan written as sections with roles becomes the plain lists the
    builder works from: what stays, how each clip is dressed, title cards and
    big words. Returns the moments that get a sound: [(sentence id, kind)]."""
    sounds = []
    if plan.get("sections"):
        keep, cards = [], list(plan.get("cards") or [])
        for sec_no, sec in enumerate(plan["sections"]):
            items = [({"id": x} if isinstance(x, int) else dict(x)) for x in (sec.get("keep") or [])]
            title = str(sec.get("title") or "").strip()
            for k, item in enumerate(items):
                if k == 0 and title and sec_no > 0 and "id" in item:
                    if style.get("章节开头", "plain") != "plain":
                        item.setdefault("look", style["章节开头"])
                    if style.get("章节标题卡"):
                        cards.append({"id": item["id"], "text": title})
                        sounds.append((int(item["id"]), "章节"))
                keep.append(item)
        plan["keep"], plan["cards"] = keep, cards
    big = list(plan.get("big") or [])
    has_big = {int(b["id"]) for b in big if "id" in b}
    for item in plan.get("keep") or []:
        if not isinstance(item, dict) or "id" not in item:
            continue
        role = item.get("role")
        if role is None:
            continue
        if role not in ROLES:
            fail("role-unknown %s (use one of %s)" % (role, "、".join(ROLES)))
        item.setdefault("look", style["角色包装"].get(role, "plain"))
        sid = int(item["id"])
        if role == "金句":
            sounds.append((sid, "金句"))
        if role == "列举" and style.get("列举打大字") and sid in by_id and sid not in has_big:
            text = by_id[sid]["text"]
            if len(text) <= int(style["大字"]["最多字数"]):
                big.append({"id": sid, "text": text})
                has_big.add(sid)
    plan["big"] = big
    for b in big:
        if "id" in b:
            sounds.append((int(b["id"]), "大字"))
            if int(b["id"]) in by_id and str(b.get("text") or "") not in "".join(ch[0] for ch in by_id[int(b["id"])].get("chars") or []):
                fail("big-word-not-in-sentence %s %s (大字必须是这句话里原样出现的词)" % (b["id"], b.get("text")))
    for c in plan.get("cards") or []:
        if "id" in c and (int(c["id"]), "章节") not in sounds:
            sounds.append((int(c["id"]), "标题卡"))
    return sounds


SFX_RECIPES = {
    # stand-ins made on this machine, so a draft never lacks a sound; replace
    # any of them by putting a file of the same name in the sfx folder
    "pop": "sine=f=920:d=0.12,afade=t=out:st=0.03:d=0.09,volume=0.8",
    "ding": "sine=f=1568:d=0.7,afade=t=out:st=0.05:d=0.65,volume=0.6",
    "whoosh": "anoisesrc=d=0.5:c=pink:a=0.7,highpass=f=500,lowpass=f=5000,afade=t=in:d=0.22,afade=t=out:st=0.25:d=0.25",
    "type": "anoisesrc=d=0.7:c=white:a=0.5,highpass=f=2500,volume='if(lt(mod(t,0.085),0.012),1,0)':eval=frame",
}


def find_sfx(want: str):
    """A sound by name: a file in the sfx folder, something Jianying has
    downloaded (jy-xxxx), or one of the stand-ins made here."""
    if not want:
        return None
    folder = tool_home() / "sfx"
    if folder.is_dir():
        for f in sorted(folder.iterdir()):
            if f.stem == want and f.suffix.lower() in (".mp3", ".wav", ".m4a", ".aac"):
                return f
    if want.startswith("jy-"):
        for f in jianying_music_cache().glob(want[3:] + "*.mp3"):
            return f
    for r in music_rows(sounds=True):
        if r["key"] == want:
            return r["file"]
    if want in SFX_RECIPES:
        folder.mkdir(exist_ok=True)
        out = folder / (want + ".wav")
        run = subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-f", "lavfi", "-i", SFX_RECIPES[want], "-ar", "44100", "-ac", "2", str(out)])
        return out if run.returncode == 0 and out.is_file() else None
    return None


def jianying_music_cache() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    base = Path(local) / "JianyingPro" if local else Path.home() / "Movies" / "JianyingPro"
    return base / "User Data" / "Cache" / "music"


def link_until(url: str) -> float:
    """When a library link stops working (the links carry their own end
    time), as seconds since 1970; 0 when it cannot be read."""
    m = re.search(r"/([0-9a-f]{8})/(?:video|audio)/", url or "")
    return float(int(m.group(1), 16)) if m else 0.0


def jianying_catalog() -> dict:
    """What Jianying itself knows about its music and sound library, read from
    the copy of the library lists it keeps on this machine: for every file it
    has downloaded, the title, who made it, the style and whether it may be
    used commercially; and the titles it has shown but not downloaded yet.
    Nothing is fetched and nothing in Jianying's folders is changed."""
    import hashlib
    import sqlite3
    import tempfile
    cache = jianying_music_cache()
    out = {"songs": {}, "sounds": {}, "by_file": {}}
    root = cache.parent / "ressdk_db"
    if not root.is_dir():
        return out
    on_disk = {f.stem.lower(): f for f in cache.glob("*.mp3")} if cache.is_dir() else {}
    by_hex = {}
    try:
        for e in json.loads((cache / "downLoadcfg").read_text(encoding="utf-8")).get("list") or []:
            by_hex[str(e.get("hex", "")).lower()] = cache / str(e.get("path", ""))
    except Exception:
        pass
    work = Path(tempfile.mkdtemp(prefix="koubo-cat-"))
    try:
        for n, db in enumerate(sorted(root.rglob("rp.db"))):
            # read a private copy: Jianying may be writing to the real one
            mine = work / ("rp%d.db" % n)
            try:
                shutil.copyfile(db, mine)
                for ext in ("-wal", "-shm"):
                    side = Path(str(db) + ext)
                    if side.is_file():
                        shutil.copyfile(side, Path(str(mine) + ext))
                con = sqlite3.connect(str(mine))
                rows = con.execute("SELECT url, response_body FROM http_cache").fetchall()
                con.close()
            except Exception:
                continue
            for url, raw in rows:
                try:
                    payload = json.loads(raw)
                except Exception:
                    continue
                is_audio_list = "_audio_" in str(url)
                stack = [payload]
                while stack:
                    node = stack.pop()
                    if isinstance(node, list):
                        stack.extend(node)
                        continue
                    if not isinstance(node, dict):
                        continue
                    if "preview_url" in node and "author" in node and node.get("title") and node.get("id"):
                        sid = str(node["id"])
                        f = by_hex.get(hashlib.md5(sid.encode()).hexdigest())
                        genres = [g.get("name") if isinstance(g, dict) else str(g) for g in (node.get("genres") or [])]
                        if sid in out["songs"] and link_until(out["songs"][sid]["link"]) >= link_until(str(node.get("preview_url") or "")):
                            continue
                        out["songs"][sid] = {"link": str(node.get("preview_url") or ""),
                                             "title": str(node["title"]).strip(), "author": str(node.get("author") or ""), "seconds": float(node.get("duration") or 0),
                                             "genres": [g for g in genres if g], "commercial": bool(node.get("is_commerce")),
                                             "file": f if f is not None and f.is_file() else None}
                    md5 = node.get("md5")
                    if is_audio_list and isinstance(md5, str) and node.get("title"):
                        f = on_disk.get(md5.lower())
                        links = [u for u in (node.get("item_urls") or []) if isinstance(u, str)]
                        dl = node.get("download_info")
                        if isinstance(dl, dict) and dl.get("url"):
                            links.append(str(dl["url"]))
                        old = out["sounds"].get(md5.lower())
                        def rank(u):
                            e = link_until(u)
                            return e if e else 9e18  # unknown age: try it first
                        if old is None or rank(links[0] if links else "") > rank(old.get("link", "")):
                            out["sounds"][md5.lower()] = {"title": str(node["title"]).strip(), "file": f, "link": links[0] if links else "", "md5": md5.lower()}
                    stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
    finally:
        shutil.rmtree(work, ignore_errors=True)
    for kind in ("songs", "sounds"):
        for row in out[kind].values():
            if row["file"] is not None:
                out["by_file"][row["file"].name] = dict(row, kind=kind)
    return out


def feel_of(path: Path) -> str:
    """A rough word for how a track feels, from the first half minute:
    how busy it is and how bright it sounds. Kept beside the cache so each
    file is only listened to once."""
    memo = tool_home() / "models" / "music-feel.json"
    try:
        known = json.loads(memo.read_text(encoding="utf-8"))
    except Exception:
        known = {}
    key = "v2:" + path.name + ":" + str(path.stat().st_size)
    if key in known:
        return known[key]
    word = ""
    try:
        import numpy as np
        raw = subprocess.run([find_ffmpeg(), "-v", "error", "-ss", "8", "-t", "30", "-i", str(path), "-ac", "1", "-ar", "11025", "-f", "s16le", "-"],
                             capture_output=True).stdout
        x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768
        if x.size > 11025 * 5:
            n = x.size // 256
            env = np.abs(x[:n * 256]).reshape(n, 256).mean(axis=1)
            rise = np.maximum(0, np.diff(env))
            hits = int(((rise[1:-1] > rise[:-2]) & (rise[1:-1] >= rise[2:]) & (rise[1:-1] > rise.mean() + rise.std())).sum())
            per_sec = hits / (x.size / 11025)
            spec = np.abs(np.fft.rfft(x[:11025 * 20]))
            bright = float((spec * np.arange(spec.size)).sum() / (spec.sum() + 1e-9)) / spec.size
            tone = "低沉" if bright < 0.12 else ("温暖" if bright < 0.2 else "明亮")
            # the beat: how regularly the low end pulses, and how fast
            fr = np.lib.stride_tricks.sliding_window_view(x, 512)[::256] * np.hanning(512)
            low = np.abs(np.fft.rfft(fr, axis=1))[:, 2:8].sum(axis=1)
            on = np.maximum(0, np.diff(low))
            on = on - on.mean()
            ac = np.correlate(on, on, "full")[on.size - 1:]
            lag = np.arange(ac.size) * 256 / 11025
            m = (lag > 0.33) & (lag < 1.2)
            bpm = 60 / float(lag[m][int(np.argmax(ac[m]))])
            pulse = float(ac[m].max() / (ac[0] + 1e-9))
            beat = "节拍明显" if pulse >= 0.3 else ("有节拍" if pulse >= 0.15 else "无明显节拍")
            word = "%s·%dbpm·%s" % (beat, round(bpm), tone)
    except Exception:
        word = ""
    known[key] = word
    try:
        memo.parent.mkdir(exist_ok=True)
        memo.write_text(json.dumps(known, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return word


def music_rows(sounds: bool = False) -> list:
    """Music this machine has: named files in the tool's music folder, then
    what Jianying has downloaded (those have no titles, only an id). With
    `sounds`, the short ones instead: sound effects."""
    from pymediainfo import MediaInfo
    rows = []

    def seconds(p: Path) -> float:
        try:
            for t in MediaInfo.parse(str(p)).tracks:
                if t.track_type == "General" and t.duration:
                    return float(t.duration) / 1000
        except Exception:
            pass
        return 0.0

    folder = tool_home() / ("sfx" if sounds else "music")
    if folder.is_dir():
        try:
            notes = json.loads((folder / "目录.json").read_text(encoding="utf-8"))
        except Exception:
            notes = {}
        for f in sorted(folder.iterdir()):
            if f.suffix.lower() in (".mp3", ".m4a", ".wav", ".aac", ".flac"):
                note = notes.get(f.name) or {}
                rows.append({"key": f.stem, "file": f, "seconds": seconds(f), "from": "音效文件夹" if sounds else "配乐文件夹", "day": "",
                             "author": note.get("author", ""), "genres": note.get("genres", []), "commercial": note.get("commercial"), "named": True})
    cache = jianying_music_cache()
    if cache.is_dir():
        import time
        known = jianying_catalog()["by_file"]
        for f in sorted(cache.glob("*.mp3"), key=lambda x: -x.stat().st_mtime):
            d = seconds(f)
            info = known.get(f.name)
            is_sound = (info["kind"] == "sounds") if info else d < 30  # songs and sound effects share one folder
            if is_sound == sounds and d > 0.1:
                rows.append({"key": info["title"] if info else "jy-" + f.stem[:8], "file": f, "seconds": d, "from": "剪映已下载",
                             "day": time.strftime("%Y-%m-%d", time.localtime(f.stat().st_mtime)),
                             "author": (info or {}).get("author", ""), "genres": (info or {}).get("genres", []),
                             "commercial": (info or {}).get("commercial"), "named": bool(info)})
    return rows


def find_music(want: str):
    p = Path(want)
    if p.is_file():
        return p
    rows = music_rows()
    for r in rows:
        if r["key"] == want:
            return r["file"]
    for r in rows:
        if want and want in r["key"]:
            return r["file"]
    if want.startswith("jy-"):
        for f in jianying_music_cache().glob(want[3:] + "*.mp3"):
            return f
    return None


def music(args) -> None:
    query = str(getattr(args, "query", "") or "").strip().lower()

    def wanted(*texts) -> bool:
        return not query or any(query in str(t).lower() for t in texts)

    rows = [r for r in music_rows() if wanted(r["key"], r.get("author"), " ".join(r.get("genres") or []))]
    if getattr(args, "suggest", False):
        pref = load_style(str(getattr(args, "style", "") or "默认"))["音乐"]
        lo, hi = pref.get("偏好节拍") or [0, 999]
        scored = []
        for r in rows:
            feel = feel_of(r["file"])
            m = re.search(r"(\d+)bpm", feel)
            bpm = int(m.group(1)) if m else 0
            if r.get("commercial") is False or r["seconds"] < 45:
                continue
            score = (2 if "节拍明显" in feel else 1 if "有节拍" in feel else 0) if pref.get("要有节拍") else 1
            score += 2 if lo <= bpm <= hi else (1 if lo <= bpm / 2 <= hi or lo <= bpm * 2 <= hi else 0)
            score += 0.5 if r.get("commercial") else 0
            words = (r["key"] + " " + " ".join(r.get("genres") or [])).lower()
            score += 2 if any(w.lower() in words for w in pref.get("喜欢") or []) else 0
            if any(w.lower() in words for w in pref.get("不要") or []):
                continue  # the style says what this kind of video must not sound like
            scored.append((score, r, feel))
        scored.sort(key=lambda x: -x[0])
        print("# 按风格文件的偏好（节拍 %s–%s、%s）排出来的配乐，从上往下挑；名称不合片子调性的跳过（搞笑、紧张、悬疑、卡点这类不用于访谈口播）。" % (lo, hi, "要有明显节拍" if pref.get("要有节拍") else "不限"))
        for score, r, feel in scored[:15]:
            print("%s\t%s\t%s\t%s" % (r["key"], clock(r["seconds"]), "/".join(r.get("genres") or []), feel))
        print("KOUBO_OK=1")
        return
    print("# 配乐（本机能直接用的）。计划里写 \"music\": {\"file\": \"<名称>\"}，或在风格文件的「音乐」里固定一首。")
    print("# 名称\t时长\t风格\t听感\t可商用\t下载日期\t来源")
    for r in rows:
        ok = {True: "可商用", False: "不可商用", None: ""}[r.get("commercial")]
        print("%s\t%s\t%s\t%s\t%s\t%s\t%s" % (r["key"], clock(r["seconds"]), "/".join(r.get("genres") or []), feel_of(r["file"]), ok, r["day"], r["from"]))
    fx = [r for r in music_rows(sounds=True) if wanted(r["key"])]
    print("# 音效（本机能直接用的）。在风格文件的「音效」里把 大字／标题卡／章节／金句 指到某个名称。内置替身：pop、ding、whoosh、type。")
    for r in fx:
        print("%s\t%s\t%s\t%s" % (r["key"], clock(r["seconds"]), r["day"], r["from"]))
    cat = jianying_catalog()
    more_songs = [v for v in cat["songs"].values() if v["file"] is None and wanted(v["title"], v["author"], " ".join(v["genres"]))]
    more_fx = [v for v in cat["sounds"].values() if v["file"] is None and wanted(v["title"])]
    if getattr(args, "all", False) or query:
        print("# 剪映曲库里看到过、还没下载的。要用：请用户在剪映「音频」里搜这个名称点一下下载，再重跑。")
        for v in sorted(more_songs, key=lambda v: v["title"])[:200]:
            print("未下载·配乐\t%s\t%s\t%s\t%s\t%s" % (v["title"], clock(v["seconds"]), v["author"], "/".join(v["genres"]), "可商用" if v["commercial"] else "不可商用"))
        for v in sorted(more_fx, key=lambda v: v["title"])[:200]:
            print("未下载·音效\t%s" % v["title"])
    if getattr(args, "audition", False):
        # copies with readable names, so a person can listen and choose
        out = tool_home() / "试听"
        out.mkdir(exist_ok=True)
        n = 0
        for r in rows + fx:
            if r["from"] == "剪映已下载":
                kind = "音效" if r in fx else "配乐"
                name = "%s %s %s" % (kind, re.sub(r'[\\/:*?"<>|]', "_", r["key"]), clock(r["seconds"]).replace(":", "分").split(".")[0] + "秒")
                shutil.copyfile(r["file"], out / (name.strip() + ".mp3"))
                n += 1
        print("AUDITION_FOLDER=%s FILES=%d" % (out, n))
    print("MUSIC=%d SOUNDS=%d NOT_DOWNLOADED_SONGS=%d NOT_DOWNLOADED_SOUNDS=%d" % (len(rows), len(fx), len(more_songs), len(more_fx)))
    print("KOUBO_OK=1")


def fetch(args) -> None:
    """Bring music and sounds from Jianying's library onto this machine, using
    the list Jianying itself has loaded and the member's own links in it.
    Files go to this tool's music and sfx folders, under their library names."""
    import time
    import urllib.request
    cat = jianying_catalog()
    now = time.time()
    query = str(args.query or "").lower()

    def safe(name: str) -> str:
        return re.sub(r'[\\/:*?"<>|\r\n\t]', " ", name).strip()[:60] or "未命名"

    def take(kind: str, rows: list, want: int, folder: Path, ext: str) -> tuple:
        folder.mkdir(exist_ok=True)
        try:
            notes = json.loads((folder / "目录.json").read_text(encoding="utf-8"))
        except Exception:
            notes = {}
        got = stale = had = failed = 0
        for row in rows:
            if got >= want:
                break
            out = folder / (safe(row["title"]) + ext)
            if out.is_file() or row.get("file") is not None:
                had += 1
                continue
            end = link_until(row.get("link", ""))
            if not row.get("link") or (end and end < now + 60):  # a link with no readable end time is simply tried
                stale += 1
                continue
            try:
                req = urllib.request.Request(row["link"], headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                if len(data) < 2000:
                    raise ValueError("too small")
                out.write_bytes(data)
                notes[out.name] = {"author": row.get("author", ""), "genres": row.get("genres", []), "commercial": row.get("commercial"), "from": "剪映曲库"}
                got += 1
                print("FETCHED\t%s\t%s" % (kind, out.name))
                time.sleep(0.4)
            except Exception as exc:  # noqa: BLE001
                if getattr(exc, "code", 0) in (403, 410):
                    stale += 1  # the link has run out
                else:
                    failed += 1
                    print("FETCH_FAILED\t%s\t%s" % (row["title"], type(exc).__name__))
        (folder / "目录.json").write_text(json.dumps(notes, ensure_ascii=False, indent=1), encoding="utf-8")
        return got, had, stale, failed

    songs = [v for v in cat["songs"].values() if (args.any or v["commercial"]) and 20 <= v["seconds"] <= 420
             and (not query or query in (v["title"] + " " + v["author"] + " " + " ".join(v["genres"])).lower())]
    sounds = [v for v in cat["sounds"].values() if not query or query in v["title"].lower()]
    g1 = take("配乐", songs, int(args.songs), tool_home() / "music", ".m4a")
    g2 = take("音效", sounds, int(args.sounds), tool_home() / "sfx", ".mp3")
    print("SONGS fetched=%d already=%d link_expired=%d failed=%d (catalogue has %d)" % (g1 + (len(songs),)))
    print("SOUNDS fetched=%d already=%d link_expired=%d failed=%d (catalogue has %d)" % (g2 + (len(sounds),)))
    if g1[2] or g2[2] or not songs or not sounds:
        print("CATALOGUE_STALE 曲库目录不够新。请用户在剪映里打开「音频」，把想要的音乐分类和音效分类各往下滑几屏（剪映会刷新目录），然后重跑这条命令。")
    print("KOUBO_OK=1")


def stock(args) -> None:
    """Stock footage for a line of the script: what is already in the
    library folder, and a search of the free libraries a key has been set for."""
    import urllib.parse
    import urllib.request
    lib = tool_home() / "broll"
    lib.mkdir(exist_ok=True)
    words = [w for w in re.split(r"[\s,，]+", args.query.lower()) if w]
    have = [f for f in sorted(lib.rglob("*")) if f.suffix.lower() in (".mp4", ".mov", ".m4v") and words and all(w in f.name.lower() for w in words)]
    for f in have[:12]:
        print("LOCAL\t" + str(f))

    def key_of(name: str) -> str:
        f = tool_home() / "keys" / (name + ".key")
        return (os.environ.get(name.upper() + "_API_KEY") or (f.read_text(encoding="utf-8").strip() if f.is_file() else "")).strip()

    want = max(0, int(args.fetch or 0))
    got = 0
    if not (key_of("pexels") or key_of("pixabay")):
        print("STOCK_KEY_MISSING 免费图库要一个免费密钥：到 pexels.com/api 或 pixabay.com/api/docs 注册后，把密钥存成 %s 或 pixabay.key（文件里只放密钥这一行）" % (tool_home() / "keys" / "pexels.key"))
    slug = re.sub(r"[^a-z0-9]+", "-", args.query.lower()).strip("-") or "clip"

    def save(url: str, name: str, credit: str) -> None:
        nonlocal got
        out = lib / name
        if not out.is_file():
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 koubo/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r, open(out, "wb") as fh:
                shutil.copyfileobj(r, fh)
            (lib / "来源.txt").open("a", encoding="utf-8").write("%s\t%s\n" % (name, credit))
        got += 1
        print("FETCHED\t%s\t%s" % (out, credit))

    if want and key_of("pexels"):
        try:
            q = urllib.parse.urlencode({"query": args.query, "orientation": "portrait", "size": "medium", "per_page": max(want, 3)})
            req = urllib.request.Request("https://api.pexels.com/videos/search?" + q, headers={"Authorization": key_of("pexels"), "User-Agent": "koubo/1.0"})
            data = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
            for v in data.get("videos") or []:
                if got >= want:
                    break
                files = sorted([f for f in v.get("video_files") or [] if f.get("file_type") == "video/mp4" and (f.get("height") or 0) >= 1280],
                               key=lambda f: f.get("height") or 0)
                if files and 3 <= (v.get("duration") or 0) <= 60:
                    save(files[0]["link"], "%s-pexels-%s.mp4" % (slug, v["id"]), "Pexels " + str(v.get("url") or ""))
        except Exception as exc:  # noqa: BLE001
            print("STOCK_ERROR pexels " + type(exc).__name__)
    picks = [x for x in re.split(r"[\s,]+", str(getattr(args, "pick", "") or "")) if x]
    if key_of("pixabay") and (got < want or picks or not want):
        try:
            q = urllib.parse.urlencode({"key": key_of("pixabay"), "q": args.query, "per_page": 20, "safesearch": "true", "video_type": "film"})
            req = urllib.request.Request("https://pixabay.com/api/videos/?" + q, headers={"User-Agent": "Mozilla/5.0 koubo/1.0"})
            data = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
            hits = []
            for v in data.get("hits") or []:
                vids = v.get("videos") or {}
                f = vids.get("large") or vids.get("medium") or {}  # a landscape clip is cropped to fill a tall picture, so take the sharpest
                wide, tall = f.get("width") or 0, f.get("height") or 0
                # the picture is tall: an upright clip fits as it is; a lying one loses two thirds of
                # its width to the crop, so only a 4K one stays sharp
                if f.get("url") and 4 <= (v.get("duration") or 0) <= 45 and ((tall > wide and wide >= 1080) or wide >= 3840):
                    hits.append((v, f, vids))
            hits.sort(key=lambda h: 0 if (h[1].get("height") or 0) > (h[1].get("width") or 0) else 1)  # upright clips first
            hits = hits[:12]
            for pid in [x for x in picks if x not in [str(h[0]["id"]) for h in hits]]:
                # a pick from an earlier search: ask for it by its number
                try:
                    q1 = urllib.parse.urlencode({"key": key_of("pixabay"), "id": pid})
                    r1 = urllib.request.Request("https://pixabay.com/api/videos/?" + q1, headers={"User-Agent": "Mozilla/5.0 koubo/1.0"})
                    for v in json.loads(urllib.request.urlopen(r1, timeout=30).read().decode("utf-8")).get("hits") or []:
                        vids = v.get("videos") or {}
                        f = vids.get("large") or vids.get("medium") or {}
                        if f.get("url"):
                            hits.append((v, f, vids))
                except Exception:
                    pass
            if not picks and not want:
                # show what there is, so the choice is made by looking, not by taking the first
                for v, f, vids in hits:
                    shape = "竖屏" if (f.get("height") or 0) > (f.get("width") or 0) else "横屏4K"
                    print("CANDIDATE\t%s\t%ds\t%s %dx%d\t%s" % (v["id"], v["duration"], shape, f.get("width") or 0, f.get("height") or 0, v.get("tags", "")))
                if not hits:
                    print("NO_USABLE_CANDIDATE 这个词没有竖屏或 4K 的素材，换个词")
                try:
                    from PIL import Image, ImageDraw
                    import io
                    cells = []
                    for v, f, vids in hits:
                        thumb = (vids.get("tiny") or {}).get("thumbnail") or (vids.get("small") or {}).get("thumbnail")
                        if not thumb:
                            continue
                        raw = urllib.request.urlopen(urllib.request.Request(thumb, headers={"User-Agent": "Mozilla/5.0 koubo/1.0"}), timeout=20).read()
                        im = Image.open(io.BytesIO(raw)).convert("RGB")
                        im.thumbnail((320, 320))
                        cell = Image.new("RGB", (320, 220), (20, 20, 20))
                        cell.paste(im, ((320 - im.width) // 2, 0))
                        ImageDraw.Draw(cell).text((6, 196), "id %s  %ss" % (v["id"], v["duration"]), fill=(255, 220, 60))
                        cells.append(cell)
                    if cells:
                        cols = 4
                        sheet = Image.new("RGB", (320 * cols, 220 * (-(-len(cells) // cols))), (0, 0, 0))
                        for k, cell in enumerate(cells):
                            sheet.paste(cell, (320 * (k % cols), 220 * (k // cols)))
                        out = lib / ("_候选-%s.jpg" % slug)
                        sheet.save(out, quality=85)
                        print("CANDIDATE_SHEET\t%s" % out)
                except Exception as exc:  # noqa: BLE001
                    print("CANDIDATE_SHEET_UNAVAILABLE " + type(exc).__name__)
            chosen = [h for h in hits if str(h[0]["id"]) in picks] if picks else hits[:max(0, want - got)]
            if picks and len(chosen) < len(picks):
                print("PICK_NOT_FOUND " + ",".join(x for x in picks if x not in [str(h[0]["id"]) for h in hits]))
            if picks or want:
                for v, f, vids in chosen:
                    name = "%s-pixabay-%s.mp4" % (slug, v["id"])
                    save(f["url"], name, "Pixabay " + str(v.get("pageURL") or ""))
                    # what it will look like in the tall picture: three moments, cut the way the draft cuts it
                    prev = lib / ("_预览-%s.jpg" % v["id"])
                    d = float(v.get("duration") or 6)
                    vf = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=270:480"
                    subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-i", str(lib / name), "-vf",
                                    "select='eq(n,0)+gte(t,%.2f)*lt(prev_selected_t,%.2f)+gte(t,%.2f)*lt(prev_selected_t,%.2f)',%s,tile=3x1" % (d * 0.4, d * 0.4, d * 0.8, d * 0.8, vf),
                                    "-frames:v", "1", "-vsync", "0", str(prev)])
                    if prev.is_file():
                        print("PREVIEW\t%s" % prev)
        except Exception as exc:  # noqa: BLE001
            print("STOCK_ERROR pixabay %s %s" % (type(exc).__name__, getattr(exc, "code", "")))
    print("STOCK local=%d fetched=%d" % (len(have), got))
    print("KOUBO_OK=1")


def align(args) -> None:
    """Step one on its own: how far apart the separate recording and the
    video are, and how sure the match is."""
    video = Path(args.video).expanduser().resolve()
    audio = Path(args.audio).expanduser().resolve()
    for f in (video, audio):
        if not f.is_file():
            fail("file-missing " + str(f))
    out = Path(args.out).expanduser().resolve() if args.out else video.parent / (video.stem + ".koubo")
    out.mkdir(parents=True, exist_ok=True)
    wav = out / "align-16k.wav"
    subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-i", str(audio), "-vn", "-ac", "1", "-ar", "16000", str(wav)], check=True)
    offset = audio_offset(video, wav, out)
    try:
        wav.unlink()
    except OSError:
        pass
    (out / "align.json").write_text(json.dumps({"video": str(video), "audio": str(audio), "audio_offset": offset}, ensure_ascii=False), encoding="utf-8")
    print("AUDIO_OFFSET=%.3f" % offset)
    print("KOUBO_OK=1")


def render_cutout(video: Path, start: float, length: float, out: Path) -> bool:
    """The person, without the background, as a video with transparency and a
    white outline. False when the matting package is not installed."""
    try:
        from rembg import new_session, remove
        from PIL import Image, ImageFilter
    except Exception:
        return False
    if out.is_file() and out.stat().st_size > 10000:
        return True
    w, h, fps = 540, 960, 30
    ff = find_ffmpeg()
    src = subprocess.Popen([ff, "-v", "error", "-ss", "%.3f" % start, "-t", "%.3f" % length, "-i", str(video), "-an",
                            "-vf", "fps=%d,scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (fps, w, h, w, h),
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    dst = subprocess.Popen([ff, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "%dx%d" % (w, h), "-r", str(fps), "-i", "-",
                            "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", str(out)], stdin=subprocess.PIPE)
    # u2net_human_seg keeps the person and drops what stands in front of them
    # (flowers, props); the heavier general models keep those too.
    session = new_session(os.environ.get("KOUBO_MATTING_MODEL") or "u2net_human_seg")
    floor = Image.new("L", (w, h), 0)
    floor.paste(255, (0, 0, w, int(h * 0.8)))  # below this is the table, not the person
    size = w * h * 3
    n = 0
    while True:
        buf = src.stdout.read(size)
        if len(buf) < size:
            break
        cut = remove(Image.frombytes("RGB", (w, h), buf), session=session)
        from PIL import ImageChops
        alpha = cut.getchannel("A").filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))  # drops stray specks
        alpha = ImageChops.multiply(alpha, floor)
        cut.putalpha(alpha)
        rim = alpha.filter(ImageFilter.MaxFilter(9))  # the outline is the shape grown outwards
        frame = Image.new("RGBA", (w, h), (255, 255, 255, 0))
        frame.putalpha(rim)
        frame.alpha_composite(cut)
        dst.stdin.write(frame.tobytes())
        n += 1
    dst.stdin.close()
    dst.wait()
    src.wait()
    return n > 0 and out.is_file()


def find_face(video: Path, times: list):
    """Where the presenter's face is, as (x, y) from the middle of the picture
    in half-widths and half-heights (right and up are positive), or None.
    Read off the outline of the person: the head is the top of it."""
    try:
        from rembg import new_session, remove
        from PIL import Image
        import numpy as np
    except Exception:
        return None
    w, h = 360, 640
    session = new_session(os.environ.get("KOUBO_MATTING_MODEL") or "u2net_human_seg")
    found = []
    for t in times:
        raw = subprocess.run([find_ffmpeg(), "-v", "error", "-ss", "%.2f" % t, "-i", str(video), "-frames:v", "1",
                              "-vf", "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (w, h, w, h),
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        if len(raw) < w * h * 3:
            continue
        mask = np.asarray(remove(Image.frombytes("RGB", (w, h), raw[:w * h * 3]), session=session, only_mask=True)) > 128
        rows = np.where(mask.sum(axis=1) >= 8)[0]
        if rows.size < 40:
            continue
        top = int(rows[0])
        band = mask[top:top + int(h * 0.12)]
        xs = np.where(band.any(axis=0))[0]
        if xs.size < 10:
            continue
        head = float(np.median(band.sum(axis=1)))  # how wide the head is
        cx = float(np.where(band)[1].mean())
        cy = top + 0.85 * head
        found.append(((cx - w / 2) / (w / 2), (h / 2 - cy) / (h / 2)))
    if not found:
        return None
    return (round(sum(f[0] for f in found) / len(found), 3), round(sum(f[1] for f in found) / len(found), 3))


def vignette_file(canvas: list, strength: float = 0.93) -> Path:
    """A dark surround with a clear middle, as a picture laid over the clip.
    Jianying 9.7 opened drafts carrying its own vignette effect without
    showing it, so the tool brings its own."""
    from PIL import Image
    import numpy as np
    w, h = int(canvas[0]), int(canvas[1])
    out = tool_home() / "assets" / ("vignette-%dx%d-%d.png" % (w, h, round(strength * 100)))
    if out.is_file():
        return out
    out.parent.mkdir(exist_ok=True)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # an upright oval around where a seated presenter is: clear inside, black by the corners
    r = np.sqrt(((xx - w * 0.5) / (w * 0.62)) ** 2 + ((yy - h * 0.46) / (h * 0.50)) ** 2)
    a = np.clip((r - 0.62) / 0.42, 0, 1) ** 1.4 * strength
    img = np.zeros((h, w, 4), dtype=np.uint8)
    img[..., 3] = (a * 255).astype(np.uint8)
    Image.fromarray(img, "RGBA").save(out)
    return out


def cjk_font(size: int):
    """A bold Chinese face for the few words the tool draws itself."""
    from PIL import ImageFont
    for f in (r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
              "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"):
        if os.path.isfile(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                continue
    return None


def drawn(name: str, make) -> Path:
    """A picture the tool draws once and keeps."""
    out = tool_home() / "assets" / name
    if not out.is_file():
        out.parent.mkdir(exist_ok=True)
        make().save(out)
    return out


def dim_file(canvas: list, amount: float) -> Path:
    from PIL import Image
    w, h = int(canvas[0]), int(canvas[1])
    return drawn("dim-%dx%d-%d.png" % (w, h, round(amount * 100)), lambda: Image.new("RGBA", (w, h), (0, 0, 0, int(255 * amount))))


def card_mask_file(w: int, h: int, radius: int) -> Path:
    from PIL import Image, ImageDraw

    def make():
        im = Image.new("L", (w, h), 0)
        ImageDraw.Draw(im).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
        return im
    return drawn("mask-card-%dx%d-%d.png" % (w, h, radius), make)


def circle_mask_file(d: int) -> Path:
    from PIL import Image, ImageDraw

    def make():
        im = Image.new("L", (d * 2, d * 2), 0)
        ImageDraw.Draw(im).ellipse((0, 0, d * 2 - 1, d * 2 - 1), fill=255)
        return im.resize((d, d))
    return drawn("mask-circle-%d.png" % d, make)


def card_deco_file(canvas: list, scale: float, radius: int, accent: str) -> Path:
    """What sits around the smaller picture: a soft shadow and a hairline."""
    from PIL import Image, ImageDraw, ImageFilter
    w, h = int(canvas[0]), int(canvas[1])

    def make():
        cw, ch = int(w * scale), int(h * scale)
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((x0 - 6, y0 + 14, x0 + cw + 6, y0 + ch + 26), radius=radius, fill=(0, 0, 0, 170))
        shadow = shadow.filter(ImageFilter.GaussianBlur(28))
        hole = Image.new("L", (w, h), 255)
        ImageDraw.Draw(hole).rounded_rectangle((x0, y0, x0 + cw, y0 + ch), radius=radius, fill=0)
        shadow.putalpha(Image.composite(shadow.getchannel("A"), Image.new("L", (w, h), 0), hole))
        r, g, b = [int(c * 255) for c in rgb(accent)]
        ImageDraw.Draw(shadow).rounded_rectangle((x0, y0, x0 + cw, y0 + ch), radius=radius, outline=(r, g, b, 235), width=3)
        return shadow
    return drawn("deco-card-%dx%d-%d-%d-%s.png" % (w, h, round(scale * 100), radius, accent.strip("#")), make)


def ring_deco_file(canvas: list, cx: float, cy: float, d: float, accent: str) -> Path:
    """Around the round window: a soft shadow and a ring."""
    from PIL import Image, ImageDraw, ImageFilter
    w, h = int(canvas[0]), int(canvas[1])

    def make():
        big = 2
        im = Image.new("RGBA", (w * big, h * big), (0, 0, 0, 0))
        box = [int((cx - d / 2) * big), int((cy - d / 2) * big), int((cx + d / 2) * big), int((cy + d / 2) * big)]
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse((box[0] - 10, box[1] + 20, box[2] + 10, box[3] + 44), fill=(0, 0, 0, 160))
        sh = sh.filter(ImageFilter.GaussianBlur(50))
        hole = Image.new("L", im.size, 255)
        ImageDraw.Draw(hole).ellipse(box, fill=0)
        sh.putalpha(Image.composite(sh.getchannel("A"), Image.new("L", im.size, 0), hole))
        r, g, b = [int(c * 255) for c in rgb(accent)]
        ImageDraw.Draw(sh).ellipse(box, outline=(r, g, b, 240), width=7 * big)
        return sh.resize((w, h))
    return drawn("deco-ring-%dx%d-%d-%d-%d-%s.png" % (w, h, round(cx), round(cy), round(d), accent.strip("#")), make)


def lower_third_file(canvas: list, top: float, bottom: float, accent: str) -> Path:
    """Behind the presenter's name: a band that fades to nothing on the right, with a short accent line."""
    from PIL import Image, ImageDraw
    import numpy as np
    w, h = int(canvas[0]), int(canvas[1])

    def make():
        y0, y1 = int(top), int(bottom)
        a = np.zeros((h, w), dtype=np.float32)
        ramp = np.clip(1.0 - np.arange(w, dtype=np.float32) / (w * 0.78), 0, 1) ** 1.3
        edge = np.clip(np.minimum(np.arange(y1 - y0), np.arange(y1 - y0)[::-1]) / 26.0, 0, 1)
        a[y0:y1, :] = 0.62 * ramp[None, :] * edge[:, None]
        img = np.zeros((h, w, 4), dtype=np.uint8)
        img[..., 3] = (a * 255).astype(np.uint8)
        im = Image.fromarray(img, "RGBA")
        r, g, b = [int(c * 255) for c in rgb(accent)]
        ImageDraw.Draw(im).rounded_rectangle((44, y0 + 34, 51, y1 - 34), radius=3, fill=(r, g, b, 255))
        return im
    return drawn("lower-third-%dx%d-%d-%d-%s.png" % (w, h, int(top), int(bottom), accent.strip("#")), make)


def chip_file(canvas: list, number: int, title: str, accent: str):
    """The small chapter mark kept in the top corner while a chapter runs."""
    from PIL import Image, ImageDraw
    import hashlib
    w, h = int(canvas[0]), int(canvas[1])
    f_num, f_txt = cjk_font(40), cjk_font(44)
    if f_txt is None:
        return None

    def make():
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        num = "%02d" % number
        wn = d.textlength(num, font=f_num)
        wt = d.textlength(title, font=f_txt)
        x, y, pad = 48, 128, 26
        box = (x, y, int(x + pad + wn + 22 + wt + pad), y + 80)
        d.rounded_rectangle(box, radius=40, fill=(0, 0, 0, 125))
        r, g, b = [int(c * 255) for c in rgb(accent)]
        d.text((x + pad, y + 16), num, font=f_num, fill=(r, g, b, 255))
        d.rectangle((x + pad + wn + 10, y + 24, x + pad + wn + 12, y + 56), fill=(255, 255, 255, 110))
        d.text((x + pad + wn + 22, y + 12), title, font=f_txt, fill=(255, 255, 255, 240))
        return im
    key = hashlib.md5(("v2|%d|%s|%s|%dx%d" % (number, title, accent, w, h)).encode()).hexdigest()[:10]
    return drawn("chip-%s.png" % key, make)


def render_masked(video: Path, start: float, length: float, out: Path, mask: Path, crop: str, w: int, h: int) -> bool:
    """A piece of the footage cut to a shape (the mask's white part), as a video with transparency."""
    if out.is_file() and out.stat().st_size > 10000:
        return True
    run = subprocess.run([find_ffmpeg(), "-v", "error", "-y", "-ss", "%.3f" % start, "-t", "%.3f" % (length + 0.1), "-i", str(video), "-loop", "1", "-i", str(mask),
                          "-filter_complex", "[0:v]fps=30,%s,scale=%d:%d,format=rgb24,tpad=stop_mode=clone:stop_duration=0.3[v];[1:v]scale=%d:%d,format=gray[m];[v][m]alphamerge[o]" % (crop, w, h, w, h),
                          "-map", "[o]", "-an", "-t", "%.3f" % (length + 0.1), "-c:v", "prores_ks", "-profile:v", "4444", "-q:v", "13", "-pix_fmt", "yuva444p10le", str(out)])
    return run.returncode == 0 and out.is_file()


_h264: dict = {}


def h264_args(fine: bool) -> list:
    """How to write H.264 on this machine. Builds of ffmpeg differ in which
    encoders they carry, so the first one that really works here is used."""
    if "name" not in _h264:
        ff = find_ffmpeg()
        for name in ("libx264", "h264_nvenc", "h264_videotoolbox", "libopenh264", "mpeg4"):
            try:
                ok = subprocess.run([ff, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=0.3", "-c:v", name, "-pix_fmt", "yuv420p", "-f", "null", "-"],
                                    capture_output=True, timeout=60).returncode == 0
            except Exception:
                ok = False
            if ok:
                _h264["name"] = name
                break
        else:
            _h264["name"] = ""
    name = _h264["name"]
    if name == "libx264":
        return ["-c:v", name, "-preset", "ultrafast" if fine else "veryfast", "-crf", "10" if fine else "15"]
    if name == "h264_nvenc":
        return ["-c:v", name, "-preset", "p4", "-rc", "constqp", "-qp", "12" if fine else "17"]
    if name == "h264_videotoolbox":
        return ["-c:v", name, "-b:v", "90M" if fine else "45M"]
    if name == "libopenh264":
        return ["-c:v", name, "-b:v", "90M" if fine else "45M"]
    if name == "mpeg4":
        return ["-c:v", name, "-q:v", "1" if fine else "2"]
    return []


def stabilise(video: Path, start: float, length: float, out: Path, size: tuple, crop: float = 1.05, smooth: float = 1.5) -> bool:
    """A stretch of the footage with the camera's own movement taken out.

    The camera's path is followed frame by frame on a small copy (how the
    background moves from one frame to the next), smoothed, and each frame
    is shifted and turned back onto the smooth path. The picture is enlarged
    by `crop` so the moved edges never show. The sound comes along."""
    if out.is_file() and out.stat().st_size > 10000:
        return True
    try:
        import cv2
        import numpy as np
    except Exception:
        return False
    ff = find_ffmpeg()
    if not h264_args(True):
        return False
    w, h = int(size[0]) // 2 * 2, int(size[1]) // 2 * 2
    aw = 540
    ah = int(aw * h / w) // 2 * 2
    fps = "30"
    try:
        from pymediainfo import MediaInfo
        for tr0 in MediaInfo.parse(str(video)).tracks:
            if tr0.track_type == "Video" and tr0.frame_rate:
                fps = str(tr0.frame_rate)
                break
    except Exception:
        pass
    rough = out.with_name(out.stem + ".rough.mp4")
    span = length + 3.0 / float(fps)  # a little over: the clip laid on it must never outlast it
    try:
        src = subprocess.Popen([ff, "-v", "error", "-y", "-ss", "%.3f" % start, "-t", "%.3f" % span, "-i", str(video), "-filter_complex",
                                "[0:v]scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,split[a][b];[b]scale=%d:%d,format=gray[g]" % (w, h, w, h, aw, ah),
                                "-map", "[a]", "-an"] + h264_args(True) + ["-pix_fmt", "yuv420p", str(rough),
                                "-map", "[g]", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
        ref, pts, path = None, None, []
        last = (0.0, 0.0, 0.0)
        cx, cy = aw / 2.0, ah / 2.0
        while True:
            buf = src.stdout.read(aw * ah)
            if len(buf) < aw * ah:
                break
            g = np.frombuffer(buf, np.uint8).reshape(ah, aw)
            if ref is None:
                # every frame is measured against the first one, so errors do not add up over the clip
                ref = g.copy()
                pts = cv2.goodFeaturesToTrack(ref, 600, 0.01, 7)
            elif pts is not None and len(pts) >= 20:
                nxt, ok, _ = cv2.calcOpticalFlowPyrLK(ref, g, pts, None, winSize=(25, 25), maxLevel=3)
                good = ok.ravel() == 1
                if good.sum() >= 20:
                    # the background outvotes the person: whatever moves on its own is left out of the fit
                    m, _ = cv2.estimateAffinePartial2D(pts[good], nxt[good], method=cv2.RANSAC, ransacReprojThreshold=1.0)
                    if m is not None:
                        last = (m[0, 0] * cx + m[0, 1] * cy + m[0, 2] - cx, m[1, 0] * cx + m[1, 1] * cy + m[1, 2] - cy, float(np.arctan2(m[1, 0], m[0, 0])))
            path.append(last)
        src.wait()
        n = len(path)
        if n < 3 or not rough.is_file():
            return False
        path = np.array(path)
        up = w / float(aw)
        room = (crop - 1.0) / 2.0 * 0.9
        if (np.ptp(path[:, 0]) * up <= room * w * 1.6) and (np.ptp(path[:, 1]) * up <= room * h * 1.6):
            # a camera that was meant to stand still: hold it still
            calm = np.tile(np.median(path, axis=0), (n, 1))
        else:
            # a camera that was moving on purpose: keep the move, take out the shake
            sigma = max(1.0, smooth * float(fps))
            k = np.arange(-int(3 * sigma), int(3 * sigma) + 1)
            ker = np.exp(-k * k / (2 * sigma * sigma))
            ker /= ker.sum()
            pad = len(k) // 2
            calm = np.stack([np.convolve(np.pad(path[:, i], (pad, pad), mode="edge"), ker, "valid") for i in range(3)], axis=1)
        fix = calm - path
        fix[:, 0] = np.clip(fix[:, 0] * up, -room * w, room * w)
        fix[:, 1] = np.clip(fix[:, 1] * up, -room * h, room * h)
        fix[:, 2] = np.clip(fix[:, 2], -0.01, 0.01)
        dec = subprocess.Popen([ff, "-v", "error", "-i", str(rough), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
        enc = subprocess.Popen([ff, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", "%dx%d" % (w, h), "-r", fps, "-i", "-",
                                "-ss", "%.3f" % start, "-t", "%.3f" % span, "-i", str(video), "-map", "0:v", "-map", "1:a?",
                                ] + h264_args(False) + ["-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k", str(out)], stdin=subprocess.PIPE)
        for i in range(n):
            buf = dec.stdout.read(w * h * 3)
            if len(buf) < w * h * 3:
                break
            frame = np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            m = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), -float(np.degrees(fix[i, 2])), crop)
            m[0, 2] += fix[i, 0]
            m[1, 2] += fix[i, 1]
            enc.stdin.write(cv2.warpAffine(frame, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).tobytes())
        enc.stdin.close()
        enc.wait()
        dec.kill()
    except Exception:
        return False
    finally:
        try:
            rough.unlink()
        except OSError:
            pass
    return out.is_file() and out.stat().st_size > 10000


FONT_FILES = {
    "SourceHanSerifCN-Bold.otf": "https://github.com/adobe-fonts/source-han-serif/raw/release/SubsetOTF/CN/SourceHanSerifCN-Bold.otf",
    "SourceHanSerifCN-SemiBold.otf": "https://github.com/adobe-fonts/source-han-serif/raw/release/SubsetOTF/CN/SourceHanSerifCN-SemiBold.otf",
    "SourceHanSerifCN-Regular.otf": "https://github.com/adobe-fonts/source-han-serif/raw/release/SubsetOTF/CN/SourceHanSerifCN-Regular.otf",
    "SourceHanSansCN-Medium.otf": "https://github.com/adobe-fonts/source-han-sans/raw/release/SubsetOTF/CN/SourceHanSansCN-Medium.otf",
    "SourceHanSansCN-Regular.otf": "https://github.com/adobe-fonts/source-han-sans/raw/release/SubsetOTF/CN/SourceHanSansCN-Regular.otf",
    "SourceHanSansCN-Heavy.otf": "https://github.com/adobe-fonts/source-han-sans/raw/release/SubsetOTF/CN/SourceHanSansCN-Heavy.otf",
    "SourceHanSerifCN-Heavy.otf": "https://github.com/adobe-fonts/source-han-serif/raw/release/SubsetOTF/CN/SourceHanSerifCN-Heavy.otf",
    # 得意黑 (Smiley Sans, open licence) comes as a zip; the part after # is the file inside it
    "SmileySans-Oblique.ttf": "https://github.com/atelier-anchor/smiley-sans/releases/download/v2.0.1/smiley-sans-v2.0.1.zip#SmileySans-Oblique.ttf",
}


def ensure_fonts() -> int:
    """The design's typefaces (Source Han Serif and Sans, open licence), fetched
    once into the tool's fonts folder. Without them the system's Chinese font is used."""
    import urllib.request
    folder = tool_home() / "fonts"
    folder.mkdir(exist_ok=True)
    missing = 0
    for name, url in FONT_FILES.items():
        f = folder / name
        if f.is_file() and f.stat().st_size > 1000000:
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 koubo/1.0"})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            if "#" in url:
                import io
                import zipfile
                with zipfile.ZipFile(io.BytesIO(data)) as z:
                    data = z.read(next(n for n in z.namelist() if n.endswith(url.split("#")[1])))
            if len(data) > 1000000:
                f.write_bytes(data)
            else:
                missing += 1
        except Exception:
            missing += 1
    return missing


def render_anim(fn, seconds: float, size: tuple, out: Path, fps: int = 30):
    """A designed element as a short video with transparency: `fn(p)` is the
    picture `p` seconds in. Returns the file, or None when it could not be made."""
    if out.is_file() and out.stat().st_size > 2000:
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    n = max(2, int(seconds * fps + 0.999) + 2)  # two frames over: the clip it sits on must never outlast it
    w, h = size
    proc = subprocess.Popen([find_ffmpeg(), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "%dx%d" % (w, h), "-r", str(fps), "-i", "-",
                             "-c:v", "prores_ks", "-profile:v", "4444", "-q:v", "11", "-pix_fmt", "yuva444p10le", str(out)], stdin=subprocess.PIPE)
    try:
        for i in range(n):
            proc.stdin.write(fn(i / fps).tobytes())
        proc.stdin.close()
    except Exception:
        proc.kill()
        return None
    proc.wait()
    return out if proc.returncode == 0 and out.is_file() else None


def wrap_words(text: str, width: int) -> list:
    """A line of Chinese broken between words into lines of at most `width` characters."""
    try:
        import jieba
        import logging
        jieba.setLogLevel(logging.ERROR)
        words = [w for w in jieba.cut(text) if w]
    except Exception:
        words = list(text)
    lines, cur = [], ""
    for w in words:
        if cur and len(cur) + len(w) > width:
            lines.append(cur)
            cur = w
        else:
            cur += w
    if cur:
        lines.append(cur)
    if len(lines) >= 2 and len(lines[-1]) <= 2:  # no widow
        lines[-2:] = [lines[-2] + lines[-1]]
    return lines


def quote_lines(text: str, hot: str) -> list:
    """A pull quote on one line when it is short, otherwise on two of about the
    same length, broken between words - before the key word when that reads well."""
    if len(text) <= 7:
        return [text]
    try:
        import jieba
        import logging
        jieba.setLogLevel(logging.ERROR)
        words = [w for w in jieba.cut(text) if w]
    except Exception:
        words = list(text)
    cuts, at = [], 0
    for w in words[:-1]:
        at += len(w)
        cuts.append(at)
    if not cuts:
        return [text]
    h = text.find(hot) if hot else -1
    if h >= 3 and len(text) - h <= 9 and h in cuts:
        best = h
    else:
        best = min(cuts, key=lambda c: abs(c - len(text) / 2))
    return [text[:best], text[best:]]


def render_circle(video: Path, start: float, length: float, out: Path, face_y: float, face_x: float = 0.0) -> bool:
    """The face in a round window with a white ring, as a video with
    transparency. Made here because Jianying 9.7 ignored a mask in the draft."""
    if out.is_file() and out.stat().st_size > 10000:
        return True
    w, h, d = 720, 1280, 560
    c = 440  # the square taken from the picture, then enlarged to d
    top = max(0, min(h - c, int(h / 2 - face_y * h / 2 - c / 2)))
    left = max(0, min(w - c, int(w / 2 + face_x * w / 2 - c / 2)))
    crop = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,crop=%d:%d:%d:%d" % (w, h, w, h, c, c, left, top)
    return render_masked(video, start, length, out, circle_mask_file(d), crop, d, d)


def add_beauty(draft_file: Path, sliders: dict) -> int:
    """Write Jianying's beauty sliders onto every clip of the main track.
    Jianying works the faces out itself when it opens the draft."""
    import uuid
    d = json.loads(draft_file.read_text(encoding="utf-8"))
    holder = str(uuid.uuid4()).upper()
    effects = d["materials"].setdefault("effects", [])

    def figure(name, rid, sub, kind, value, path, key="", param="1", mtype="figure", cat="auto-beauty2"):
        fid = uuid.uuid4().hex
        effects.append({
            "adjust_params": [{"default_value": 0.0, "name": param, "value": value}] if kind == "adjust" else [],
            "algorithm_artifact_path": path, "apply_target_type": 0, "bloom_params": None,
            "category_id": cat, "category_name": "",
            "color_match_info": {"source_feature_path": "", "target_feature_path": "", "target_image_path": ""},
            "effect_id": "", "enable_skin_tone_correction": False, "exclusion_group": [], "face_adjust_params": [],
            "formula_id": "", "id": fid, "intensity_key": key, "multi_language_current": "", "name": name,
            "panel_id": "", "platform": "all", "request_id": "", "resource_id": rid, "source_platform": 0,
            "sub_type": sub, "time_range": None, "type": mtype, "value": value if kind == "value" else 0.0, "version": "",
        })
        return fid

    done = 0
    for track in d["tracks"]:
        if track.get("type") != "video" or track.get("name") != "主轨":
            continue
        for seg in track["segments"]:
            path = "##_draftpath_placeholder_%s_##/video/figure_algorithm/%s" % (holder, seg["material_id"])
            refs = seg.setdefault("extra_material_refs", [])
            for name, amount in sliders.items():
                if name not in BEAUTY or not amount:
                    continue
                rid, sub, kind, needs, key, param = BEAUTY[name]
                refs.append(figure(name, rid, sub, kind, max(0.0, min(100.0, float(amount))) / 100.0, path if needs else "", key, param,
                                   cat=BEAUTY_PANEL.get(name, "auto-beauty2")))
            refs.append(figure("makeup-root", MAKEUP_ROOT, "auto_beauty", "value", 0.0, path, mtype="makeup_root", cat=""))
            done += 1
    draft_file.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return done


def build(args) -> None:
    import pyJianYingDraft as jy
    from pyJianYingDraft import ClipSettings, TextBorder, TextShadow, TextStyle, TrackType

    plan_path = Path(args.plan).expanduser().resolve()
    plan = json.loads(plan_path.read_text(encoding="utf-8-sig"))
    tpath = Path(plan.get("transcript") or "")
    if not tpath.is_absolute():
        tpath = plan_path.parent / tpath
    if not tpath.is_file():
        fail("transcript-missing " + str(tpath))
    seal = tpath.with_name("transcript.seal")
    if seal.is_file() and seal.read_text(encoding="utf-8").strip() != hashlib.sha1(tpath.read_bytes()).hexdigest():
        fail("transcript-edited (转写文件被改过。里面的字和时间是一一对应的：删了字，那段声音还在成片里；改了字数，剪辑点和字幕就错位。"
             "先重跑 koubo transcribe <视频> --reuse 恢复，再把错字写进计划的 fix，把不要的词写进那一句的 cut)")
    tr = json.loads(tpath.read_text(encoding="utf-8"))
    video = Path(plan.get("video") or tr["video"])
    if not video.is_file():
        fail("video-missing " + str(video))
    by_id = {s["id"]: s for s in tr["sentences"]}
    style = load_style(str(plan.get("style") or "默认"))
    chapters = []  # (first sentence id, title) for every titled chapter
    for sec0 in plan.get("sections") or []:
        ids0 = [(x if isinstance(x, int) else x.get("id")) for x in (sec0.get("keep") or [])]
        if str(sec0.get("title") or "").strip() and ids0 and ids0[0] is not None:
            chapters.append((int(ids0[0]), str(sec0["title"]).strip()))
    sound_marks = expand_sections(plan, style, by_id)
    C_TEXT, C_HOT, C_EDGE = rgb(style["配色"]["正文"]), rgb(style["配色"]["强调"]), rgb(style["配色"]["描边"])

    def font(kind: str):
        want = str(style["字体"].get(kind) or "")
        if not want:
            return None
        if want not in jy.FontType.__members__:
            print("FONT_UNKNOWN %s (%s 用默认字体)" % (want, kind))
            return None
        return jy.FontType[want]

    def edge(spec: dict, color=None):
        w = float(spec.get("描边", 0) or 0)
        return TextBorder(color=color or C_EDGE, width=w) if w > 0 else None

    def shade(spec: dict):
        a = float(spec.get("阴影", 0) or 0)
        return TextShadow(alpha=min(1.0, a), distance=5.0, diffuse=20.0) if a > 0 else None

    kept = keep_list(plan, by_id)
    # words the recogniser got wrong, put right where they are shown: {"heard": "meant"}.
    # The transcript itself is left alone, so times and ids keep meaning what they meant.
    fixes = sorted(((str(a), str(b)) for a, b in (plan.get("fix") or {}).items() if str(a)), key=lambda ab: -len(ab[0]))

    def fx(text0: str) -> str:
        for a0, b0 in fixes:
            text0 = text0.replace(a0, b0)
        return text0
    if ensure_fonts():
        print("FONTS_MISSING 设计字体没取全，这次用系统字体代替（宋体标题会变成黑体）")
    import design as D
    roles = {}
    for item0 in plan.get("keep") or []:
        if isinstance(item0, dict) and "id" in item0 and item0.get("role"):
            roles[int(item0["id"])] = item0["role"]
    heading_of = {}
    for sec0 in plan.get("sections") or []:
        for x0 in sec0.get("keep") or []:
            sid0 = x0 if isinstance(x0, int) else x0.get("id")
            if sid0 is not None:
                heading_of[int(sid0)] = str(sec0.get("title") or "").strip()
    # A run of points made one after another is shown as a list that builds:
    # footage in a card above, the points below, the one being said lit.
    lists = []
    if style.get("分屏清单"):
        run = []
        for row in kept + [None]:
            s0 = by_id[row["id"]] if row else None
            sid0 = s0.get("of", s0["id"]) if s0 else None
            # a run of short parallel phrases is a list whether or not the plan says so
            named = bool(row) and roles.get(sid0) == "列举"
            fits = bool(row) and (named or (roles.get(sid0) is None and len(s0["text"]) <= 8)) and not row.get("glued") and "of" not in s0 \
                and len(s0["text"]) <= 10 and (row.get("look") in (None, "plain"))
            if fits:
                run.append(row)
                continue
            if len(run) >= (2 if all(roles.get(by_id[r["id"]]["id"]) == "列举" for r in run) else 3):
                items = [fx(by_id[r["id"]]["text"]) for r in run]
                head = heading_of.get(by_id[run[0]["id"]]["id"], "")
                for k0, r in enumerate(run):
                    r["look"], r["solo"], r["list"] = "list", True, (len(lists), k0)
                lists.append({"items": items, "heading": head})
            run = []
    keep_rhythm(kept, by_id, style, float((plan.get("title") or {}).get("seconds", style["人名条"]["时长"])) if (plan.get("title") or {}).get("name") else 0.0,
                {int(b["id"]) for b in (plan.get("broll") or []) if "id" in b})
    warnings = lint(kept, by_id)
    off = [r for r in kept if by_id[r if isinstance(r, int) else r["id"]].get("near") is False] if kept and not plan.get("allow_far") else []
    if off:
        # a sentence spoken off screen plays over a presenter whose mouth is shut
        ids = [by_id[r if isinstance(r, int) else r["id"]].get("of", r if isinstance(r, int) else r["id"]) for r in off]
        fail("offscreen-voice-kept %s (这些句子是镜头外的人说的，转写里标着「远」。换成出镜的人自己说的那一遍；确实要用画外音就在计划里写 \"allow_far\": true)" % sorted(set(ids)))
    global ZOOMS, SUB_MAX
    ZOOMS = tuple(float(z) for z in style["景别"])
    SUB_MAX = int(style["字幕"]["每行最多"])
    clips = clips_of(kept, by_id, float(tr.get("duration") or 0), float(tr.get("audio_offset") or 0.0))
    if plan.get("package"):
        k = 0
        for c in clips[1:]:  # the opening clip stays plain: the name title sits on it
            if c["look"] is None:
                c["look"] = AUTO_LOOKS[k % len(AUTO_LOOKS)]
                k += 1
    # the style's limits: too much dressing reads as noise
    cap = style["上限"]
    count = {}
    for c in clips:
        look = c["look"] or "plain"
        count[look] = count.get(look, 0) + 1
        over = (look in ("circle", "cutout") and count[look] > int(cap.get(look, 99))) or \
               (look == "spot" and count[look] > max(1, len(clips) * float(cap.get("spot占比", 1)))) or \
               (look == "frame" and count[look] > max(1, len(clips) * float(cap.get("frame占比", 1))))
        if over:
            c["look"] = "spot" if look in ("circle", "cutout") and count.get("spot", 0) < max(1, len(clips) * float(cap.get("spot占比", 1))) else "plain"

    root = draft_root(plan)
    if not root.is_dir():
        fail("draft-root-missing " + str(root))
    name = re.sub(r'[\\/:*?"<>|]', "_", str(plan.get("name") or (video.stem + "-粗剪"))).strip() or "粗剪"
    canvas = plan.get("canvas") or style["画布"]
    try:
        script = jy.DraftFolder(str(root)).create_draft(name, int(canvas[0]), int(canvas[1]), fps=int(plan.get("fps") or style["帧率"]), allow_replace=True)
    except PermissionError:
        fail("draft-in-use %s (这条草稿正在剪映里开着。请用户先退回剪映首页，或者给草稿换个名字)" % name)
    for track0 in ("主轨", "暗底", "氛围", "暗角", "空镜", "抠像", "装饰", "幕布", "版式", "关键词", "字幕图", "人名", "角标", "进度"):
        script.append_track(jy.TrackSpec(TrackType.video, track0))
    script.append_track(jy.TrackSpec(TrackType.text, "字幕"))
    script.append_track(jy.TrackSpec(TrackType.text, "大字"))
    script.append_track(jy.TrackSpec(TrackType.text, "人名条"))
    script.append_track(jy.TrackSpec(TrackType.text, "标题卡"))

    mat = jy.VideoMaterial(str(video))
    # A phone or camera held upright stores a landscape picture plus a
    # rotation flag; the picture people see is the rotated one.
    try:
        from pymediainfo import MediaInfo
        rot = 0.0
        for t in MediaInfo.parse(str(video)).tracks:
            if t.track_type == "Video":
                rot = float(t.rotation or 0)
                break
        if int(round(rot)) % 180 == 90:
            mat.width, mat.height = mat.height, mat.width
    except Exception:
        pass

    # where the face is: zooming keeps it in place, the round window is cut around it
    face_x, face_y = 0.0, 0.28
    if "face_y" in plan or "face_x" in plan:
        face_x, face_y = float(plan.get("face_x", 0.0)), float(plan.get("face_y", 0.28))
    else:
        mids = [(c["a"] + c["b"]) / 2 + float(tr.get("audio_offset") or 0.0) for c in clips]
        seen = find_face(video, mids[:: max(1, len(mids) // 3)][:3])
        if seen:
            face_x, face_y = seen
            print("FACE=%.2f,%.2f" % seen)
    sec = jy.SEC
    highlight = [str(w) for w in (plan.get("highlight") or []) if str(w)]
    big = {int(b["id"]): str(b["text"]) for b in (plan.get("big") or []) if b.get("text")}
    place = {}  # sentence id -> time on the timeline where it starts
    t = 0.0
    sub_style = dict(size=float(plan.get("sub_size", style["字幕"]["字号"])), bold=bool(style["字幕"].get("加粗")), color=C_TEXT, align=1, auto_wrapping=True, max_line_width=0.9)
    sub_y = float(plan.get("sub_y", style["字幕"]["位置"]))

    class Sub(jy.TextSegment):
        """Subtitle line whose highlighted words are a second colour."""
        marks: list = []

        def export_material(self):
            m = super().export_material()
            if not self.marks:
                return m
            content = json.loads(m["content"])
            base = content["styles"][0]
            cuts = sorted(set([0, len(self.text)] + [x for a, b in self.marks for x in (a, b)]))
            styles = []
            for a, b in zip(cuts, cuts[1:]):
                st = json.loads(json.dumps(base))
                st["range"] = [a, b]
                if any(ma <= a and b <= mb for ma, mb in self.marks):
                    st["fill"]["content"]["solid"]["color"] = list(C_HOT)
                styles.append(st)
            content["styles"] = styles
            m["content"] = json.dumps(content, ensure_ascii=False)
            return m

    ext_audio = tr.get("audio")
    shift = float(tr.get("audio_offset") or 0.0)
    amat = None
    if ext_audio:
        if not Path(ext_audio).is_file():
            fail("audio-missing " + str(ext_audio))
        script.append_track(jy.TrackSpec(TrackType.audio, "人声"))
        amat = jy.AudioMaterial(str(ext_audio))

    n_subs = 0
    sub_end = 0.0
    big_end = 0.0
    card_end = 0.0
    looks_used = {}
    busy = []  # stretches where a full layout holds the screen
    import hashlib
    from PIL import Image
    # The rendered pieces are large (a gigabyte or two for a long video), so
    # they live beside the tool, not beside the footage: footage is often on
    # the desktop, and a full system drive stops everything.
    cut_dir = tpath.parent / "cutout"
    if not any(cut_dir.glob("stab-*.mp4")):
        cut_dir = tool_home() / "work" / ("%s-%s" % (re.sub(r'[\\/:*?"<>|\s]+', "_", video.stem)[:40], hashlib.md5(str(video).encode("utf-8")).hexdigest()[:8]))
    cut_dir.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(str(cut_dir)).free / 1e9
    if free < 5:
        fail("disk-almost-full %s 只剩 %.1f GB（出一条草稿要几个 GB 的空间）。请用户先腾出空间" % (cut_dir.anchor or cut_dir, free))
    cut_dir.mkdir(exist_ok=True)
    title_secs = float((plan.get("title") or {}).get("seconds", style["人名条"]["时长"])) if (plan.get("title") or {}).get("name") else 0.0
    stab = style.get("防抖") or {}
    n_stab = stab_missed = 0
    drawn_subs = str(style["字幕"].get("方式", "绘制")) == "绘制"
    # speech is brought to a normal listening level: recordings come in anywhere from loud to barely audible
    said_db = [by_id[x]["db"] for c0 in clips for x in c0["ids"] if by_id[x].get("db", -99) > -70]
    voice_gain = 1.0
    if said_db:
        mean_db = 10 * math.log10(sum(10 ** (d / 10) for d in said_db) / len(said_db))
        voice_gain = round(min(8.0, max(0.5, 10 ** ((float(style.get("人声响度", -14)) - mean_db) / 20))), 2)
        print("VOICE_LEVEL=%.1fdB GAIN=x%.2f" % (mean_db, voice_gain))
    for c in clips:
        length = c["b"] - c["a"]
        if length < 0.3:
            continue  # a scrap this short only flashes; nothing can be said in it
        z = c["zoom"]
        look = c["look"] or "plain"
        cut_file = None
        if look in ("cutout", "circle"):
            look = "quote" if look == "cutout" else "frame"  # the older names for these
        said_all = "".join(by_id[x]["text"] for x in c["ids"])
        if look == "quote" and (len(said_all) > 16 or length < 1.0):
            look = "spot"  # a pull quote is one short line; a long one stays a normal picture
        if look in ("spot", "frame") and length > 3.2:
            look = "plain"  # a dress is for one short phrase; over a long one it reads as a mistake
        if c is clips[-1] and style.get("片尾") and look in ("plain", "spot") and 1.2 <= length <= 5.0 and len(clips) > 3 \
                and re.search(r"评论|关注|点赞|收藏|转发|私信|留言", said_all):  # only a real sign-off becomes the end card
            look = "end"
        if title_secs and t < title_secs and look in ("quote", "list", "frame"):
            print("LOOK_SKIPPED %s at %s: the name title is on screen" % (look, clock(t)))
            look = "plain"
        accent = str(style.get("点缀色", "#E7C27D"))
        # the stretch of footage this clip shows: the camera's shake taken out first, when the style asks
        src, src_at, src_mat = video, c["a"] + shift, mat
        if stab.get("开"):
            sf = cut_dir / ("stab-%d-%d.mp4" % (round((c["a"] + shift) * 1000), round(length * 1000)))
            if stabilise(video, c["a"] + shift, length, sf, (canvas[0] * 4 // 3, canvas[1] * 4 // 3), float(stab.get("裁切", 1.05)), float(stab.get("平滑秒", 1.5))):
                src, src_at, src_mat = sf, 0.0, jy.VideoMaterial(str(sf))
                n_stab += 1
            else:
                stab_missed += 1

        def still(png: Path, track: str) -> None:
            # a layer meant to cover the picture is laid a little larger than it, so no edge of the footage shows round it
            over = ClipSettings(scale_x=1.04, scale_y=1.04) if track in ("暗底", "暗角", "氛围", "幕布") else ClipSettings()
            script.add_segment(jy.VideoSegment(jy.VideoMaterial(str(png)), jy.Timerange(int(round(t * sec)), int(round(length * sec))),
                                               source_timerange=jy.Timerange(0, int(round(length * sec))), volume=0.0, clip_settings=over), track)

        if look == "circle":
            cut_dir.mkdir(exist_ok=True)
            cut_file = cut_dir / ("circle2-%d-%d-%d-%d.mov" % (round(c["a"] * 1000), round(length * 1000), round(face_x * 100), round(face_y * 100 + 1000)))
            if not render_circle(src, src_at, length, cut_file, face_y, face_x):
                look, cut_file = "spot", None
        if look == "frame":
            fr = style["缩框"]
            cut_dir.mkdir(exist_ok=True)
            cw, ch = int(canvas[0] * float(fr["大小"])) // 2 * 2, int(canvas[1] * float(fr["大小"])) // 2 * 2
            cut_file = cut_dir / ("card2-%d-%d-%dx%d.mov" % (round(c["a"] * 1000), round(length * 1000), cw, ch))
            crop = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (cw, ch, cw, ch)
            if not render_masked(src, src_at, length, cut_file, card_mask_file(cw, ch, int(fr["圆角"])), crop, cw, ch):
                look, cut_file = "spot", None
        if look == "list":
            # the footage as a card in the upper part; the list is drawn under it
            bx, by0, bw, bh = D.split_card_box()
            cut_dir.mkdir(exist_ok=True)
            cut_file = cut_dir / ("split2-%d-%d-%d-%d.mov" % (round(c["a"] * 1000), round(length * 1000), round(face_x * 100), round(face_y * 100 + 1000)))
            cy0 = canvas[1] / 2 - face_y * canvas[1] / 2
            cx0 = canvas[0] / 2 + face_x * canvas[0] / 2
            left0 = int(max(0, min(canvas[0] - bw, cx0 - bw / 2)))
            top0 = int(max(0, min(canvas[1] - bh, cy0 - bh * 0.42)))
            crop = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d,crop=%d:%d:%d:%d" % (canvas[0], canvas[1], canvas[0], canvas[1], bw, bh, left0, top0)
            if not render_masked(src, src_at, length, cut_file, card_mask_file(bw, bh, 40), crop, bw, bh):
                look, cut_file = "plain", None
        looks_used[look] = looks_used.get(look, 0) + 1
        if look == "frame":
            bz = float(style["缩框"]["背景放大"])  # behind the card: the same shot, larger, soft and dark
            settings = ClipSettings(scale_x=bz, scale_y=bz, transform_x=-(bz - 1.0) * face_x, transform_y=-(bz - 1.0) * face_y)
        elif look == "circle":
            settings = ClipSettings(scale_x=1.3, scale_y=1.3, transform_x=-0.3 * face_x, transform_y=-0.3 * face_y)
        elif look in ("quote", "end"):
            settings = ClipSettings(scale_x=1.3, scale_y=1.3, transform_x=-0.3 * face_x, transform_y=-0.3 * face_y)
        elif look == "list":
            settings = ClipSettings(alpha=0.0)  # only its sound is used here; the picture is the card
        else:
            if look == "spot":
                z = max(z, max(ZOOMS))
            settings = ClipSettings(scale_x=z, scale_y=z, transform_x=-(z - 1.0) * face_x, transform_y=-(z - 1.0) * face_y)
        seg = jy.VideoSegment(src_mat, jy.Timerange(int(round(t * sec)), int(round(length * sec))),
                              source_timerange=jy.Timerange(int(round(src_at * sec)), int(round(length * sec))),
                              volume=0.0 if amat is not None else voice_gain, clip_settings=settings)
        def laid(maker, seconds, size, name0, track0, ty=0.0, start=None):
            """Draw an element, and lay it on its track at this clip (or at `start`)."""
            f0 = render_anim(maker, seconds, size, cut_dir / name0)
            if f0 is None:
                return
            m0 = jy.VideoMaterial(str(f0))
            d0 = min(int(round(seconds * sec)), int(m0.duration))
            at0 = t if start is None else start
            script.add_segment(jy.VideoSegment(m0, jy.Timerange(int(round(at0 * sec)), d0), source_timerange=jy.Timerange(0, d0), volume=0.0,
                                               clip_settings=ClipSettings(transform_y=ty)), track0)

        if look == "spot":
            still(drawn("focus-%dx%d.png" % (canvas[0], canvas[1]), D.focus_vignette), "暗角")
        elif look in ("quote", "end"):
            seg.add_effect(jy.VideoSceneEffectType.模糊, [float(style["抠像"]["背景模糊"])])
            still(dim_file(canvas, 0.6), "暗底")
            if look == "quote":
                word0 = next((big[by_id[x].get("of", x)] for x in c["ids"] if by_id[x].get("of", x) in big), "")
                word0 = fx(word0)
                lines0 = quote_lines(fx(said_all), word0)
                key0 = hashlib.md5(("quote|%s|%s|%.2f" % ("/".join(lines0), word0, length)).encode()).hexdigest()[:12]
                laid(lambda p: D.quote_card(p, length, lines0, word0), length, (canvas[0], canvas[1]), "quote3-%s.mov" % key0, "版式")
            else:
                line0 = re.sub(r"^(那么|所以|最后|欢迎|大家|我们|你们|你)*(也)?(可以|能)?(在|来|到)?(?=评论区)", "", said_all)
                line0 = fx(line0 if 2 <= len(line0) <= 12 else ("评论区见" if "评论" in said_all else said_all[:12]))
                name0 = str((plan.get("title") or {}).get("name") or "")
                key0 = hashlib.md5(("end|%s|%s|%.2f" % (line0, name0, length)).encode()).hexdigest()[:12]
                laid(lambda p: D.end_card(p, length, line0, name0), length, (canvas[0], canvas[1]), "end2-%s.mov" % key0, "版式")
            busy.append((t, t + length))
        elif look == "list":
            still(drawn("ink-%dx%d.png" % (canvas[0], canvas[1]), lambda: Image.new("RGBA", (canvas[0], canvas[1]), D.INK + (255,))), "暗底")
            which, k1 = c["list"]
            info = lists[which]
            key0 = hashlib.md5(("list|%s|%s|%d|%.2f" % (info["heading"], "/".join(info["items"]), k1, length)).encode()).hexdigest()[:12]
            laid(lambda p: D.list_panel(p, length, info["heading"], info["items"], k1, p), length, (canvas[0], canvas[1]), "list2-%s.mov" % key0, "版式")
            busy.append((t, t + length))
        elif look == "frame":
            seg.add_effect(jy.VideoSceneEffectType.模糊, [float(style["缩框"]["背景模糊"])])
            still(dim_file(canvas, float(style["缩框"]["背景压暗"])), "暗底")
        elif look == "circle":
            seg.add_effect(jy.VideoSceneEffectType.模糊, [float(style["圆窗"]["背景模糊"])])
            still(dim_file(canvas, float(style["圆窗"]["背景压暗"])), "暗底")
        push = float(style.get("推近", 0) or 0)
        if push and look in ("plain", "spot") and length >= 1.6:
            # a still shot that very slowly moves in feels alive; the amount is small enough not to be noticed as a move
            seg.add_keyframe(jy.KeyframeProperty.uniform_scale, 0, z)
            seg.add_keyframe(jy.KeyframeProperty.uniform_scale, int(round(length * sec)), z * (1.0 + push * min(1.0, length / 4.0)))
        script.add_segment(seg, "主轨")
        def shaped(path: Path, settings2) -> None:
            # a piece the tool rendered: it may come out a frame short of what was asked
            m2 = jy.VideoMaterial(str(path))
            d2 = min(int(round(length * sec)), int(m2.duration))
            script.add_segment(jy.VideoSegment(m2, jy.Timerange(int(round(t * sec)), d2), source_timerange=jy.Timerange(0, d2), volume=0.0, clip_settings=settings2), "抠像")

        if cut_file is not None and look == "list":
            bx, by0, bw, bh = D.split_card_box()
            shaped(cut_file, ClipSettings(scale_x=bw / canvas[0], scale_y=bw / canvas[0], transform_y=(canvas[1] / 2 - (by0 + bh / 2)) / (canvas[1] / 2)))
        elif cut_file is not None and look == "frame":
            shaped(cut_file, ClipSettings(scale_x=float(style["缩框"]["大小"]), scale_y=float(style["缩框"]["大小"])))
            still(card_deco_file(canvas, float(style["缩框"]["大小"]), int(style["缩框"]["圆角"]), accent), "装饰")
        elif cut_file is not None and look == "circle":
            cs, cy = float(style["圆窗"]["大小"]), float(style["圆窗"]["位置"])
            shaped(cut_file, ClipSettings(scale_x=cs, scale_y=cs, transform_y=cy))
            still(ring_deco_file(canvas, canvas[0] / 2, canvas[1] / 2 - cy * canvas[1] / 2, cs * canvas[0], accent), "装饰")
        elif cut_file is not None:
            shown = min(length, CUTOUT_MAX)
            script.add_segment(jy.VideoSegment(jy.VideoMaterial(str(cut_file)), jy.Timerange(int(round(t * sec)), int(round(shown * sec))),
                                               source_timerange=jy.Timerange(0, int(round(shown * sec))), volume=0.0,
                                               clip_settings=ClipSettings(scale_x=float(style["抠像"]["大小"]), scale_y=float(style["抠像"]["大小"]),
                                                                          transform_y=float(style["抠像"]["位置"]))), "抠像")
        if amat is not None:
            script.add_segment(jy.AudioSegment(amat, jy.Timerange(int(round(t * sec)), int(round(length * sec))),
                                               source_timerange=jy.Timerange(int(round(c["a"] * sec)), int(round(length * sec))), volume=voice_gain), "人声")
        for sid in c["ids"]:
            s = by_id[sid]
            place[sid] = t + (s["start"] - c["a"])
            sid = s.get("of", sid)  # a piece of a sentence answers to the sentence's id
            place.setdefault(sid, place[s["id"]])
            titled = look in ("quote", "list", "end")
            word = big.get(sid, "")
            said = "".join(ch[0] for ch in s.get("chars") or [])
            word_at = said.find(word) if word else -1
            word_t = (t + (s["chars"][word_at][1] - c["a"])) if word_at >= 0 else place[s["id"]]
            if titled:
                continue  # the layout carries the words itself
            for text, a, b in sub_lines(s):
                if sid in big and style["大字"].get("替换字幕") and big[sid] in text:
                    text = text.replace(big[sid], "", 1)  # the big word stands in for those characters
                    if len(text) < 2:
                        text = ""
                if not text:
                    continue
                text = fx(text)
                at = max(t + (a - c["a"]), sub_end)
                dur = min(t + (b - c["a"]), t + length) - at
                if dur < 0.12:
                    continue
                sub_end = at + dur
                if drawn_subs:
                    marks0 = [(m.start(), m.end()) for w in highlight for m in re.finditer(re.escape(fx(w)), text)]
                    key2 = hashlib.md5(("sub|%s|%s|%s|%s" % (text, marks0, style["字幕"].get("字体"), style["字幕"].get("像素"))).encode()).hexdigest()[:14]
                    png = cut_dir / ("sub-%s.png" % key2)
                    if not png.is_file():
                        D.subtitle(text, marks0, str(style["字幕"].get("字体") or "得意黑"), int(style["字幕"].get("像素") or 80)).save(png)
                    script.add_segment(jy.VideoSegment(jy.VideoMaterial(str(png)), jy.Timerange(int(round(at * sec)), int(round(dur * sec))),
                                                       source_timerange=jy.Timerange(0, int(round(dur * sec))), volume=0.0,
                                                       clip_settings=ClipSettings(transform_y=sub_y)), "字幕图")
                    n_subs += 1
                    continue
                sub = Sub(text, jy.Timerange(int(round(at * sec)), int(round(dur * sec))), font=font("字幕"),
                          style=TextStyle(**sub_style), clip_settings=ClipSettings(transform_y=sub_y),
                          border=edge(style["字幕"]), shadow=shade(style["字幕"]))
                sub.marks = [(m.start(), m.end()) for w in highlight for m in re.finditer(re.escape(w), text)]
                script.add_segment(sub, "字幕")
                n_subs += 1
            if sid in big and word_t >= big_end and word_at >= 0 and word_t >= title_secs:  # not while the name is on screen: they would sit on each other
                line_end = s["end"]
                for text0, a0, b0 in sub_lines(s):  # the line of the subtitle the word belongs to
                    if a0 - 0.01 <= s["chars"][word_at][1] <= b0 + 0.01:
                        line_end = b0
                        break
                big_len = min(max(0.75, t + (line_end - c["a"]) - word_t + 0.12), 2.0, t + length - word_t)
                if big_len < 0.3:
                    continue
                big_end = word_t + big_len
                word1 = fx(big[sid])
                key1 = hashlib.md5(("kw|%s|%.2f" % (word1, big_len)).encode()).hexdigest()[:12]
                laid(lambda p: D.keyword(p, big_len, word1), big_len, (canvas[0], 230), "kw2-%s.mov" % key1, "关键词", ty=sub_y - 0.178, start=word_t)
        t += length
    total = t

    def lay(path, track0, at0, seconds, ty=0.0):
        m0 = jy.VideoMaterial(str(path))
        d0 = min(int(round(seconds * sec)), int(m0.duration))
        if d0 <= 0:
            return
        big0 = 1.04 if track0 in ("氛围", "幕布") else 1.0  # covering layers go on a little oversize
        script.add_segment(jy.VideoSegment(m0, jy.Timerange(int(round(at0 * sec)), d0), source_timerange=jy.Timerange(0, d0), volume=0.0,
                                           clip_settings=ClipSettings(transform_y=ty, scale_x=big0, scale_y=big0)), track0)

    # depth under everything drawn: the edges of the picture fall away a little, for the whole video
    if float(style.get("氛围暗角", 0) or 0) > 0:
        amt = float(style["氛围暗角"])
        lay(drawn("soft-%dx%d-%d.png" % (canvas[0], canvas[1], round(amt * 100)), lambda: D.soft_vignette(amt)), "氛围", 0.0, total)

    title = plan.get("title") or {}
    if title.get("name"):
        secs = min(title_secs, total)
        lines1 = [str(x) for x in (title.get("lines") or []) if str(x)][:3]
        key1 = hashlib.md5(("name|%s|%s|%.2f" % (title["name"], "/".join(lines1), secs)).encode()).hexdigest()[:12]
        f1 = render_anim(lambda p: D.name_plate(p, secs, str(title["name"]), lines1), secs, (canvas[0], 420), cut_dir / ("name2-%s.mov" % key1))
        if f1 is not None:
            # the plate's last line ends 352 px down its 420; it stays clear above the subtitle line
            sub_top = canvas[1] / 2 - sub_y * canvas[1] / 2 - 70
            plate_mid = min(1220, sub_top - 44 - 352 + 210)
            lay(f1, "人名", 0.0, secs, ty=(canvas[1] / 2 - plate_mid) / (canvas[1] / 2))

    # chapters: a card that holds the screen for a moment, then a small mark in the corner while the chapter runs
    n_chips = 0
    ticks = []
    if chapters:
        marks = sorted((place[first], title0) for first, title0 in chapters if first in place and title0)
        hold = float(style.get("章节转场", 0) or 0)
        for k, (at, title0) in enumerate(marks):
            at = max(at, title_secs)
            stop = marks[k + 1][0] if k + 1 < len(marks) else total
            if stop - at < 1.5:
                continue
            ticks.append(at / total)
            free = not any(a0 < at + hold and at < b0 for a0, b0 in busy)
            shown = at
            if hold > 0 and free and stop - at > hold + 1.0:
                key1 = hashlib.md5(("chap|%d|%s|%.2f" % (k + 1, title0, hold)).encode()).hexdigest()[:12]
                f1 = render_anim(lambda p: D.chapter_card(p, hold, k + 1, title0[:8]), hold, (canvas[0], canvas[1]), cut_dir / ("chap2-%s.mov" % key1))
                if f1 is not None:
                    lay(dim_file(canvas, 0.7), "幕布", at, hold)
                    lay(f1, "版式", at, hold)
                    busy.append((at, at + hold))
                    sound_marks.append((next(f for f, t0 in chapters if t0 == title0), "章节"))
                    shown = at + hold
            if style.get("章节角标"):
                key1 = hashlib.md5(("mark|%d|%s" % (k + 1, title0)).encode()).hexdigest()[:12]
                png1 = drawn("mark-%s.png" % key1, lambda: D.chapter_mark(k + 1, title0[:8]))
                cur = shown
                for a0, b0 in sorted(x for x in busy if x[1] > shown and x[0] < stop) + [(stop, stop)]:
                    if a0 - cur > 0.4:
                        lay(png1, "角标", cur, a0 - cur)
                    cur = max(cur, b0)
                n_chips += 1

    # a hairline along the top that fills as the video plays
    if style.get("进度线") and total > 8:
        fps1 = 10
        nframes = max(2, int(total * fps1))
        key1 = hashlib.md5(("prog|%.2f|%s" % (total, ",".join("%.3f" % x for x in ticks))).encode()).hexdigest()[:12]
        f1 = render_anim(lambda p: D.progress_strip(p / max(0.1, total), ticks), total, (canvas[0], 10), cut_dir / ("progress2-%s.mov" % key1), fps=fps1)
        if f1 is not None:
            lay(f1, "进度", 0.0, total, ty=(canvas[1] / 2 - 5) / (canvas[1] / 2))

    n_cards = 0
    for card in sorted(plan.get("cards") or [], key=lambda r: place.get(int(r.get("id", -1)), 1e9)):
        sid = int(card.get("id", -1))
        text = str(card.get("text") or "").strip()
        if sid not in place or not text or place[sid] < max(card_end, title_secs):
            continue
        secs = min(float(card.get("seconds", style["标题卡"]["时长"])), total - place[sid])
        if secs < 0.6:
            continue
        seg_card = jy.TextSegment(text, jy.Timerange(int(round(place[sid] * sec)), int(round(secs * sec))), font=font("标题卡"),
                                  style=TextStyle(size=float(style["标题卡"]["字号"]), bold=bool(style["标题卡"].get("加粗", True)), color=C_TEXT, align=1),
                                  clip_settings=ClipSettings(transform_y=float(style["标题卡"]["位置"])),
                                  border=edge(style["标题卡"]), shadow=shade(style["标题卡"]))
        seg_card.add_animation(jy.TextIntro.__members__.get(str(style["标题卡"]["动画"]), jy.TextIntro.打字机_I), min(0.8, secs / 2) * sec)
        script.add_segment(seg_card, "标题卡")
        card_end = place[sid] + secs
        n_cards += 1

    n_music = 0
    want = plan.get("music")
    if want is None and style["音乐"].get("曲目"):
        want = {"file": style["音乐"]["曲目"]}
    if want:
        if isinstance(want, str):
            want = {"file": want}
        mfile = find_music(str(want.get("file") or ""))
        if mfile is None:
            print("MUSIC_NOT_FOUND %s (run: koubo music)" % want.get("file"))
        else:
            soft = next((w for w in style["音乐"].get("不要") or [] if w.lower() in (str(want.get("file")) + " " + Path(mfile).stem).lower()), "")
            if soft:
                warnings.append("WARN 配乐「%s」是「%s」一类，风格文件不要这种  → 跑 koubo music --suggest，从上往下换一首有节奏的" % (want.get("file"), soft))
            script.append_track(jy.TrackSpec(TrackType.audio, "配乐"))
            mm = jy.AudioMaterial(str(mfile))
            mlen = mm.duration / sec
            vol = float(want.get("volume", style["音乐"]["音量"]))
            at = 0.0
            while at < total - 0.5 and mlen > 1:
                part = min(mlen, total - at)
                mseg = jy.AudioSegment(mm, jy.Timerange(int(round(at * sec)), int(round(part * sec))),
                                       source_timerange=jy.Timerange(0, int(round(part * sec))), volume=vol)
                fade_out = min(1.5, part / 3) if at + part >= total - 0.01 else 0.0
                fade_in = 0.5 if at == 0 else 0.0
                if fade_in or fade_out:
                    mseg.add_fade(int(fade_in * sec), int(fade_out * sec))
                script.add_segment(mseg, "配乐")
                at += part
                n_music += 1

    n_broll = 0
    last_end = 0.0
    role_of = {}
    for item in plan.get("keep") or []:
        if isinstance(item, dict) and "id" in item and item.get("role"):
            role_of[int(item["id"])] = item["role"]
    order = [by_id[r["id"]].get("of", r["id"]) for r in kept]
    ends = {}  # sentence id -> when it ends on the timeline
    tt = 0.0
    for c0 in clips:
        for sid0 in c0["ids"]:
            s0 = by_id[sid0]
            ends[s0.get("of", sid0)] = tt + (s0["end"] - c0["a"])
        tt += c0["b"] - c0["a"]
    rule = style["空镜"]
    for b in sorted(plan.get("broll") or [], key=lambda r: place.get(int(r.get("id", -1)), 1e9)):
        sid = int(b.get("id", -1))
        f = Path(str(b.get("file") or ""))
        if sid not in place or not f.is_file():
            print("BROLL_SKIPPED id=%s file=%s" % (sid, f.name))
            continue
        if role_of.get(sid) in ("钩子", "金句", "行动"):
            warnings.append("WARN [%d] 是「%s」，这种句子要看到人，不放空镜  → 从 broll 里去掉" % (sid, role_of[sid]))
            continue
        # a cutaway covers the sentence it illustrates, and the ones named up to "to": it starts and ends with the words
        last = int(b.get("to", sid))
        if last not in ends or (sid in order and last in order and order.index(last) < order.index(sid)):
            last = sid
        at = place[sid]
        stop = ends.get(last, at)
        k = order.index(last) if last in order else -1
        while stop - at < float(rule["最短"]) and 0 <= k < len(order) - 1 and role_of.get(order[k + 1]) not in ("钩子", "金句", "行动") \
                and ends.get(order[k + 1], 0) - at <= float(rule["最长"]):
            k += 1  # a short phrase takes the next one along, as long as it is not a line that needs the face
            stop = ends[order[k]]
        if stop - at < float(rule["最短"]):
            warnings.append("WARN [%d] 这句只有 %.1f 秒，空镜一闪而过  → 用 \"to\": <后面句子的编号> 让它盖到一组句子，或去掉" % (sid, stop - at))
            continue
        bm = jy.VideoMaterial(str(f))
        dur = min(stop - at, float(rule["最长"]), bm.duration / sec, total - at)
        if any(a0 < at + dur and at < b0 for a0, b0 in busy):
            print("BROLL_SKIPPED id=%s: 这里是整屏版式（金句、清单或章节卡）" % sid)
            continue
        if at < float(rule["开头禁用"]) or (n_broll and at < last_end + float(rule["最短间隔"])):
            print("BROLL_SKIPPED id=%s: 太靠近开头或上一段空镜" % sid)
            continue
        if bm.width > bm.height and bm.width < 3000:
            warnings.append("WARN [%d] 的空镜是 %dx%d 的横屏，裁成竖屏会糊  → 换竖屏的或 4K 的" % (sid, bm.width, bm.height))
        # fill the canvas: fitting leaves bars when the shapes differ
        fit = min(canvas[0] / bm.width, canvas[1] / bm.height)
        cover = max(canvas[0] / bm.width, canvas[1] / bm.height) / fit
        bseg = jy.VideoSegment(bm, jy.Timerange(int(round(at * sec)), int(round(dur * sec))),
                               source_timerange=jy.Timerange(0, int(round(dur * sec))), volume=0.0,
                               clip_settings=ClipSettings(scale_x=cover, scale_y=cover))
        if float(style.get("推近", 0) or 0):
            bseg.add_keyframe(jy.KeyframeProperty.uniform_scale, 0, cover)
            bseg.add_keyframe(jy.KeyframeProperty.uniform_scale, int(round(dur * sec)), cover * 1.06)
        script.add_segment(bseg, "空镜")
        last_end = at + dur
        n_broll += 1

    n_sfx = 0
    if plan.get("sfx", True):
        fx = style["音效"]
        script.append_track(jy.TrackSpec(TrackType.audio, "音效"))
        fx_end = 0.0
        for sid, kind in sorted(set(sound_marks), key=lambda m: place.get(m[0], 1e9)):
            names = fx.get(kind) or []
            f = None
            for cand in (names if isinstance(names, list) else [names]):  # first one this machine has
                f = find_sfx(str(cand))
                if f is not None:
                    break
            if f is None or sid not in place or place[sid] < fx_end or (kind != "大字" and place[sid] < title_secs):
                continue
            fm = jy.AudioMaterial(str(f))
            dur = min(fm.duration / sec, 1.5, total - place[sid])
            if dur < 0.05:
                continue
            script.add_segment(jy.AudioSegment(fm, jy.Timerange(int(round(place[sid] * sec)), int(round(dur * sec))),
                                               source_timerange=jy.Timerange(0, int(round(dur * sec))), volume=float(fx.get("音量", 0.5))), "音效")
            fx_end = place[sid] + dur + 0.05
            n_sfx += 1

    # what the script claims and where that comes from, kept beside the plan
    proof = plan.get("evidence") or []
    backed = {int(e["id"]) for e in proof if "id" in e and str(e.get("source") or "").strip()}
    for row in kept:
        s0 = by_id[row["id"]]
        sid0 = s0.get("of", s0["id"])
        if sid0 not in backed and re.search(r"\d|百分|研究|数据|临床|证明|治愈|根治|最有效|第一|唯一", s0["text"]):
            warnings.append("WARN [%d] 像是一个需要出处的说法：%s  → 在 evidence 里给出来源；查不到就写 \"source\": \"未查到\" 并在交付时告诉用户" % (sid0, s0["text"]))
            backed.add(sid0)
    if proof:
        lines = ["# 证据清单", ""]
        for e in proof:
            sid0 = int(e.get("id", -1))
            lines.append("- [%s] %s\n  - 说法：%s\n  - 出处：%s%s" % (sid0, by_id[sid0]["text"] if sid0 in by_id else "", e.get("claim", ""), e.get("source", ""),
                                                            ("\n  - 备注：" + str(e["note"])) if e.get("note") else ""))
        (plan_path.parent / "证据清单.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    placed_big = [sid0 for sid0 in big if sid0 in place]
    if total >= 20 and len(placed_big) < total / 10:
        warnings.append("WARN 关键词（big）只有 %d 个，这条片子 %s  → 每 6–8 秒要一个，至少 %d 个；挑句尾的结论词、数字、名词" % (len(placed_big), clock(total), int(total / 8)))
    both = [w for w in highlight if w in big.values()]
    if both:
        warnings.append("WARN 这些词既在 big 又在 highlight：%s  → 留在 big，从 highlight 里去掉" % "、".join(both))
    if not (plan.get("broll") or []) and total >= 30:
        print("NOTE 没有空镜。参考成片每 15–20 秒一段；举例、讲到具体事物的句子用 koubo stock 找。")
    lo, hi = float(style["时长"]["最短"]), float(style["时长"]["最长"])
    if not (lo <= total and (hi <= 0 or total <= hi)) and not plan.get("any_length"):
        warnings.append("WARN 成片 %s，风格要求 %d–%d 秒  → 增减句子；用户另有要求就在计划里写 \"any_length\": true" % (clock(total), lo, hi))
    if plan.get("sections") and not any(isinstance(x, dict) and x.get("role") == "钩子" for x in (plan["sections"][0].get("keep") or [])[:1]):
        warnings.append("WARN 第一句没有标成「钩子」  → 开头必须是一句能独立听懂、能留住人的话")

    script.save()
    n_beauty = 0
    beauty = plan.get("beauty")
    if beauty is None and plan.get("sections"):
        beauty = True
    if beauty:
        sliders = dict(style["美颜"]) if beauty is True else {str(k): v for k, v in dict(beauty).items()}
        unknown = [k for k in sliders if k not in BEAUTY]
        if unknown:
            print("BEAUTY_UNKNOWN " + ",".join(unknown))
        n_beauty = add_beauty(root / name / "draft_content.json", sliders)
    src_len = float(tr.get("duration") or 0)
    print("DRAFT=" + name)
    print("DRAFT_FOLDER=" + str(root / name))
    print("STYLE=%s" % style["名称"])
    print("CLIPS=%d SUBTITLES=%d BROLL=%d CARDS=%d CHAPTER_MARKS=%d MUSIC=%d SFX=%d BEAUTY_CLIPS=%d" % (len(clips), n_subs, n_broll, n_cards, n_chips, n_music, n_sfx, n_beauty))
    if stab.get("开"):
        print("STABILISED=%d%s" % (n_stab, (" NOT_STABILISED=%d (防抖没做成，用的是原片段)" % stab_missed) if stab_missed else ""))
    print("LOOKS=" + " ".join("%s:%d" % kv for kv in sorted(looks_used.items())))
    print("LENGTH=%s (source %s)" % (clock(total), clock(src_len)))
    for line in warnings:
        print(line)
    print("WARNINGS=%d%s" % (len(warnings), "  ← 先按提示改 plan.json 再重跑，改到 0 条或确认每条都有理由" if warnings else ""))
    print("KOUBO_OK=1")


def preview_cmd(args) -> None:
    """Contact sheets of a draft, laid out the way Jianying lays it out, to look at before handing over."""
    import preview
    plan_path = Path(args.plan).expanduser().resolve()
    plan = json.loads(plan_path.read_text(encoding="utf-8-sig"))
    name = re.sub(r'[\\/:*?"<>|]', "_", str(plan.get("name") or "")).strip()
    folder = draft_root(plan) / name
    if not (folder / "draft_content.json").is_file():
        fail("draft-missing " + str(folder))
    sheets = preview.preview(folder, find_ffmpeg(), plan_path.parent / "预览", fps=float(args.fps), scale=0.185)
    for p0 in sheets:
        print("PREVIEW_SHEET\t%s" % p0)
    print("KOUBO_OK=1")


def check(_args) -> None:
    ok = True
    for mod in ("funasr", "torch", "pyJianYingDraft", "pymediainfo"):
        try:
            __import__(mod)
            print("module %s ok" % mod)
        except Exception as exc:  # noqa: BLE001
            ok = False
            print("module %s MISSING (%s)" % (mod, type(exc).__name__))
    try:
        print("ffmpeg " + find_ffmpeg())
    except SystemExit:
        ok = False
    root = draft_root({})
    print("draft-root %s %s" % (root, "ok" if root.is_dir() else "MISSING"))
    print("KOUBO_OK=1" if ok and root.is_dir() else "KOUBO_FAIL check")


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    ap = argparse.ArgumentParser(prog="koubo")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("transcribe")
    a.add_argument("video")
    a.add_argument("--out")
    a.add_argument("--audio", help="separate voice recording of the same take (lavalier or recorder)")
    a.add_argument("--engine", choices=["local", "groq"], default="local", help="groq: hosted Whisper, quick but leaves out fillers and repeats; not for cutting")
    a.add_argument("--reuse", action="store_true", help="re-cut phrases from the saved recognition instead of listening again")
    a.set_defaults(fn=transcribe)
    b = sub.add_parser("draft")
    b.add_argument("plan")
    b.set_defaults(fn=build)
    m = sub.add_parser("music")
    m.add_argument("query", nargs="?", default="", help="part of a title, a maker or a style")
    m.add_argument("--all", action="store_true", help="also list what Jianying's library has shown but this machine has not downloaded")
    m.add_argument("--suggest", action="store_true", help="the music on this machine that fits the style best, best first")
    m.add_argument("--style", default="")
    m.add_argument("--audition", action="store_true", help="copy Jianying's downloads into a folder with readable names, to listen and choose")
    m.set_defaults(fn=music)
    fe = sub.add_parser("fetch")
    fe.add_argument("query", nargs="?", default="", help="only titles, makers or styles containing this")
    fe.add_argument("--songs", type=int, default=30)
    fe.add_argument("--sounds", type=int, default=60)
    fe.add_argument("--any", action="store_true", help="also music not cleared for commercial use")
    fe.set_defaults(fn=fetch)
    st = sub.add_parser("stock")
    st.add_argument("query", help="what to look for; English works best in the free libraries")
    st.add_argument("--fetch", type=int, default=0, help="download this many from the free libraries")
    st.add_argument("--pick", default="", help="download these candidates, by id (comma separated)")
    st.set_defaults(fn=stock)
    al = sub.add_parser("align")
    al.add_argument("video")
    al.add_argument("--audio", required=True)
    al.add_argument("--out")
    al.set_defaults(fn=align)
    pv = sub.add_parser("preview")
    pv.add_argument("plan")
    pv.add_argument("--fps", default="4")
    pv.set_defaults(fn=preview_cmd)
    c = sub.add_parser("check")
    c.set_defaults(fn=check)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
