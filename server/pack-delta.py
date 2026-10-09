#!/usr/bin/env python3
"""Delta updates for the client packs.

A publish changes a handful of files in a ~400 MB pack. A desk on a slow or relayed link used to
download the whole pack and often never finished (2026-10-09: 110 KB/s, an hour, reset half way).
Each publish now also writes, for every recently published version, a delta zip that holds only
the files that changed plus DELTA.json (from/to mark, removed files), and lists them in
version.json under <platform>.deltas[<from mark>] = {file, bytes}. pack-sign.js then signs
version.json with each delta's sha256; the desk downloads the delta for its own mark, verifies it,
applies it and runs tree-check, and falls back to the full pack on any mismatch.

  pack-delta.py remember --dist D:\\dsh\\client-dist --history D:\\dsh\\client-history   before the zips change
  pack-delta.py build    --dist D:\\dsh\\client-dist --history D:\\dsh\\client-history   after they are final, before signing
History (newest 4 per platform) stays outside dist so it is neither served nor copied into every
publish backup; deltas go to <dist>\\delta. A zip republished under the same mark replaces its history
copy, or a later delta would be cut against content no desk has.
"""
import argparse
import json
import os
import shutil
import zipfile
from pathlib import Path

PLATS = ("win", "mac")
KEEP = 4
MAX_RATIO = 0.6


def mark_of(zp):
    with zipfile.ZipFile(zp) as z:
        names = z.namelist()
        key = "CompanyDesk/BUILD.json" if "CompanyDesk/BUILD.json" in names else "BUILD.json"
        return json.loads(z.read(key).decode("utf-8-sig"))["mark"]


def remember(dist, hist):
    hist.mkdir(parents=True, exist_ok=True)
    for plat in PLATS:
        zp = dist / ("CompanyDesk-%s.zip" % plat)
        if not zp.is_file():
            continue
        m = mark_of(zp)
        dst = hist / ("%s-%s.zip" % (plat, m))
        st = zp.stat()
        if dst.is_file() and dst.stat().st_size == st.st_size and int(dst.stat().st_mtime) == int(st.st_mtime):
            print("ALREADY %s %s" % (plat, m))
            continue
        shutil.copy2(zp, dst.with_suffix(".tmp"))
        dst.with_suffix(".tmp").replace(dst)
        for stale in (dist / "delta").glob("%s-%s-*.zip" % (plat, m)) if (dist / "delta").is_dir() else []:
            stale.unlink()
        print("REMEMBERED %s %s" % (plat, m))


def make_delta(old_zip, new_zip, out, frm, to):
    with zipfile.ZipFile(old_zip) as zo, zipfile.ZipFile(new_zip) as zn:
        oi = {i.filename: i for i in zo.infolist()}
        newnames = set()
        changed = 0
        root = "CompanyDesk/" if any(n.startswith("CompanyDesk/") for n in oi) else ""
        tmp = out.with_suffix(".tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zd:
            for i in zn.infolist():
                newnames.add(i.filename)
                if i.is_dir():
                    continue
                o = oi.get(i.filename)
                if o is None or o.CRC != i.CRC or o.file_size != i.file_size or o.external_attr != i.external_attr:
                    zd.writestr(i, zn.read(i.filename))
                    changed += 1
            removed = [n[len(root):] for n in oi if n not in newnames and not n.endswith("/")]
            zd.writestr(root + "DELTA.json", json.dumps({"from": frm, "to": to, "removed": removed}, ensure_ascii=False))
        tmp.replace(out)
    return changed, len(removed)


def build(dist, hist):
    dd = dist / "delta"
    dd.mkdir(exist_ok=True)
    verp = dist / "version.json"
    doc = json.loads(verp.read_text(encoding="utf-8-sig"))
    keep_files = set()
    for plat in PLATS:
        zp = dist / ("CompanyDesk-%s.zip" % plat)
        if not zp.is_file() or plat not in doc:
            continue
        to = mark_of(zp)
        full = zp.stat().st_size
        deltas = {}
        olds = sorted(hist.glob("%s-*.zip" % plat), key=lambda p: p.stat().st_mtime, reverse=True) if hist.is_dir() else []
        for i, old in enumerate(olds):
            frm = old.stem.split("-", 1)[1]
            if i >= KEEP:
                old.unlink()
                print("PRUNED %s" % old.name)
                continue
            if frm == to:
                continue
            out = dd / ("%s-%s-%s.zip" % (plat, frm, to))
            changed, removed = make_delta(old, zp, out, frm, to)
            size = out.stat().st_size
            if size > MAX_RATIO * full:
                out.unlink()
                print("DELTA_SKIP %s %s too-big %d" % (plat, frm, size))
                continue
            deltas[frm] = {"file": "delta/" + out.name, "bytes": size}
            keep_files.add(out.name)
            print("DELTA %s %s->%s files=%s removed=%s bytes=%d" % (plat, frm, to, changed, removed, size))
        doc[plat]["deltas"] = deltas
    for f in dd.glob("*.zip"):
        if f.name not in keep_files:
            f.unlink()
    verp.write_text(json.dumps(doc, separators=(",", ":")) + "\n", encoding="utf-8")
    print("DELTA_BUILD_OK=1")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=("remember", "build"))
    ap.add_argument("--dist", required=True)
    ap.add_argument("--history", help="default: <dist>/../client-history")
    a = ap.parse_args()
    dist = Path(a.dist)
    hist = Path(a.history) if a.history else dist.parent / "client-history"
    (remember if a.cmd == "remember" else build)(dist, hist)
