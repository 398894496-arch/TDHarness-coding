"""pack-update-check.js：换入 TDHarness.exe.new 之前先检查（幂等）。地址还是 {{TDH_HOST}} 占位符的旧编译、
或小得不像程序的文件，一律拒绝并改名隔离。2026-10-08 客户机实测：残留的 .new 被换上，一关一开就再也打不开。"""
import sys
from pathlib import Path

OLD = """  if (!fs.existsSync(staged)) return;
  const old = exe + ".old-" + Date.now();
"""
NEW = """  if (!fs.existsSync(staged)) return;
  // 没替换过站点地址的旧编译（地址仍是 {{TDH_HOST}} 占位符）一启动就崩，不能换进来。
  try {
    const raw = fs.readFileSync(staged);
    if (raw.length < 20 * 1024 || raw.includes(Buffer.from("{{TDH_HOST}}", "utf16le")) || raw.includes(Buffer.from("{{TDH_HOST}}", "latin1"))) {
      try { fs.renameSync(staged, staged + ".rejected-" + Date.now()); } catch { try { fs.unlinkSync(staged); } catch { /* */ } }
      out("EXE_SWAP_REJECT=placeholder");
      return;
    }
  } catch (err) {
    out("EXE_SWAP_REJECT=" + String(err && err.code || err).slice(0, 40));
    return;
  }
  const old = exe + ".old-" + Date.now();
"""


def patch(t):
    if "EXE_SWAP_REJECT" in t:
        return t, "already"
    if t.count(OLD) != 1:
        raise SystemExit("anchor-pack-update count=%d" % t.count(OLD))
    return t.replace(OLD, NEW, 1), "patched"


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
