#!/usr/bin/env python3
"""The desk plugins' source (desk/plugins) is what sites run. Checks:

1. every .js file parses (node --check);
2. nothing of one company: no company or brand names of a particular site, no LAN or
   Tailscale addresses, no maintainer paths, no site login names (a site's own nouns go in
   its handbook and synonym list, its brand in a site patch filling SITE_BRAND_*);
3. every site patch still finds its anchors in this source (server/site-patches), so a
   change to a plugin cannot silently leave a site patch behind;
4. site-cs.py overlay-zip puts this source into a pack, in both places a pack keeps a plugin,
   with the site's address written in, and leaves the rest of the pack alone.

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
FORBIDDEN = {
    "a site's company name": r"橙池|orangecitypictures|珠海",
    "a site's brand": r"the-?diva|THE DIVA",
    "a LAN address": r"\b192\.168\.\d+\.\d+\b",
    "a Tailscale address": r"\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+\b",
    "a maintainer path": r"Cursor/dsh-saas|/Users/(?!x/)[A-Za-z0-9._-]+/",
    "a site login": r"\b(bosshome|zhangzhang\d*|xiaoman|laoyang\d*|hengge)\b",
    "a key or token": r"sk-[A-Za-z0-9]{16,}|dsh_[0-9a-f]{24,}|xai-[A-Za-z0-9]{16,}",
}


def fail(msg):
    print("DESK_SOURCE_FAIL=" + msg)
    sys.exit(1)


def main():
    files = [p for p in DESK.rglob("*") if p.is_file()]
    if not files:
        fail("no-desk-source")
    names = sorted(d.name for d in DESK.iterdir() if (d / "package.json").is_file())

    # 1. Parses.
    for p in files:
        if p.suffix == ".js":
            r = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
            if r.returncode:
                fail("syntax %s %s" % (p.relative_to(ROOT), (r.stderr or "").strip().splitlines()[-1:]))
    print("DESK_SYNTAX_OK=%d" % sum(1 for p in files if p.suffix == ".js"))

    # 2. Nothing of one company.
    for p in files:
        if p.suffix in (".png", ".jpg", ".ico"):
            fail("binary asset %s (a site's brand goes in a site patch)" % p.relative_to(ROOT))
        text = p.read_text(encoding="utf-8", errors="ignore")
        for what, pat in FORBIDDEN.items():
            m = re.search(pat, text, re.I)
            if m:
                fail("%s in %s: %r" % (what, p.relative_to(ROOT), m.group(0)))
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
        for p in files:
            rel = "plugins/" + p.relative_to(DESK).as_posix()
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

    # 4. overlay-zip.
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        (t / "site.yml").write_text("host: proof.local\nshare: dsh-company\nlogin_port: 8443\ngateway_port: 8450\ncompany_path: D:/dsh/company\n")
        z = t / "pack.zip"
        with zipfile.ZipFile(z, "w") as zz:
            zz.writestr("CompanyDesk/BUILD.json", json.dumps({"mark": "x"}))
            zz.writestr("CompanyDesk/plugins/dsh-artifact/package.json", "{}")
            for home in ("CompanyDesk/plugins/", "CompanyDesk/home/profiles/web/node_modules/"):
                for n in names:
                    zz.writestr(home + n + "/package.json", "{}")
                    zz.writestr(home + n + "/stale-left-over.js", "old")
        r = subprocess.run([sys.executable, str(ROOT / "server" / "site-cs.py"), "--site", str(t / "site.yml"), "overlay-zip",
                            "--src", str(z), "--plugins", str(DESK)], capture_output=True, text=True)
        if r.returncode:
            fail("overlay-zip " + (r.stderr or r.stdout)[-300:])
        with zipfile.ZipFile(z) as zz:
            got = set(zz.namelist())
            if any(n.endswith("stale-left-over.js") for n in got):
                fail("overlay left a template file in place")
            if "CompanyDesk/plugins/dsh-artifact/package.json" not in got or "CompanyDesk/BUILD.json" not in got:
                fail("overlay touched what it does not own")
            for home in ("CompanyDesk/plugins/", "CompanyDesk/home/profiles/web/node_modules/"):
                for p in files:
                    name = home + p.relative_to(DESK).as_posix()
                    if name not in got:
                        fail("overlay missed " + name)
            shell = zz.read("CompanyDesk/plugins/company-shell/lib/index.js")
            if b"{{TDH_HOST}}" in shell or b"proof.local" not in shell:
                fail("overlay did not write the site address into company-shell")
    print("DESK_OVERLAY_OK=1")
    print("DESK_SOURCE_OK=1")


if __name__ == "__main__":
    main()
