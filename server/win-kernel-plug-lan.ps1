param([Parameter(Mandatory = $true)][string]$Want)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
foreach ($k in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')) {
  Remove-Item ('Env:' + $k) -ErrorAction SilentlyContinue
}
if ($Want -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.]+)?$') { throw 'bad-version' }
$Safe = ($Want -replace '[./]', '-')
$Prefix = Join-Path 'D:\dsh\runtime' ('dsh-' + $Safe)
$PatchRoot = 'D:\dsh\runtime\kernel-patch'
$PatchJs = Join-Path $PatchRoot 'apply-kernel-patches.js'
$Strip = Join-Path $PatchRoot 'strip-creative-preset.ps1'
if (-not (Test-Path -LiteralPath $PatchJs)) { throw 'patch-js-missing' }
if (-not (Test-Path -LiteralPath $Strip)) { throw 'strip-missing' }

$node = $null
$npm = $null
$plantedNode = Get-ChildItem -Path 'C:\Users' -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\node\\node\.exe$' } |
  Select-Object -First 1
if ($plantedNode) {
  $node = $plantedNode.FullName
  $npmCand = Join-Path $plantedNode.Directory.FullName 'npm.cmd'
  if (Test-Path -LiteralPath $npmCand) { $npm = $npmCand }
}
if (-not $node) {
  foreach ($n in @('node')) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $node = $c.Source; break }
  }
}
if (-not $npm) {
  $c = Get-Command npm -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $npm = $c.Source }
}
if (-not $node) { throw 'node-missing' }
if (-not $npm) { throw 'npm-missing' }

$env:Path = (Split-Path $node) + ';' + $env:Path
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
$env:NO_PROXY = '*'
$env:NODE_USE_ENV_PROXY = '0'
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
Write-Output ('KERNEL_PLUG=' + $Want)
Write-Output ('PREFIX=' + $Prefix)
& $npm install -g --prefix $Prefix ('@deepseek-ai/dsh@' + $Want)
if ($LASTEXITCODE -ne 0) {
  & $npm install -g --prefix $Prefix --registry https://registry.npmmirror.com ('@deepseek-ai/dsh@' + $Want)
  if ($LASTEXITCODE -ne 0) { throw 'npm-install-failed' }
}
& $node $PatchJs $Prefix
if ($LASTEXITCODE -ne 0) { throw 'kernel-patch-failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Strip -Prefix $Prefix -Role employee
if ($LASTEXITCODE -ne 0) { throw 'strip-failed' }
$pkg = Join-Path $Prefix 'node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $pkg)) { $pkg = Join-Path $Prefix 'lib\node_modules\@deepseek-ai\dsh\package.json' }
$ver = (Get-Content -LiteralPath $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($ver -ne $Want) { throw ('dsh-version want=' + $Want + ' got=' + $ver) }
Write-Output ('DSH_VER=' + $ver)

# Boot the new kernel against a copy of the desk's own home before anyone is
# switched to it. Installed and patched is not the same as working: a kernel
# the company plugins do not fit installs and patches fine.
$selftest = Join-Path $PSScriptRoot 'kernel-selftest.mjs'
if (-not (Test-Path -LiteralPath $selftest)) { throw 'selftest-missing' }
$deskUser = Get-ChildItem 'C:\Users' -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path (Join-Path $_.FullName 'TDH\CompanyDesk') } | Select-Object -First 1
if (-not $deskUser) { throw 'desk-missing' }
$deskHome = Join-Path $deskUser.FullName ('.dsh-company-rc' + '8\desk-home')
$ErrorActionPreference = 'Continue'
& $node $selftest --prefix $Prefix --home $deskHome --node $node --report (Join-Path $Prefix 'selftest.json') 2>&1 | ForEach-Object { [string]$_ }
$st = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($st -ne 0) { throw 'selftest-failed (see selftest.json in the prefix)' }
Write-Output 'KERNEL_PLUG_OK=1'
