param([Parameter(Mandatory = $true)][string]$Want)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$Safe = ($Want -replace '[./]', '-')
$Prefix = Join-Path 'D:\dsh\runtime' ('dsh-' + $Safe)
$pkg = Join-Path $Prefix 'node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $pkg)) { $pkg = Join-Path $Prefix 'lib\node_modules\@deepseek-ai\dsh\package.json' }
if (-not (Test-Path -LiteralPath $pkg)) { throw 'prefix-missing' }
$ver = (Get-Content -LiteralPath $pkg -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($ver -ne $Want) { throw ('prefix-ver-mismatch got=' + $ver) }

Get-Process -Name 'TDHarness','CompanyDesk' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match '^(node|node-real)\.exe$' -and (
      ($_.ExecutablePath -and ($_.ExecutablePath -like '*\TDH\*')) -or
      ($_.CommandLine -and ($_.CommandLine -like '*\TDH\*'))
    )
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

$planted = Get-ChildItem -Path 'C:\Users' -Filter 'TDHarness.exe' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\TDHarness\.exe$' } |
  Select-Object -First 1
if (-not $planted) { throw 'planted-exe-missing' }
$dest = Join-Path $planted.Directory.FullName 'prefix'
if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$rc = (Start-Process -FilePath 'robocopy.exe' -ArgumentList @($Prefix, $dest, '/E', '/COPY:DAT', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS') -Wait -PassThru).ExitCode
if ($rc -ge 8) { throw ('plant-copy-failed=' + $rc) }
$live = Join-Path $dest 'node_modules\@deepseek-ai\dsh\package.json'
if (-not (Test-Path -LiteralPath $live)) { $live = Join-Path $dest 'lib\node_modules\@deepseek-ai\dsh\package.json' }
$got = (Get-Content -LiteralPath $live -Raw -Encoding UTF8 | ConvertFrom-Json).version
if ($got -ne $Want) { throw ('planted-ver-mismatch got=' + $got) }
Write-Output ('PLANTED_DSH=' + $got)
Write-Output 'KERNEL_CUTOVER_OK=1'
