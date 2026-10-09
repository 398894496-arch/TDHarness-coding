"""tree-restore.sh / tree-restore.ps1：更新包下载可断点续传、自动重试（幂等）。
2026-10-09 实测：离开办公室经 Tailscale 中继下载 414 MB，约 110 KB/s，中途被重置
（curl: (56) Connection reset by peer），整次更新失败、退回旧版。现在断了从断点接着下，最多试 30 次；
每次连接 60 秒没有进度就重连。服务器（Caddy file_server）支持 Range。"""
import sys
from pathlib import Path

MARK = "@@resume-download"

SH_OLD = """  curl -fsSk --noproxy '*' -o "$ZIP" "$ZIPURL" &
"""
SH_NEW = """  # 断点续传 + 重试。@@resume-download
  fetch_zip() {
    local n=0
    while (( n < 30 )); do
      if curl -fsSk --noproxy '*' --connect-timeout 20 --speed-limit 1024 --speed-time 60 -C - -o "$ZIP" "$ZIPURL"; then
        return 0
      fi
      n=$((n + 1))
      echo "TREE_DOWNLOAD_RETRY=$n at $(stat -f%z "$ZIP" 2>/dev/null || echo 0)" >&2
      sleep 3
    done
    return 1
  }
  fetch_zip &
"""

PS1_OLD = """  $req = [Net.HttpWebRequest]::Create($ZipUrl)
  $req.Method = 'GET'
  $req.Timeout = 600000
  $req.ReadWriteTimeout = 600000
  $resp = $req.GetResponse()
  try {
    $src = $resp.GetResponseStream()
    $dst = [IO.File]::Create($Zip)
    try {
      $buf = New-Object byte[] (256 * 1024)
      $total = [long]$resp.ContentLength
      $done = [long]0
      $tick = [Diagnostics.Stopwatch]::StartNew()
      Progress 'download' 0 $total
      while (($n = $src.Read($buf, 0, $buf.Length)) -gt 0) {
        $dst.Write($buf, 0, $n)
        $done += $n
        if ($tick.ElapsedMilliseconds -ge 500) { Progress 'download' $done $total; $tick.Restart() }
      }
      Progress 'download' $done $total
    } finally { $dst.Close() }
  } finally { $resp.Close() }
"""
PS1_NEW = """  # Resume + retry. @@resume-download
  # Over a relayed link a 400 MB pack was reset half way and the whole update failed.
  $done = [long]0
  $total = [long]-1
  $attempt = 0
  $tick = [Diagnostics.Stopwatch]::StartNew()
  Progress 'download' 0 0
  while ($true) {
    try {
      $req = [Net.HttpWebRequest]::Create($ZipUrl)
      $req.Method = 'GET'
      $req.Timeout = 60000
      $req.ReadWriteTimeout = 120000
      if ($done -gt 0) { $req.AddRange($done) }
      $resp = $req.GetResponse()
      try {
        if ($done -gt 0 -and [int]$resp.StatusCode -ne 206) { $done = [long]0 }
        if ($total -lt 0 -or $done -eq 0) { $total = $done + [long]$resp.ContentLength }
        $mode = if ($done -gt 0) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
        $src = $resp.GetResponseStream()
        $dst = [IO.File]::Open($Zip, $mode, [IO.FileAccess]::Write)
        try {
          $buf = New-Object byte[] (256 * 1024)
          while (($n = $src.Read($buf, 0, $buf.Length)) -gt 0) {
            $dst.Write($buf, 0, $n)
            $done += $n
            if ($tick.ElapsedMilliseconds -ge 500) { Progress 'download' $done $total; $tick.Restart() }
          }
        } finally { $dst.Close() }
      } finally { $resp.Close() }
      if ($total -gt 0 -and $done -lt $total) { throw ('short-read ' + $done + '/' + $total) }
      break
    } catch {
      $attempt++
      if ($attempt -ge 30) { throw }
      Write-Output ('TREE_DOWNLOAD_RETRY=' + $attempt + ' at ' + $done)
      Start-Sleep -Seconds 3
    }
  }
  Progress 'download' $done $total
"""


def patch(name, t):
    if MARK in t:
        return t, "already"
    if name == "tree-restore.sh":
        if t.count(SH_OLD) != 1:
            raise SystemExit("anchor-resume-sh count=%d" % t.count(SH_OLD))
        return t.replace(SH_OLD, SH_NEW, 1), "patched"
    if name == "tree-restore.ps1":
        if t.count(PS1_OLD) != 1:
            raise SystemExit("anchor-resume-ps1 count=%d" % t.count(PS1_OLD))
        return t.replace(PS1_OLD, PS1_NEW, 1), "patched"
    return t, "skip"


def patch_bytes(name, data):
    bom = data[:3] == b"\xef\xbb\xbf"
    s = data.decode("utf-8-sig"); crlf = "\r\n" in s
    t, how = patch(name, s.replace("\r\n", "\n"))
    if how != "patched":
        return data, how
    if crlf: t = t.replace("\n", "\r\n")
    return (b"\xef\xbb\xbf" if bom else b"") + t.encode("utf-8"), how


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); new, how = patch_bytes(p.name, p.read_bytes())
        if how == "patched": p.write_bytes(new)
        print(a, how)
