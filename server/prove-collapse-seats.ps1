$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$py = $null
foreach ($n in @('python', 'python3')) {
  $c = Get-Command $n -ErrorAction SilentlyContinue
  if ($c -and $c.Source -and ($c.Source -notmatch 'WindowsApps')) { $py = $c.Source; break }
}
if (-not $py) { throw 'python-missing' }
$lease = Get-ChildItem -Path 'C:\Users' -Filter 'desk-lease.js' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\desk-lease\.js$' } |
  Select-Object -First 1
if (-not $lease) { throw 'planted-lease-missing' }
$leaseTxt = [IO.File]::ReadAllText($lease.FullName)
if ($leaseTxt -notmatch 'function collapseSeatWorkspaces') { throw 'planted-lease-missing-collapse' }
$exe = Join-Path $lease.Directory.FullName 'TDHarness.exe'
$hay = [Text.Encoding]::Unicode.GetString([IO.File]::ReadAllBytes($exe))
if ($hay.IndexOf('pin-collapse-seats') -lt 0) { throw 'planted-exe-missing-collapse' }
Write-Output ('PLANTED_LEASE=' + $lease.FullName)
Write-Output 'PLANTED_COLLAPSE=1'
& $py -c @"
import json
from pathlib import Path
p = Path(r'D:\dsh\company\_office\.dsh-desk\storages\workspace.json')
ws = json.loads(p.read_text(encoding='utf-8'))
tables = ((ws.get('tables') or {}).get('workspaces')) or {}
titles = sorted(str(r.get('title') or '') for r in tables.values() if isinstance(r, dict))
ids = list((ws.get('global') or {}).get('workspaceIds') or [])
print('WS_COUNT=' + str(len(tables)))
print('WS_IDS=' + str(len(ids)))
print('WS_TITLE_ESC=' + ','.join(t.encode('unicode_escape').decode('ascii') for t in titles))
want = ['\u4e2a\u4eba', '\u56e2\u961f']
if titles != want:
    raise SystemExit('workspace-titles-wrong')
if len(tables) != 2 or len(ids) != 2:
    raise SystemExit('workspace-count-wrong')
print('WS_TITLES_OK=1')
print('WS_COLLAPSE_PROVE=1')
"@
if ($LASTEXITCODE -ne 0) { throw 'workspace-prove-failed' }
Write-Output 'COLLAPSE_SEATS_OK=1'
