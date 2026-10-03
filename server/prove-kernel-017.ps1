$ErrorActionPreference = 'Stop'
$pkg = Get-ChildItem -Path 'C:\Users' -Filter 'package.json' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '\\TDH\\CompanyDesk\\prefix\\.*\\@deepseek-ai\\dsh\\package\.json$' } |
  Select-Object -First 1
if (-not $pkg) { throw 'planted-dsh-pkg-missing' }
$ver = (Get-Content -LiteralPath $pkg.FullName -Raw | ConvertFrom-Json).version
Write-Output ('PLANTED_DSH=' + $ver)
if ($ver -ne '0.1.7-rc.2') { throw 'not-017' }
$role = Get-ChildItem -Path 'C:\Users' -Filter 'login.role' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match ('\\.dsh-company-rc' + '8\\login\.role$') } |
  Select-Object -First 1
if ($role) { Write-Output ('LOGIN_ROLE=' + ([IO.File]::ReadAllText($role.FullName).Trim())) }
Write-Output 'PROVE_017_OK=1'
