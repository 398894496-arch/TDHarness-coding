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
