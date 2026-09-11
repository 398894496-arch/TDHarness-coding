# Install pinned dsh into %USERPROFILE%\.tdh-coding-prefix and apply patches.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path }
$Pin = (Select-String -Path (Join-Path $Root "kernel.yml") -Pattern '^id:\s+(\S+)').Matches[0].Groups[1].Value
$Prefix = $env:TDH_PREFIX
if (-not $Prefix) { $Prefix = Join-Path $env:USERPROFILE ".tdh-coding-prefix" }
$n = $Prefix.Replace("\", "/")
$home = $env:USERPROFILE.Replace("\", "/")
if ($n -eq "$home/.local" -or $n.StartsWith("$home/.local/") -or $n -match "dsh-node-rc8") {
  Write-Error "BLOCKED=refuses-known-live-tree:$Prefix"
}
New-Item -ItemType Directory -Force -Path $Prefix | Out-Null
Write-Output "PIN=$Pin"
Write-Output "PREFIX=$Prefix"
npm install -g "@deepseek-ai/dsh@$Pin" --prefix $Prefix
# Coding setup applies only the local-workspace subset; the company pins
# (__DESK_SKILLS__ skill roots, web_fetch, .company-root) stay off the
# official presets unless TDH_FULL_PATCHES=1 (see C4 in BUGS.md).
$CodingMarks = "company-sandbox-local-drive-v2,company-win-junction-mklink-v3,company-win-junction-mklink-v4,company-glob-missing-root-v2,company-session-smbfs-rename-v1,company-goal-resume-armed-v1,company-session-events-alias-v1"
if ($env:TDH_FULL_PATCHES -eq "1") {
  node (Join-Path $Root "patches\apply-kernel-patches.js") $Prefix
} else {
  node (Join-Path $Root "patches\apply-kernel-patches.js") $Prefix --only $CodingMarks
}
Write-Output "SETUP_OK=1"
Write-Output "PATH_HINT=$Prefix\bin"
Write-Output "NEXT=set DEEPSEEK_API_KEY=... then dsh --patch overlays\solo.yml"
