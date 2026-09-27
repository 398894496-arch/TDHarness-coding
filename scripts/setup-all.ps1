# One command after git clone. Administrator. Finds git/node/python, pulls LFS, installs the server.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pri = [Security.Principal.WindowsPrincipal]::new($id)
if (-not $pri.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'need-administrator'
}

function Find-Tool([string[]]$Names, [string[]]$Extra) {
  foreach ($n in $Names) {
    $c = Get-Command $n -ErrorAction SilentlyContinue
    if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { return $c.Source }
  }
  foreach ($p in $Extra) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

$git = Find-Tool @('git') @(
  (Join-Path $env:USERPROFILE 'tools\git\cmd\git.exe'),
  (Join-Path ${env:ProgramFiles} 'Git\cmd\git.exe')
)
$node = Find-Tool @('node') @(
  (Join-Path $env:USERPROFILE 'tools\node\node.exe'),
  (Join-Path $env:USERPROFILE '.tdh-coding-prefix\node.exe'),
  (Join-Path ${env:ProgramFiles} 'nodejs\node.exe')
)
$py = Find-Tool @('python', 'python3') @(
  (Get-ChildItem -Path 'C:\Program Files\Python*' -Filter python.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName)
)
if (-not $git) { throw 'git-missing' }
if (-not $node) { throw 'node-missing' }
if (-not $py) { throw 'python-missing' }
$env:Path = (Split-Path $git) + ';' + (Split-Path $node) + ';' + (Split-Path $py) + ';' + $env:Path
Write-Output ('GIT=' + $git)
Write-Output ('NODE=' + $node)
Write-Output ('PYTHON=' + $py)

$Repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath (Join-Path $Repo 'scripts\setup-server.ps1'))) {
  throw 'run-from-cloned-repo'
}
Set-Location -LiteralPath $Repo
if (Test-Path -LiteralPath (Join-Path $Repo '.git')) {
  & $git lfs install | Out-Null
  & $git lfs pull
  if ($LASTEXITCODE -ne 0) { throw 'git-lfs-pull-failed' }
}
$winZip = Join-Path $Repo 'client\CompanyDesk-win.zip'
$caddy = Join-Path $Repo 'server\caddy.exe'
if (-not (Test-Path -LiteralPath $winZip) -or (Get-Item -LiteralPath $winZip).Length -lt 20MB) {
  throw 'client-win-zip-missing-git-lfs-pull'
}
if (-not (Test-Path -LiteralPath $caddy) -or (Get-Item -LiteralPath $caddy).Length -lt 1MB) {
  throw 'caddy-exe-missing-git-lfs-pull'
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\setup-server.ps1') -Repo $Repo
if ($LASTEXITCODE -ne 0) { throw 'server-setup-failed' }

$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
  Write-Output 'KERNEL_SETUP=1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Repo 'scripts\setup.ps1')
  Write-Output ('KERNEL_EXIT=' + $LASTEXITCODE)
} else {
  Write-Output 'KERNEL_SETUP=skip-npm-missing'
}
Write-Output 'ALL_OK=1'
