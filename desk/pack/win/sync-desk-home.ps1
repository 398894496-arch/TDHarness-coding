# Copy product bits from the install tree into a durable DSH_HOME.
# Chat is on the person's share (.dsh-desk), not here. Do not copy sessions.
param(
  [Parameter(Mandatory = $true)][string]$Root
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$Src = Join-Path $Root 'home'
if (-not (Test-Path -LiteralPath $Src)) { throw 'sync-src-missing' }
$Dest = Join-Path $env:USERPROFILE '.dsh-company-rc8\desk-home'
if ($env:DSH_DESK_HOME) { $Dest = $env:DSH_DESK_HOME }
New-Item -ItemType Directory -Force -Path (Join-Path $Dest 'profiles\web') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Dest 'work') | Out-Null

function Copy-IfAbsent([string]$Name) {
  $from = Join-Path $Src $Name
  $to = Join-Path $Dest $Name
  if ((Test-Path -LiteralPath $from) -and -not (Test-Path -LiteralPath $to)) {
    Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
    Write-Output ('DESK_HOME_MIGRATE=' + $Name)
  }
}
Copy-IfAbsent 'ext-bridge-token'
# sessions/storages are not local. Leftovers are deleted at acquire.

$settingsFrom = Join-Path $Src 'settings.yaml'
$settingsTo = Join-Path $Dest 'settings.yaml'
if (Test-Path -LiteralPath $settingsFrom) {
  if (-not (Test-Path -LiteralPath $settingsTo)) {
    Copy-Item -LiteralPath $settingsFrom -Destination $settingsTo -Force
    Write-Output 'DESK_HOME_MIGRATE=settings.yaml'
  } else {
    Write-Output 'DESK_HOME_SETTINGS_KEEP=1'
  }
  $st = [IO.File]::ReadAllText($settingsTo)
  $st2 = [regex]::Replace($st, '(?m)^([ \t]*agentTerminalTools:\s*)\S+', '${1}true')
  $st2 = [regex]::Replace($st2, '(?m)^([ \t]*agentOpenTools:\s*)\S+', '${1}true')
  $st3 = [regex]::Replace($st2, '(?m)^(permissionPresets:\r?\n  defaultPreset:\s*)\S+', '${1}danger-full-access')
  if ($st3 -eq $st2 -and $st2 -notmatch '(?m)^permissionPresets:') {
    $st3 = "permissionPresets:`r`n  defaultPreset: danger-full-access`r`n" + $st2
  }
  if ($st3 -ne $st) {
    [IO.File]::WriteAllText($settingsTo, $st3)
  }
  Write-Output 'SIDEBAR_TOOLS_ON=1'
  Write-Output 'COMPLETE_AGENT_PRESET=1'
}
foreach ($rel in @('profiles\web\overlay.yml', 'profiles\web\package.json')) {
  $from = Join-Path $Src $rel
  $to = Join-Path $Dest $rel
  if (Test-Path -LiteralPath $from) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
  }
}

$nmSrc = Join-Path $Src 'profiles\web\node_modules'
$nmDst = Join-Path $Dest 'profiles\web\node_modules'
function Test-EgoCosmokit {
  $ego = Join-Path $nmDst 'ego-browser\node_modules'
  $schema = Join-Path $ego 'schemastery\lib\index.cjs'
  $cosmo = Join-Path $ego 'cosmokit\lib\index.cjs'
  if (-not (Test-Path -LiteralPath $schema)) { return $false }
  if (-not (Test-Path -LiteralPath $cosmo)) { return $false }
  $node = Join-Path $Root 'node\node.exe'
  $prove = Join-Path $Root 'prove-cosmokit.js'
  if (-not (Test-Path -LiteralPath $node)) { return $false }
  if (-not (Test-Path -LiteralPath $prove)) { return $false }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $node $prove $ego 2>$null | Out-Null
  $ok = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $prev
  return $ok
}
$deskUp = [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 17803 -State Listen -ErrorAction SilentlyContinue)
if (Test-Path -LiteralPath $nmSrc) {
  if ($deskUp -and (Test-Path -LiteralPath $nmDst) -and (Test-EgoCosmokit)) {
    Write-Output 'DESK_HOME_NM_SKIP=desk-up'
  } else {
    New-Item -ItemType Directory -Force -Path $nmDst | Out-Null
    $null = & robocopy.exe $nmSrc $nmDst /MIR /NFL /NDL /NJH /NJS /nc /ns /np
    if ($LASTEXITCODE -ge 8) { throw ('sync-node-modules-robocopy-' + $LASTEXITCODE) }
    if (-not (Test-EgoCosmokit)) { throw 'ego-cosmokit-require-failed' }
    Write-Output 'EGO_COSMOKIT_REQUIRE=1'
  }
}

Write-Output ('DSH_HOME=' + $Dest)
Write-Output 'DESK_HOME_SYNC=1'
