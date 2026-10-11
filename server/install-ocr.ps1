# OCR for the knowledge search: scanned PDF pages and pictures of documents.
# Makes its own venv (<Root>\ocr-venv) from this machine's Python 3.12, installs the pinned
# server\ocr-requirements.txt (RapidOCR on ONNX Runtime, pypdfium2), then draws a line of
# Chinese with a Windows font and reads it back with server\ocr.py. Only when that reads
# correctly does it write runtime\ocr.json, which is what turns OCR on in
# knowledge-search.js. Run again any time: an unchanged install is only re-tested.
#   powershell -ExecutionPolicy Bypass -File server\install-ocr.ps1 [-Root D:\dsh] [-Python <python.exe>] [-Proxy http://127.0.0.1:7890] [-Restart]
# -Restart restarts Autostart-KnowledgeSearch so it picks the change up.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([string]$Root = 'D:\dsh', [string]$Python = '', [string]$Proxy = '', [switch]$Restart)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
$Server = Split-Path -Parent $MyInvocation.MyCommand.Path
$Runtime = Join-Path $Root 'runtime'
$Venv = Join-Path $Root 'ocr-venv'
$VPy = Join-Path $Venv 'Scripts\python.exe'
$Req = Join-Path $Server 'ocr-requirements.txt'
$Conf = Join-Path $Runtime 'ocr.json'

if (-not $Python) {
  $c = Get-Command python -ErrorAction SilentlyContinue
  if ($c -and $c.Source -notmatch 'WindowsApps') { $Python = $c.Source }
  if (-not $Python) { $Python = @(Get-ChildItem 'C:\Program Files\Python31*\python.exe' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName -First 1) }
}
if (-not $Python -or -not (Test-Path -LiteralPath $Python)) { throw 'python-missing (pass -Python)' }
$ver = (& $Python -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
Write-Output ('PYTHON=' + $Python + ' ' + $ver)
if ($ver -notmatch '^3\.(9|10|11|12)$') { throw ('python-' + $ver + ': RapidOCR needs 3.9 to 3.12') }

$reqHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Req).Hash.ToLower()
$mark = Join-Path $Venv 'tdh-requirements.sha256'
$have = if (Test-Path -LiteralPath $mark) { (Get-Content -LiteralPath $mark -Raw).Trim() } else { '' }
if (-not (Test-Path -LiteralPath $VPy) -or $have -ne $reqHash) {
  if (-not (Test-Path -LiteralPath $VPy)) {
    & $Python -m venv $Venv
    if ($LASTEXITCODE) { throw 'venv-failed' }
  }
  $pipArgs = @('-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', $Req)
  if ($Proxy) { $pipArgs += @('--proxy', $Proxy) }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $log = & $VPy @pipArgs 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code) { ($log -split "`n" | Select-Object -Last 15) -join "`n" | Write-Output; throw 'pip-install-failed' }
  [IO.File]::WriteAllText($mark, $reqHash, [Text.UTF8Encoding]::new($false))
  Write-Output 'OCR_PACKAGES_INSTALLED=1'
} else {
  Write-Output 'OCR_PACKAGES_KEPT=1'
}

# Self-test: draw a line of Chinese with a font every Windows has, read it back.
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tdh-ocr-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $png = Join-Path $tmp 'probe.png'
  $draw = Join-Path $tmp 'draw.py'
  # The text is U+9000 ... in escapes so this file stays ASCII.
  $lines = @(
    'import sys, os',
    'from PIL import Image, ImageDraw, ImageFont',
    'text = "\u5ba2\u6237\u7533\u8bf7\u9000\u8d27\u540e\u4e03\u5929\u5185\u5bc4\u56de\uff0c\u8fd0\u8d39\u7531\u516c\u53f8\u627f\u62c5"',
    'fonts = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simsun.ttc", r"C:\Windows\Fonts\simhei.ttf", r"C:\Windows\Fonts\msjh.ttc"]',
    'font = next((ImageFont.truetype(f, 40) for f in fonts if os.path.exists(f)), None)',
    'if font is None: sys.exit("no-cjk-font")',
    'img = Image.new("RGB", (1000, 120), "white")',
    'ImageDraw.Draw(img).text((20, 30), text, fill="black", font=font)',
    'img.save(sys.argv[1])'
  )
  [IO.File]::WriteAllText($draw, ($lines -join "`n"), [Text.UTF8Encoding]::new($false))
  & $VPy -I $draw $png
  if ($LASTEXITCODE) { throw 'self-test-draw-failed' }
  $out = Join-Path $tmp 'probe.json'
  & $VPy -I (Join-Path $Server 'ocr.py') --file $png --out $out
  $got = [IO.File]::ReadAllText($out, [Text.Encoding]::UTF8)
  $want = [string][char]0x8fd0 + [char]0x8d39 + [char]0x7531 + [char]0x516c + [char]0x53f8
  if ($got.IndexOf($want) -lt 0) { Write-Output ('OCR_SELF_TEST_GOT=' + $got); throw 'self-test-misread' }
  Write-Output 'OCR_SELF_TEST_OK=1'
} finally {
  Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
}

$json = '{"python":' + (ConvertTo-Json $VPy) + ',"requirements":"' + $reqHash + '","checked":"' + (Get-Date).ToUniversalTime().ToString('s') + 'Z"}'
New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
[IO.File]::WriteAllText($Conf, $json, [Text.UTF8Encoding]::new($false))
Write-Output ('OCR_CONFIG=' + $Conf)

if ($Restart) {
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'knowledge-search\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName 'Autostart-KnowledgeSearch'
  Write-Output 'KNOWLEDGE_RESTARTED=1'
}
Write-Output 'OCR_READY=1'
