# Unpack the LAN zip into the signed-in user's TDH folder and put a shortcut on the desktop.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$Dist = 'D:\dsh\client-dist'
$Zip = Join-Path $Dist 'CompanyDesk-win.zip'
if (-not (Test-Path -LiteralPath $Zip)) { throw 'client-zip-missing' }
if ((Get-Item -LiteralPath $Zip).Length -lt 20MB) { throw 'client-zip-too-small' }

$console = $null
try { $console = (Get-CimInstance Win32_ComputerSystem).UserName } catch {}
if (-not $console -or $console -notmatch '\\') { throw 'console-user-missing' }
$login = $console.Split('\')[-1]
$prof = $null
try {
  $sid = ([System.Security.Principal.NTAccount]$console).Translate([System.Security.Principal.SecurityIdentifier]).Value
  $prof = (Get-CimInstance Win32_UserProfile -Filter ("SID='$sid'")).LocalPath
} catch {}
if (-not $prof) {
  $guess = Join-Path 'C:\Users' $login
  if (Test-Path -LiteralPath $guess) { $prof = $guess }
}
if (-not $prof) { throw 'console-profile-missing' }

Get-Process -Name 'TDHarness' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$dest = Join-Path $prof 'TDH'
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (-not (Test-Path -LiteralPath $tar)) { throw 'tar-missing' }
& $tar -xf $Zip -C $dest
if ($LASTEXITCODE -ne 0) { throw 'tar-failed' }

$app = Get-ChildItem -LiteralPath $dest -Filter 'TDHarness.exe' -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $app) { throw 'app-missing-after-unpack' }
$root = $app.Directory.FullName
Write-Output ('CLIENT_ROOT=' + $root)

$shim = @(
  '"use strict";',
  'if (process.platform !== "win32") return;',
  'var fs = require("fs");',
  'var path = require("path");',
  'var spawnSync = require("child_process").spawnSync;',
  'function winJunction(link, target) {',
  '  try { fs.mkdirSync(path.dirname(link), { recursive: true }); } catch (e) {}',
  '  try {',
  '    var st = fs.lstatSync(link);',
  '    if (st.isSymbolicLink() || st.isFile()) fs.unlinkSync(link);',
  '    else if (st.isDirectory()) fs.rmSync(link, { recursive: true, force: true });',
  '  } catch (e) {}',
  '  var r = spawnSync("cmd.exe", ["/c", "mklink", "/J", link, target], { encoding: "utf8", windowsHide: true, cwd: process.env.SystemRoot || "C:\\Windows" });',
  '  if (r.status === 0) return;',
  '  var err = new Error("dsh: win-junction-failed " + link + " -> " + target);',
  '  err.code = "EPERM";',
  '  throw err;',
  '}',
  'fs.symlinkSync = function (target, link) { winJunction(link, target); };',
  'if (fs.promises) fs.promises.symlink = async function (target, link) { winJunction(link, target); };',
  ''
) -join "`n"
[IO.File]::WriteAllText((Join-Path $root 'win-junction-shim.cjs'), $shim, [Text.UTF8Encoding]::new($false))

$nodeDir = Join-Path $root 'node'
$nodeExe = Join-Path $nodeDir 'node.exe'
$nodeReal = Join-Path $nodeDir 'node-real.exe'
if (Test-Path -LiteralPath $nodeReal) {
  if (Test-Path -LiteralPath $nodeExe) { Remove-Item -LiteralPath $nodeExe -Force }
  Move-Item -LiteralPath $nodeReal -Destination $nodeExe
}
if (-not (Test-Path -LiteralPath $nodeExe)) { throw 'bundled-node-missing' }
if ((Get-Item -LiteralPath $nodeExe).Length -lt 1MB) { throw 'bundled-node-is-wrap' }

$desk = Join-Path $prof 'Desktop'
New-Item -ItemType Directory -Force -Path $desk | Out-Null
$lnk = Join-Path $desk 'TDHarness.lnk'
$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut($lnk)
$s.TargetPath = $app.FullName
$s.WorkingDirectory = $root
$s.Save()
Write-Output ('SHORTCUT=' + $lnk)
Write-Output 'PLANT_CLIENT_OK=1'
