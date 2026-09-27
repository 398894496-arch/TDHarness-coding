#!/usr/bin/env python3
"""Turn an office-built client zip into a site template. Drops auth keys."""
from __future__ import annotations

import argparse
import zipfile
from pathlib import Path

MARK = b"{{TDH_HOST}}"
NEEDLES = (
    ".".join(["192", "168", "1", "15"]).encode("ascii"),
    ".".join(["100", "68", "88", "100"]).encode("ascii"),
)
SKIP_EXACT = {"employee.auth", "._employee.auth"}
SKIP_CONTAINS = ("employee.auth", "join-off-lan", "tskey")


def prepare(src: Path, dst: Path) -> None:
    n_drop = 0
    n_sub = 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(dst.suffix + ".tmp")
    with zipfile.ZipFile(src, "r") as zin, zipfile.ZipFile(tmp, "w") as zout:
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            base = name.rsplit("/", 1)[-1]
            if base in SKIP_EXACT or any(s in name.lower() for s in SKIP_CONTAINS):
                n_drop += 1
                continue
            data = zin.read(item.filename)
            if "node_modules" not in name:
                if b"ts" + b"key-" in data:
                    n_drop += 1
                    continue
                for nd in NEEDLES:
                    if nd in data:
                        data = data.replace(nd, MARK)
                        n_sub += 1
            zout.writestr(item, data)
    tmp.replace(dst)
    print("DROP_AUTH=%s" % n_drop)
    print("SUB_HOST=%s" % n_sub)
    print("WROTE=%s" % dst)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    prepare(Path(args.src), Path(args.out))


if __name__ == "__main__":
    main()
