# Fix workspace paths on the running desk. Does not stop TDHarness.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$srcLease = 'C:\Users\tdhssh\src\tdh-plugin-017\desk-lease.js'
$srcFix = 'C:\Users\tdhssh\src\TDHarness-coding\server\fix-workspace-live.js'
if (-not (Test-Path -LiteralPath $srcLease)) { throw 'lease-src-missing' }
if (-not (Test-Path -LiteralPath $srcFix)) { throw 'fix-src-missing' }
$leaseText = [IO.File]::ReadAllText($srcLease)
if ($leaseText -notmatch 'return livePath\(p\)') { throw 'lease-missing-realpath' }

$planted = Get-Item -Path 'C:\Users\*\TDH\CompanyDesk\desk-lease.js' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $planted) { throw 'planted-lease-missing' }
Copy-Item -Force -LiteralPath $srcLease -Destination $planted.FullName
Write-Output ('LEASE_PLANTED=' + $planted.FullName)

$node = Join-Path $planted.Directory.FullName 'node\node-real.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = Join-Path $planted.Directory.FullName 'node\node.exe' }
if (-not (Test-Path -LiteralPath $node)) { throw 'node-missing' }
& $node $srcFix
if ($LASTEXITCODE -ne 0) { throw 'workspace-live-failed' }
Write-Output 'TDH_STILL_UP=1'
