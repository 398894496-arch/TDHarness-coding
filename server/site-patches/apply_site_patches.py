"""把客户端补丁打进安装包（幂等）。客户现场和公司办公室用同一套补丁。
  zip 模式（客户现场 / 一键安装，打在成品包上）：
    python apply_site_patches.py --zip CompanyDesk-win.zip --patches DIR --pub pack-sign.pub [--bump-mark]
  目录模式（办公室打包流程，在组装好的 CompanyDesk 目录上、封条之前）：
    python apply_site_patches.py --dir <CompanyDesk 目录> --patches DIR --pub pack-sign.pub
内容：/company/* 来源校验；生图在对话里显示；生成的图片视频在对话里显示和下载（含侧边栏下载修复）；更新验签 + tree-check；换 exe 前检查；
团队工作区 realpath；公司模型来源与默认模型；tool-web 以模板为准；删掉 skills/skills 死副本；
放入 pack-verify.js 和本服务器的 pack-sign.pub。zip 模式之后要用 site-cs.py reseal-zip 重新封条。
"""
import argparse
import hashlib
import importlib.util
import json
import os
import time
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
    if not str(how).startswith("patched"):
        return data, how
    return (t.replace("\n", "\r\n") if crlf else t).encode("utf-8"), how


class Patcher:
    def __init__(self, pdir, pub_path, default_model=None, default_effort=None):
        self.default_model = default_model
        self.default_effort = default_effort
        self.msync = load(pdir / "patch_model_sync.py")
        self.guard = load(pdir / "patch_company_guard.py")
        self.media = load(pdir / "patch_grok_media.py")
        self.scripts = load(pdir / "patch_client_scripts.py")
        self.lease = load(pdir / "patch_desk_lease.py")
        self.ovl = load(pdir / "patch_overlay_default.py")
        self.tw = load(pdir / "patch_toolweb_hint.py")
        self.pupd = load(pdir / "patch_pack_update.py")
        self.mdl = load(pdir / "patch_media_download.py")
        self.verify_js = (pdir / "pack-verify.js").read_bytes()
        self.pub = Path(pub_path).read_bytes()
        self.tmp = pdir / ".guard.tmp.js"

    def guard_fn(self, t):
        if "@@guard-v2" in t:
            return t, "already"
        self.tmp.write_text(t, encoding="utf-8")
        try:
            how = self.guard.patch(self.tmp)
            out = self.tmp.read_text(encoding="utf-8")
        finally:
            self.tmp.unlink()
        return out, ("patched" if how.startswith("patched") else how)

    @staticmethod
    def dropped(rel):
        # 内层 skills/skills/ 是死副本（sync-skills 只用外层），内容还和外层不一样，打包和封条却都算它。
        return rel.startswith("skills/skills/")

    def member(self, rel, data):
        """rel 是相对 CompanyDesk/ 的路径。返回 (新内容, 说明 或 None)。"""
        base = rel.rsplit("/", 1)[-1]
        top = "/" not in rel
        if rel.endswith("company-shell/lib/index.js"):
            data, how = text_patch(self.guard_fn, data)
            data, how2 = text_patch(self.msync.patch, data)
            if str(how2).startswith("patched"):
                how = ("patched+" if str(how).startswith("patched") else "") + "model-sync"
            return data, how
        if rel.endswith("company-grok-media/lib/index.js"):
            data, how = text_patch(self.media.patch, data)
            data, how2 = text_patch(self.mdl.patch_grok_media, data)
            if str(how2).startswith("patched"):
                how = ("patched+" if str(how).startswith("patched") else "") + "media-download"
            return data, how
        mdl_fn = self.mdl.for_member(rel)
        if mdl_fn is not None:
            return text_patch(mdl_fn, data)
        if rel.endswith("home/profiles/web/overlay.yml"):
            return text_patch(lambda t: self.ovl.patch(t, self.default_model, self.default_effort), data)
        if top and base in ("tree-restore.ps1", "tree-restore.sh", "start.ps1", "start.command"):
            data, how = self.scripts.patch_bytes(base, data)
            if base in ("start.ps1", "start.command"):
                data, how2 = self.tw.patch_bytes(base, data)
                if how2.startswith("patched"):
                    how = ("patched+" if how == "patched" else "") + how2
            return data, how
        if top and base == "desk-lease.js":
            return text_patch(self.lease.patch, data)
        if top and base == "pack-update-check.js":
            return text_patch(self.pupd.patch, data)
        if top and base == "pack-verify.js":
            return self.verify_js, "replaced"
        if top and base == "pack-sign.pub":
            return self.pub, "replaced"
        return data, None


def run_zip(a, pt):
    src = Path(a.zip)
    tmp = src.with_suffix(src.suffix + ".tmp")
    stats = {}
    old_mark = new_mark = None
    if a.bump_mark:
        with zipfile.ZipFile(src) as z0:
            nm = [i.filename.replace("\\", "/") for i in z0.infolist()]
            bk = "CompanyDesk/BUILD.json" if "CompanyDesk/BUILD.json" in nm else "BUILD.json"
            old_mark = json.loads(z0.read(bk).decode("utf-8-sig"))["mark"]
        new_mark = hashlib.sha256(("%s|site-rev|%s" % (old_mark, time.time())).encode()).hexdigest()[:32]
        print("OLD_MARK=%s" % old_mark)
        print("NEW_MARK=%s" % new_mark)
    prefix = None
    dropped = 0
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(tmp, "w") as zout:
        names = set()
        for item in zin.infolist():
            name = item.filename.replace("\\", "/")
            names.add(name)
            if prefix is None and name.startswith("CompanyDesk/"):
                prefix = "CompanyDesk/"
            rel = name[len("CompanyDesk/"):] if name.startswith("CompanyDesk/") else name
            if pt.dropped(rel):
                dropped += 1
                continue
            data = zin.read(item.filename)
            data, how = pt.member(rel, data)
            if old_mark and not name.endswith((".exe", ".dll", ".node", ".exe.new")) \
                    and ("node_modules/" not in name or "company-shell/" in name) and len(data) < 32 * 1024 * 1024:
                ob = old_mark.encode("ascii")
                if ob in data:
                    data = data.replace(ob, new_mark.encode("ascii"))
                    how = (how + "+mark") if how else "mark"
            if how:
                stats[name] = how
            zout.writestr(item, data)
        prefix = prefix or ""
        for extra, blob in ((prefix + "pack-verify.js", pt.verify_js), (prefix + "pack-sign.pub", pt.pub)):
            if extra not in names:
                zi = zipfile.ZipInfo(extra, date_time=(2026, 10, 8, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16
                zout.writestr(zi, blob)
                stats[extra] = "added"
    tmp.replace(src)
    if dropped:
        stats["skills/skills/*"] = "dropped %d" % dropped
    return stats


def run_dir(a, pt):
    root = Path(a.dir)
    if not (root / "desk-lease.js").is_file():
        raise SystemExit("not-a-client-dir:" + str(root))
    stats = {}
    nested = root / "skills" / "skills"
    if nested.is_dir():
        import shutil
        shutil.rmtree(nested)
        stats["skills/skills/*"] = "dropped"
    for base, dirs, files in os.walk(root):
        for f in files:
            full = Path(base) / f
            rel = full.relative_to(root).as_posix()
            data = full.read_bytes()
            new, how = pt.member(rel, data)
            if how and new != data:
                full.write_bytes(new)
            if how:
                stats[rel] = how
    for extra, blob in (("pack-verify.js", pt.verify_js), ("pack-sign.pub", pt.pub)):
        if not (root / extra).is_file():
            (root / extra).write_bytes(blob)
            stats[extra] = "added"
    return stats


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--zip")
    g.add_argument("--dir")
    ap.add_argument("--patches", required=True)
    ap.add_argument("--pub", required=True)
    ap.add_argument("--bump-mark", action="store_true", help="zip 模式：换新的版本标记，已装客户端才会收到更新")
    ap.add_argument("--default-model", default=None, help="站点强制的默认模型（网关没有 /v1/company-models 时用，如办公室 gw-mux）")
    ap.add_argument("--default-effort", default=None)
    a = ap.parse_args()
    pt = Patcher(Path(a.patches), a.pub, a.default_model, a.default_effort)
    stats = run_zip(a, pt) if a.zip else run_dir(a, pt)
    for k in sorted(stats):
        print("PATCH %s %s" % (stats[k], k))


if __name__ == "__main__":
    main()
