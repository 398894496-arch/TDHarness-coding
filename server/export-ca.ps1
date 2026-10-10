# Export this server's Caddy root (made by `tls internal`) to D:\dsh\runtime\company-ca.crt.
# Clients carry it in their signed pack and trust it for the gateway over 8443/gw. The file's
# presence is also the switch: site-cs.py builds TDHarness.exe with the https gateway, the
# site patches move the desks to /gw, and the gateway refuses plaintext from the LAN
# (unless gateway.env has GW_PLAIN_LAN=1). Prints CA_EXPORTED=changed|same or CA_MISSING=1.
# Keep this file ASCII: Windows PowerShell 5.1 reads BOM-less UTF-8 as the ANSI code page.
param([string]$Out = 'D:\dsh\runtime\company-ca.crt')
$ErrorActionPreference = 'Stop'

# Caddy runs as SYSTEM (task Autostart-Caddy-8443), so its data lives in SYSTEM's profile.
$cands = @(
  'C:\Windows\System32\config\systemprofile\AppData\Roaming\Caddy\pki\authorities\local\root.crt',
  (Join-Path $env:APPDATA 'Caddy\pki\authorities\local\root.crt')
)
$src = $cands | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $src) { Write-Output 'CA_MISSING=1'; exit 0 }
$new = [IO.File]::ReadAllBytes($src)
if (-not ([Text.Encoding]::ASCII.GetString($new) -match 'BEGIN CERTIFICATE')) { throw ('ca-not-pem ' + $src) }
if (Test-Path -LiteralPath $Out) {
  $old = [IO.File]::ReadAllBytes($Out)
  if ([Convert]::ToBase64String($old) -eq [Convert]::ToBase64String($new)) { Write-Output 'CA_EXPORTED=same'; exit 0 }
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Out) | Out-Null
[IO.File]::WriteAllBytes($Out, $new)
Write-Output ('CA_SOURCE=' + $src)
Write-Output 'CA_EXPORTED=changed'
