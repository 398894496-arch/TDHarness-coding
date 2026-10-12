#!/usr/bin/env python3
"""The desk's source (desk/plugins, desk/pack) is what sites run. Checks:

1. every .js / .cjs file parses (node --check), every .sh / .command too (bash -n);
2. nothing of one company: no company or brand names of a particular site, no LAN or
   Tailscale addresses, no maintainer paths, no site login names (a site's own nouns go in
   its handbook and synonym list, its brand in a site patch filling SITE_BRAND_*);
   and no company or brand name of one site anywhere else in the repository either (the
   setup and desk programs' file properties, icons, test data);
3. every site patch still finds its anchors in this source (server/site-patches), so a
   change to the desk cannot silently leave a site patch behind;
4. site-cs.py overlay-zip puts this source into a pack: plugins in both places a pack keeps
   them, desk/pack's common/ plus the platform's own files, the skills folder whole, with the
   site's address written in, template mode bits kept, and the rest of the pack left alone.

Prints DESK_SOURCE_OK=1.
"""
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DESK = ROOT / "desk" / "plugins"
PACK = ROOT / "desk" / "pack"
ONE_COMPANY = {
    "a site's company name": r"橙池|orangecitypictures",
    "a site's brand": r"the-?diva|THE DIVA|TheDiva",
}
# The one place a name of one site may stay: shortcuts made by Setup before 1.0.16 point at
# CompanyDesk\\the-diva.ico, so compile-apphost keeps that file name (with the product icon in it).
ALLOWED = {("server/compile-apphost.ps1", "the-diva.ico")}
FORBIDDEN = {
    **ONE_COMPANY,
    "a site's city": r"珠海",
    "a LAN address": r"\b192\.168\.\d+\.\d+\b",
    "a Tailscale address": r"\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b",
    "a maintainer path": r"dsh-saas|/Users/(?!x/)[A-Za-z0-9._-]+/|Users-(?!x-)[A-Za-z0-9]+-",
    "a site login": r"\b(bosshome|zhangzhang\d*|xiaoman|laoyang\d*|hengge|quan|fe1)\b",
    "a site's server name": r"desktop-269841[8]",
    "a key or token": r"sk-[A-Za-z0-9]{16,}|dsh_[0-9a-f]{24,}|xai-[A-Za-z0-9]{16,}",
}


def fail(msg):
    print("DESK_SOURCE_FAIL=" + msg)
    sys.exit(1)


def pack_rel(p):
    """desk/pack/<common|win|mac>/x -> x (the path inside CompanyDesk/)."""
    return p.relative_to(PACK).as_posix().split("/", 1)[1]


def main():
    files = [p for p in DESK.rglob("*") if p.is_file()]
    pfiles = [p for p in PACK.rglob("*") if p.is_file()]
    if not files or not pfiles:
        fail("no-desk-source")
    names = sorted(d.name for d in DESK.iterdir() if (d / "package.json").is_file())

    # 1. Parses.
    checked = 0
    for p in files + pfiles:
        cmd = ["node", "--check", str(p)] if p.suffix in (".js", ".cjs") else (
            ["bash", "-n", str(p)] if p.suffix in (".sh", ".command") else None)
        if cmd:
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode:
                fail("syntax %s %s" % (p.relative_to(ROOT), (r.stderr or "").strip().splitlines()[-1:]))
            checked += 1
    print("DESK_SYNTAX_OK=%d" % checked)

    # 2. Nothing of one company.
    for p in files + pfiles:
        if p.suffix in (".png", ".jpg", ".ico"):
            fail("binary asset %s (a site's brand goes in a site patch)" % p.relative_to(ROOT))
        text = p.read_text(encoding="utf-8", errors="ignore")
        for what, pat in FORBIDDEN.items():
            m = re.search(pat, text, re.I)
            if m:
                fail("%s in %s: %r" % (what, p.relative_to(ROOT), m.group(0)))
    tracked = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True).stdout.split("\0")
    for rel in tracked:
        p = ROOT / rel
        if not rel or rel in ("CHANGELOG.md", "scripts/prove-desk-source.py") or not p.is_file():
            continue
        if p.suffix in (".zip", ".exe", ".dmg", ".ico", ".png", ".jpg", ".dll") or p.stat().st_size > 5_000_000:
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        for what, pat in ONE_COMPANY.items():
            for m in re.finditer(pat, text, re.I):
                if (rel, text[m.start():m.end() + 4]) not in ALLOWED:
                    fail("%s in %s: %r" % (what, rel, m.group(0)))
    print("DESK_NEUTRAL_OK=1")

    # 3. Every site patch still applies to this source.
    spec = importlib.util.spec_from_file_location("asp", ROOT / "server" / "site-patches" / "apply_site_patches.py")
    asp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(asp)
    with tempfile.TemporaryDirectory() as tmp:
        pub = Path(tmp) / "pack-sign.pub"
        pub.write_text("-----BEGIN PUBLIC KEY-----\n")
        pt = asp.Patcher(ROOT / "server" / "site-patches", str(pub), None, None, None, "8443")
        patched = 0
        for p in files + pfiles:
            rel = pack_rel(p) if p.is_relative_to(PACK) else "plugins/" + p.relative_to(DESK).as_posix()
            try:
                data, how = pt.member(rel, p.read_bytes())
            except SystemExit as e:
                fail("site patch lost its anchor in %s: %s" % (rel, e))
            if how and str(how).startswith("patched"):
                patched += 1
                # The second time is a no-op.
                _, again = pt.member(rel, data)
                if again and str(again).startswith("patched"):
                    fail("site patch not idempotent on %s: %s" % (rel, again))
        if not patched:
            fail("no site patch applied to the desk source at all")
    print("DESK_SITE_PATCHES_OK=%d" % patched)

    # 4. overlay-zip, on a Windows-shaped and a Mac-shaped pack.
    for plat, starter in (("win", "start.ps1"), ("mac", "start.command")):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            (t / "site.yml").write_text("host: proof.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n")
            z = t / "pack.zip"
            with zipfile.ZipFile(z, "w") as zz:
                zz.writestr("CompanyDesk/BUILD.json", json.dumps({"mark": "x"}))
                zi = zipfile.ZipInfo("CompanyDesk/" + starter)
                zi.external_attr = 0o100755 << 16
                zz.writestr(zi, "old")
                zz.writestr("CompanyDesk/plugins/dsh-artifact/package.json", "{}")
                zz.writestr("CompanyDesk/skills/skills/company-web/SKILL.md", "stale nested copy")
                for home in ("CompanyDesk/plugins/", "CompanyDesk/home/profiles/web/node_modules/"):
                    for n in names:
                        zz.writestr(home + n + "/package.json", "{}")
                        zz.writestr(home + n + "/stale-left-over.js", "old")
            r = subprocess.run([sys.executable, str(ROOT / "server" / "site-cs.py"), "--site", str(t / "site.yml"), "overlay-zip",
                                "--src", str(z), "--plugins", str(DESK)], capture_output=True, text=True)
            if r.returncode:
                fail("overlay-zip %s %s" % (plat, (r.stderr or r.stdout)[-300:]))
            with zipfile.ZipFile(z) as zz:
                got = set(zz.namelist())
                if any(n.endswith("stale-left-over.js") or "/skills/skills/" in n for n in got):
                    fail("overlay left a template file in place (%s)" % plat)
                if "CompanyDesk/plugins/dsh-artifact/package.json" not in got or "CompanyDesk/BUILD.json" not in got:
                    fail("overlay touched what it does not own (%s)" % plat)
                for home in ("CompanyDesk/plugins/", "CompanyDesk/home/profiles/web/node_modules/"):
                    for p in files:
                        name = home + p.relative_to(DESK).as_posix()
                        if name not in got:
                            fail("overlay missed " + name)
                want = {"CompanyDesk/" + pack_rel(p) for p in pfiles if p.relative_to(PACK).parts[0] in ("common", plat)}
                other = {"CompanyDesk/" + pack_rel(p) for p in pfiles if p.relative_to(PACK).parts[0] not in ("common", plat)} - want
                if want - got:
                    fail("overlay missed %s" % sorted(want - got)[:3])
                if other & got:
                    fail("overlay put the other platform's files in the %s pack: %s" % (plat, sorted(other & got)[:3]))
                if (zz.getinfo("CompanyDesk/" + starter).external_attr >> 16) != 0o100755:
                    fail("overlay lost the mode bits of " + starter)
                shell = zz.read("CompanyDesk/plugins/company-shell/lib/index.js")
                if b"{{TDH_HOST}}" in shell or b"proof.local" not in shell:
                    fail("overlay did not write the site address into company-shell")
                notice = zz.read("CompanyDesk/NOTICE.txt")
                if b"{{TDH_HOST}}" in notice or b"proof.local" not in notice:
                    fail("overlay did not write the site address into NOTICE.txt (%s)" % plat)
    print("DESK_OVERLAY_OK=1")
    print("DESK_SOURCE_OK=1")


if __name__ == "__main__":
    main()
