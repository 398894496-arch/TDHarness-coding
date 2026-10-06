# The brain's daily job: read yesterday's conversations where they already are
# (each seat's .dsh-desk on the company folder), write the evidence layer,
# distil one page per person per day, harvest corrections, and put what
# qualifies up for adoption. Nothing leaves this machine except the distilling
# prompt, which goes to the model through this server's own gateway.
#
#   powershell -ExecutionPolicy Bypass -File server\brain\run-daily.ps1 [-Root D:\dsh] [-Node <node.exe>] [-Target yyyy-mm-dd] [-DryRun]
#
# Registered by setup-server.ps1 as the task TDH-Brain-Daily (every day, 00:15).
param(
  [string]$Root = 'D:\dsh',
  [string]$Node = '',
  [string]$Target = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
foreach ($k in 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
$env:NO_PROXY = '*'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Node) {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $Node = $cmd.Source }
}
if (-not $Node -or -not (Test-Path -LiteralPath $Node)) { throw 'node-missing (pass -Node)' }
$brain = Join-Path $Root 'brain'
$log = Join-Path $brain '90-system\brain-daily'
New-Item -ItemType Directory -Force $log | Out-Null

# The page for each person is written by the model, through the gateway on this machine.
$env:L1_DISTILL = '1'
$env:L1_DISTILL_URL = 'http://127.0.0.1:8450/v1'
$argv = @((Join-Path $here 'brain-daily.js'), '--distill', '--brain-root', $brain, '--company-root', (Join-Path $Root 'company'), '--people-roster', (Join-Path $Root 'runtime\roster.json'))
if (-not $DryRun) { $argv += @('--write', '--allow-prod') }
if ($Target) { $argv += @('--target', $Target) }
$out = & $Node @argv 2>&1 | Out-String
$out | Set-Content -LiteralPath (Join-Path $log 'last-run.log') -Encoding UTF8
Write-Output $out
if ($LASTEXITCODE -ne 0) { throw 'brain-daily-failed' }
