# Authenticate the company SMB share for an employee Windows client.
# Ready means the UNC is a real directory. A leftover Z: in `net use` is not
# enough (项目说明书 §1 / 系统维护手册 company-workspace-missing).
# Password stays in a user file. Never printed. Never in the zip.
param(
  [string]$Lan = '{{TDH_HOST}}',
  [string]$Share = 'dsh-company',
  [string]$PassFile = '',
  [string]$Drive = 'Z:',
  # After D17 each person mounts with their own account. The login response
  # carries it (people-api.py smb_user); the default only keeps pre-migration
  # callers working.
  [string]$User = 'dshshare'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

if (-not $PassFile) {
  $PassFile = Join-Path $env:USERPROFILE '.dsh-company\.smb-dshshare'
}
$unc = '\\' + $Lan + '\' + $Share

if (Test-Path -LiteralPath $unc) {
  Write-Output 'MOUNT_ALREADY=1'
  Write-Output ('UNC=' + $unc)
  Write-Output 'WIN_CLIENT_MOUNT_OK=1'
  return
}

if (-not (Test-Path -LiteralPath $PassFile)) {
  Write-Output 'MOUNT_SKIP=passfile-missing'
  return
}
$pw = (Get-Content -LiteralPath $PassFile -TotalCount 1).Trim()
if ($pw.Length -lt 4) { throw 'passfile-empty' }

$ErrorActionPreference = 'Continue'
cmd.exe /c ('net use ' + $Drive + ' /delete /y') | Out-Null
cmd.exe /c ('net use "' + $unc + '" /delete /y') | Out-Null
cmd.exe /c ('net use "' + $unc + '" /user:' + $User + ' "' + $pw + '" /persistent:yes') | Out-Null
$rc = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($rc -ne 0 -or -not (Test-Path -LiteralPath $unc)) {
  Write-Output 'BLOCKED=net-use-failed'
  throw 'net-use-failed'
}
Write-Output ('UNC=' + $unc)
Write-Output 'WIN_CLIENT_MOUNT_OK=1'
