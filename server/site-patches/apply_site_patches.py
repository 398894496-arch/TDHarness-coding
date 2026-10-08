"""把客户端补丁打进 LAN 安装包（幂等）：
  python apply_site_patches.py --zip CompanyDesk-win.zip --patches DIR --pub pack-sign.pub
- company-shell/lib/index.js     /company/* 来源校验
- company-grok-media/lib/index.js 生图结果在对话里显示
- tree-restore.ps1/.sh, start.ps1/start.command  更新验签 + tree-check
- 新增 pack-verify.js、pack-sign.pub
随后用 site-cs.py reseal-zip 重新封条。
"""
import argparse
import importlib.util
import sys
import zipfile
from pathlib import Path


def load(mod_path):
    spec = importlib.util.spec_from_file_location(Path(mod_path).stem, mod_path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def text_patch(fn, data):
    raw = data.decode("utf-8")
    crlf = "\r\n" in raw
    res = fn(raw.replace("\r\n", "\n"))
    t, how = res if isinstance(res, tuple) else (res, "patched")
    if how != "patched":
        return data, how
    return (t.replace("\n", "\r\n") if crlf else t).encode("utf-8"), how


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--patches", required=True)
    ap.add_argument("--pub", required=True)
    ap.add_argument("--bump-mark", action="store_true", help="换新的版本标记，已装客户端才会收到更新")
    a = ap.parse_args()
    pdir = Path(a.patches)
    guard = load(pdir / "patch_company_guard.py")
    media = load(pdir / "patch_grok_media.py")
    scripts = load(pdir / "patch_client_scripts.py")
    lease = load(pdir / "patch_desk_lease.py")
    ovl = load(pdir / "patch_overlay_default.py")
    verify_js = (pdir / "pack-verify.js").read_bytes()
    pub = Path(a.pub).read_bytes()

    def guard_fn(t):
        if "function companyCallerOk(" in t:
            return t, "already"
        tmp = Path(a.zip + ".guard.tmp.js")
        tmp.write_text(t, encoding="utf-8")
        how = guard.patch(tmp)
        out = tmp.read_text(encoding="utf-8")
        tmp.unlink()
        return out, ("patched" if how.startswith("patched") else how)

    src = Path(a.zip)
    tmp = src.with_suffix(src.suffix + ".tmp")
    old_mark = new_mark = None
    if a.bump_mark:
        import hashlib, json, time
        with zipfile.ZipFile(src) as z0:
            nm = [i.filename.replace("\\", "/") for i in z0.infolist()]
            bk = "CompanyDesk/BUILD.json" if "CompanyDesk/BUILD.json" in nm else "BUILD.json"
            old_mark = json.loads(z0.read(bk).decode("utf-8-sig"))["mark"]
        new_mark = hashlib.sha256(("%s|site-rev|%s" % (old_mark, time.time())).encode()).hexdigest()[:32]
        print("OLD_MARK=%s" % old_mark)
        print("NEW_MARK=%s" % new_mark)
    stats = {}
    prefix = None
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w") as zout:
        names = set()
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            names.add(name)
            if prefix is None and name.startswith("CompanyDesk/"):
                prefix = "CompanyDesk/"
            data = zin.read(item.filename)
            base = name.rsplit("/", 1)[-1]
            how = None
            if name.endswith("company-shell/lib/index.js"):
                data, how = text_patch(guard_fn, data)
            elif name.endswith("company-grok-media/lib/index.js"):
                data, how = text_patch(media.patch, data)
            elif name.count("/") <= 1 and base in ("tree-restore.ps1", "tree-restore.sh", "start.ps1", "start.command"):
                data, how = scripts.patch_bytes(base, data)
            elif name.endswith("home/profiles/web/overlay.yml"):
                data, how = text_patch(ovl.patch, data)
            elif name.count("/") <= 1 and base == "desk-lease.js":
                data, how = text_patch(lease.patch, data)
            elif name.endswith("/pack-verify.js") and name.count("/") <= 1:
                data, how = verify_js, "replaced"
            elif name.endswith("/pack-sign.pub") and name.count("/") <= 1:
                data, how = pub, "replaced"
            if old_mark and not name.endswith((".exe", ".dll", ".node", ".exe.new")) \
                    and ("node_modules/" not in name or "company-shell/" in name) and len(data) < 32 * 1024 * 1024:
                ob = old_mark.encode("ascii")
                if ob in data:
                    data = data.replace(ob, new_mark.encode("ascii"))
                    stats[name] = (stats.get(name, how) or "") + "+mark"
                    how = how or "mark"
            if how:
                stats.setdefault(name, how)
            zout.writestr(item, data)
        prefix = prefix or ""
        for extra, blob in ((prefix + "pack-verify.js", verify_js), (prefix + "pack-sign.pub", pub)):
            if extra not in names:
                zi = zipfile.ZipInfo(extra, date_time=(2026, 10, 8, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16
                zout.writestr(zi, blob)
                stats[extra] = "added"
    tmp.replace(src)
    for k in sorted(stats):
        print("PATCH %s %s" % (stats[k], k))


if __name__ == "__main__":
    main()
