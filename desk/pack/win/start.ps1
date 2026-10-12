# Portable CompanyDesk. Bundled node + prefix + fonts. No system dsh. No TTY.
param(
  [switch]$Hidden,
  [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
if (-not $Hidden) {
  $arg = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath, '-Hidden')
  if ($NoOpen) { $arg += '-NoOpen' }
  Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arg -WindowStyle Hidden | Out-Null
  exit 0
}
$Root = $PSScriptRoot
function Get-NodeBin([string]$Here) {
  $real = Join-Path $Here 'node\node-real.exe'
  if (Test-Path -LiteralPath $real) { return $real }
  return (Join-Path $Here 'node\node.exe')
}
$Node = Get-NodeBin $Root
Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
$Bin = Join-Path $Root 'prefix\lib\node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path -LiteralPath $Bin)) {
  $Bin = Join-Path $Root 'prefix\node_modules\@deepseek-ai\dsh\lib\bin.js'
}
$syncHome = Join-Path $Root 'sync-desk-home.ps1'
if (Test-Path -LiteralPath $syncHome) {
  & $syncHome -Root $Root
}
# company-login-screen-update-v1
# Already-installed: offer one-click update before token / lease / desk.
$updJs = Join-Path $Root 'pack-update-check.js'
if ((Test-Path -LiteralPath $updJs) -and (Test-Path -LiteralPath (Join-Path $Root 'BUILD.json'))) {
  $updUrl = 'https://{{TDH_HOST}}:8443/client/version.json'
  $updOut = & $Node $updJs --root $Root --url $updUrl 2>&1 | Out-String
  Write-Output $updOut
  if ($updOut -match 'UPDATE_AVAILABLE=1') {
    $servedMark = ''
    if ($updOut -match 'SERVED_MARK=([0-9a-f]{32})') { $servedMark = $Matches[1] }
    $choice = 7
    try {
      $w = New-Object -ComObject WScript.Shell
      $choice = $w.Popup("公司已发新版。`r`n是 = 一键更新（不用打开下载页）`r`n否 = 稍后再说`r`n取消 = 退出", 0, 'TDHarness', 3)
    } catch { $choice = 7 }
    if ($choice -eq 2) { throw 'update-abort' }
    if ($choice -eq 6) {
      $restore = Join-Path $Root 'tree-restore.ps1'
      if (-not (Test-Path -LiteralPath $restore)) { throw 'tree-restore-missing' }
      try {
        $w.Popup("正在下载并安装新版。", 3, 'TDHarness', 64) | Out-Null
      } catch {}
      & $restore -Root $Root
      if ($LASTEXITCODE -ne 0) { throw 'tree-restore-failed' }
      if (Test-Path -LiteralPath $syncHome) { & $syncHome -Root $Root }
      try {
        $w.Popup("更新完成。请重新登录。", 2, 'TDHarness', 64) | Out-Null
      } catch {}
      $re = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $PSCommandPath, '-Hidden')
      if ($NoOpen) { $re += '-NoOpen' }
      Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $re -WindowStyle Hidden | Out-Null
      exit 0
    } elseif ($servedMark -match '^[0-9a-f]{32}$') {
      & $Node $updJs --defer $servedMark | Out-Null
      Write-Output 'UPDATE_LATER=1'
    }
  }
}
$env:DSH_HOME = Join-Path $env:USERPROFILE '.dsh-company-rc8\desk-home'
if ($env:DSH_DESK_HOME) { $env:DSH_HOME = $env:DSH_DESK_HOME }
$Overlay = Join-Path $env:DSH_HOME 'profiles\web\overlay.yml'
$Work = Join-Path $env:DSH_HOME 'work'
$Mounter = Join-Path $Root 'win-client-mount.ps1'
$ShareUnc = '\\{{TDH_HOST}}\dsh-company'
if (Test-Path -LiteralPath $Mounter) {
  & $Mounter
}
# Workspace is the company share (项目说明书 §1). A leftover Z: can exist in
# `net use` and still not be a real directory; AppHost.ToSharePath uses UNC.
if (Test-Path -LiteralPath $ShareUnc) { $Work = $ShareUnc }
elseif (Test-Path -LiteralPath 'Z:\') { $Work = 'Z:\' }
if ($Work -notlike '\\*') {
  New-Item -ItemType Directory -Force -Path $Work | Out-Null
}
$FontSrc = Join-Path $Root 'fonts\NotoSansCJKsc-Regular.otf'
if (-not (Test-Path -LiteralPath $FontSrc)) { throw 'bundled-font-missing' }
$Port = 17803
if (-not (Test-Path -LiteralPath $Node)) { throw 'bundled-node-missing' }
if (-not (Test-Path -LiteralPath $Bin)) { throw 'bundled-prefix-missing' }
if (-not (Test-Path -LiteralPath $Overlay)) { throw 'bundled-overlay-missing' }

$fontDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
New-Item -ItemType Directory -Force -Path $fontDir | Out-Null
$fontDst = Join-Path $fontDir 'NotoSansCJKsc-Regular.otf'
Copy-Item -LiteralPath $FontSrc -Destination $fontDst -Force
$reg = 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts'
if (-not (Test-Path $reg)) { New-Item -Path $reg -Force | Out-Null }
New-ItemProperty -Path $reg -Name 'Noto Sans CJK SC Regular (TrueType)' -Value $fontDst -PropertyType String -Force | Out-Null
Add-Type -Name FontApi -Namespace Win32 -MemberDefinition @'
[DllImport("gdi32.dll", CharSet=CharSet.Unicode)]
public static extern int AddFontResourceEx(string lpszFilename, uint fl, IntPtr pdv);
'@ -ErrorAction SilentlyContinue
if ([type]::GetType('Win32.FontApi')) {
  [Win32.FontApi]::AddFontResourceEx($fontDst, 0, [IntPtr]::Zero) | Out-Null
}

$skillDir = $null
$uncSkills = Join-Path $ShareUnc '_skills'
if (Test-Path -LiteralPath $uncSkills) { $skillDir = $uncSkills }
elseif (Test-Path -LiteralPath 'Z:\_skills') { $skillDir = 'Z:\_skills' }
elseif (Test-Path -LiteralPath (Join-Path $env:USERPROFILE 'company\_skills')) {
  $skillDir = Join-Path $env:USERPROFILE 'company\_skills'
}
$utf8 = [Text.UTF8Encoding]::new($false)
$ov = [IO.File]::ReadAllText($Overlay, $utf8)
$ov2 = $ov
$door = 'http://{{TDH_HOST}}:8450'
if ($door -match '__SITE_') { throw 'unrendered-site-token' }
foreach ($id in @('web-search-deepseek', 'web', 'tool-web', 'company-web-search')) {
  $ov2 = [regex]::Replace($ov2, '(?m)^- id: ' + [regex]::Escape($id) + '\r?\n(?:  .*\r?\n)*', '')
}
$searchBlock = @"
- id: web-search-deepseek
  disabled: true
- id: web
  config:
    searchProvider: company
    fetchProvider: company
- id: tool-web
  config:
    fetch: true
    searchTimeoutMs: 60000
    fetchTimeoutMs: 90000
- id: company-web-search
  config:
    baseURL: $door
"@
$firstId = $ov2.IndexOf('- id: ')
if ($firstId -ge 0) {
  $ov2 = $ov2.Substring(0, $firstId) + $searchBlock.TrimEnd() + "`n" + $ov2.Substring($firstId)
}
if ($ov2 -match 'api\.deepseek\.com') { throw 'overlay-named-upstream' }
if ($ov2 -match '/anthropic') { throw 'overlay-still-official-search-door' }
$deskSkills = ((Join-Path $env:USERPROFILE '.dsh-company-rc8\skills') -replace '\\', '/')
$ov2 = $ov2.Replace('__DESK_SKILLS__', $deskSkills)
$deskHomeFwd = (($env:DSH_HOME) -replace '\\', '/')
if ($deskHomeFwd) { $ov2 = $ov2.Replace('__DESK_HOME__', $deskHomeFwd) }
$ov2 = [regex]::Replace($ov2, '(?m)^\s+- .*/_skills\s*$', '')
$ov2 = [regex]::Replace($ov2, '(?m)^\s+- _skills\s*$', '')
# company-click-one-hand-v1
$ov2 = [regex]::Replace($ov2, '(?m)^- id: bridge-browser\r?\n(?:  .*\r?\n)*', '')
$ov2 = [regex]::Replace($ov2, '(?m)^- id: company-open-browser\r?\n(?:  .*\r?\n)*', '')
$ov2 = [regex]::Replace($ov2, '(?m)^- id: ego-browser\r?\n(?:  .*\r?\n)*', '')
$bridgeBlock = @"
- id: bridge-browser
  disabled: true
  config:
    sessionWorkspacePath: ""
    deferSessionCreate: true
- id: ego-browser
  name: ego-browser
  disabled: true
- id: company-open-browser
  disabled: true
"@
$firstBridge = $ov2.IndexOf('- id: ')
if ($firstBridge -ge 0) {
  $ov2 = $ov2.Substring(0, $firstBridge) + $bridgeBlock.TrimEnd() + "`n" + $ov2.Substring($firstBridge)
}
if ($ov2 -ne $ov) {
  [IO.File]::WriteAllText($Overlay, $ov2, $utf8)
}
$extDir = Join-Path $Root 'browser-extension'
if (Test-Path -LiteralPath $extDir) {
  [IO.File]::WriteAllText((Join-Path $extDir 'desk-bridge.json'), ('{"http":"http://127.0.0.1:' + $Port + '"}' + "`n"), $utf8)
  $env:COMPANY_BRIDGE_EXT = $extDir
  $rc8 = Join-Path $env:USERPROFILE '.dsh-company-rc8'
  New-Item -ItemType Directory -Force -Path $rc8 | Out-Null
  [IO.File]::WriteAllText((Join-Path $rc8 'bridge-ext.path'), ($extDir + "`n"))
}
$preset = Join-Path $Root 'prefix\node_modules\@deepseek-ai\dsh\config\agent-presets\standard\agent.cordis.yml'
if (-not (Test-Path -LiteralPath $preset)) {
  $preset = Join-Path $Root 'prefix\lib\node_modules\@deepseek-ai\dsh\config\agent-presets\standard\agent.cordis.yml'
}
if (Test-Path -LiteralPath $preset) {
  $pr = [IO.File]::ReadAllText($preset, $utf8)
  $pr2 = $pr.Replace('__DESK_SKILLS__', $deskSkills)
  $pr2 = [regex]::Replace($pr2, '(?m)^\s+- .*/_skills\s*$', '')
  $pr2 = [regex]::Replace($pr2, '(?m)^\s+- _skills\s*$', '')
  if ($pr2 -ne $pr) { [IO.File]::WriteAllText($preset, $pr2, $utf8) }
}
$syncJs = Join-Path $Root 'sync-skills.js'
$nodeExe = Get-NodeBin $Root
if ((Test-Path -LiteralPath $syncJs) -and (Test-Path -LiteralPath $nodeExe)) {
  $seed = Join-Path $Root 'skills'
  $args = @($syncJs, '--cache', $deskSkills, '--seed', $seed, '--overlay', $Overlay, '--preset', $preset)
  if ($skillDir) { $args += @('--share', $skillDir) }
  & $nodeExe @args | ForEach-Object { Write-Output $_ }
}

# DSH_HOME is the durable desk-home, already set above. Do not point it back
# at the install tree or an update that replaces that folder wipes chats.
# The mode follows the workspace, it is not a constant. workspace-write confines
# the shell with a WRITE_RESTRICTED token, and that token cannot reach a network
# path at all -- stat/list/read/write are all EPERM, measured with controls over
# raw UNC, a mapped letter, loopback and a remote share, and with extra SIDs in
# the restricting list. On Z: it therefore does not mean "confined", it means the
# employee gets no shell (the PowerShell-will-not-start bug). danger-full-access
# returns before confine() (dsh-pwsh-sandbox/lib/index.js:154,187), so the shell
# is an ordinary process and Z: is writable; the share is still bounded by SMB
# and NTFS ACLs per person, and the product tree by roster + integrity check.
# Company Full Access: client PC + personal chair write. Shared is read-only.
$isNetworkWork = $false
try {
  if ($Work -like '\\*') {
    $isNetworkWork = $true
  } else {
    $qualifier = Split-Path -Qualifier $Work
    $isNetworkWork = ([IO.DriveInfo]::new($qualifier + '\').DriveType -eq 'Network')
  }
} catch { $isNetworkWork = $true }
#
# Two knobs have to agree. In the composed tree, sandbox-policy.mode reads
# DSH_PERMISSION_MODE (the deployment default) while the permission plugin's
# defaultPreset is applied on session/created as a sandbox/mode event -- and a
# session override outranks the deployment default. So setting only the variable
# gets overwritten back to workspace-write on every new session. The variable is
# still needed: the same expression also selects the approval policy.
$preset = 'danger-full-access'
$env:DSH_PERMISSION_MODE = $preset
$utf8n = [Text.UTF8Encoding]::new($false)
$ovText = [IO.File]::ReadAllText($Overlay, $utf8n)
$ovNext = [regex]::Replace($ovText, '(?m)^(\s*defaultPreset:\s*)\S+(\s*#\s*@@DESK_DEFAULT_PRESET\s*)$', ('${1}' + $preset + '${2}'))
if ($ovNext -eq $ovText) {
  if ($ovText -notmatch ('(?m)^\s*defaultPreset:\s*' + [regex]::Escape($preset) + '\s*#\s*@@DESK_DEFAULT_PRESET\s*$')) {
    throw 'overlay-default-preset-anchor-missing'
  }
} else {
  [IO.File]::WriteAllText($Overlay, $ovNext, $utf8n)
}
if ($ovText -notmatch ('(?m)^\s*' + [regex]::Escape($preset) + ':\s*$')) {
  throw ('overlay-preset-row-missing-' + $preset)
}
$env:DEEPSEEK_BASE_URL = 'http://{{TDH_HOST}}:8450/v1'
if ($env:DEEPSEEK_BASE_URL -match '__SITE_') { throw 'unrendered-site-token' }
if (-not $env:DEEPSEEK_API_KEY -or $env:DEEPSEEK_API_KEY -eq 'company-gateway') {
  $tokFile = Join-Path $env:USERPROFILE '.dsh-company-rc8\gw.token'
  if (Test-Path -LiteralPath $tokFile) {
    $env:DEEPSEEK_API_KEY = ([IO.File]::ReadAllText($tokFile).Trim())
  }
}
if (-not $env:DEEPSEEK_API_KEY -or $env:DEEPSEEK_API_KEY -eq 'company-gateway') {
  throw 'gw-token-required'
}
$leaseJs = Join-Path $Root 'desk-lease.js'
$rc8 = Join-Path $env:USERPROFILE '.dsh-company-rc8'
$leasePersonal = $Work
$wp = Join-Path $rc8 'work.personal'
if (Test-Path -LiteralPath $wp) {
  $cand = [IO.File]::ReadAllText($wp).Trim()
  if ($cand -and (Test-Path -LiteralPath $cand)) { $leasePersonal = $cand }
}
$leaseOrg = ''
$wo = Join-Path $rc8 'work.org'
if (Test-Path -LiteralPath $wo) { $leaseOrg = [IO.File]::ReadAllText($wo).Trim() }
if (Test-Path -LiteralPath $leaseJs) {
  $leaseArgs = @(
    $leaseJs, 'acquire',
    '--personal', $leasePersonal,
    '--org', $leaseOrg,
    '--home', $env:DSH_HOME,
    '--site', 'https://{{TDH_HOST}}:8443'
  )
  $leaseOut = & $Node @leaseArgs 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) {
    $hint = $leaseOut.Replace("`r", ' ').Replace("`n", ' ').Trim()
    if ($hint.Length -gt 200) { $hint = $hint.Substring(0, 200) }
    throw ('desk-lease-acquire' + $(if ($hint) { ' ' + $hint } else { '' }))
  }
}
$env:NO_PROXY = 'localhost,127.0.0.1,{{TDH_HOST}}'
$env:NODE_USE_ENV_PROXY = '0'
Remove-Item Env:HTTP_PROXY, Env:HTTPS_PROXY, Env:ALL_PROXY, Env:http_proxy, Env:https_proxy, Env:all_proxy -ErrorAction SilentlyContinue

Write-Output 'tree-check skip-on-open'

$up = [bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if (-not $up) {
  $stdout = Join-Path $env:DSH_HOME 'web-runtime.out'
  $stderr = Join-Path $env:DSH_HOME 'web-runtime.err'
  $arg = @(
    $Bin, '--profile', 'web', '--patch', $Overlay,
    '--host', '127.0.0.1', '--port', [string]$Port, '--no-open',
    '--trusted-host', '127.0.0.1',
    '--trusted-host', 'localhost'
  )
  $shim = Join-Path $Root 'win-junction-shim.cjs'
  if (Test-Path -LiteralPath $shim) { $arg = @('--require', $shim) + $arg }
  Start-Process -FilePath $Node -ArgumentList $arg -WorkingDirectory $Work -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $up = $true; break }
  }
}
if (-not $up) { throw 'desk-not-up' }
if (Test-Path -LiteralPath $leaseJs) {
  $watchLog = Join-Path $env:DSH_HOME 'lease-watch.log'
  $watchArgs = @(
    $leaseJs, 'watch',
    '--personal', $leasePersonal,
    '--org', $leaseOrg,
    '--home', $env:DSH_HOME,
    '--site', 'https://{{TDH_HOST}}:8443'
  )
  Start-Process -FilePath $Node -ArgumentList $watchArgs -WindowStyle Hidden -RedirectStandardOutput $watchLog -RedirectStandardError $watchLog | Out-Null
}
if (-not $NoOpen) {
  Start-Process ('http://127.0.0.1:' + $Port)
}
