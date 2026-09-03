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
node (Join-Path $Root "patches\apply-kernel-patches.js") $Prefix
Write-Output "SETUP_OK=1"
Write-Output "PATH_HINT=$Prefix\bin"
Write-Output "NEXT=set DEEPSEEK_API_KEY=... then dsh --patch overlays\solo.yml"
