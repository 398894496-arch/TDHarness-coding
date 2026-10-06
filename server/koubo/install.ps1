# Installs the talking-head editing toolkit (koubo) beside the server's other
# tools: its own Python environment, nothing system-wide. Run it again after
# pulling the repo to update the tool; the environment and everything the tool
# has downloaded (models, fonts, music, sound effects) are kept.
#
#   powershell -ExecutionPolicy Bypass -File server\koubo\install.ps1 [-Root D:\dsh\tools\koubo] [-Python <python.exe 3.10-3.12>] [-Index <pip index url>]
#
# The agent calls <Root>\koubo.cmd. Jianying (CapCut desktop, China edition)
# must be installed for the account that opens the drafts; ffmpeg comes with
# the desk client, or set KOUBO_FFMPEG.
param(
  [string]$Root = 'D:\dsh\tools\koubo',
  [string]$Python = '',
  [string]$Index = ''
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force $Root | Out-Null

if (-not $Python) {
  foreach ($v in '3.12', '3.11', '3.10') {
    $found = & py "-$v" -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $found) { $Python = $found.Trim(); break }
  }
}
if (-not $Python -or -not (Test-Path $Python)) { throw 'koubo needs Python 3.10 to 3.12 (the speech model has no build for newer ones yet). Install one, or pass -Python.' }

$venvPy = Join-Path $Root 'venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) { & $Python -m venv (Join-Path $Root 'venv') }
$pip = @('-m', 'pip', 'install', '-q')
if ($Index) { $pip += @('-i', $Index) }
& $venvPy @pip --upgrade pip
& $venvPy @pip -r (Join-Path $here 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip could not install the requirements' }

foreach ($f in 'koubo.py', 'design.py', 'preview.py', 'koubo.cmd', 'requirements.txt') {
  Copy-Item -LiteralPath (Join-Path $here $f) -Destination (Join-Path $Root $f) -Force
}
Get-ChildItem -LiteralPath $here -Filter '*.md' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Root $_.Name) -Force }
# The style files are the owner's to edit: each is only written when it is not there yet.
$style = Join-Path $Root 'style'
New-Item -ItemType Directory -Force $style | Out-Null
Get-ChildItem -LiteralPath (Join-Path $here 'style') -Filter '*.json' | ForEach-Object {
  $to = Join-Path $style $_.Name
  if (-not (Test-Path -LiteralPath $to)) { Copy-Item -LiteralPath $_.FullName -Destination $to }
}
# Every account on the machine may use the tool and add to what it downloads.
icacls $Root /grant '*S-1-5-11:(OI)(CI)M' /T /Q | Out-Null

& (Join-Path $Root 'koubo.cmd') check
Write-Output ('KOUBO_INSTALL_OK=1 ' + $Root)
