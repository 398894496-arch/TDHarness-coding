# App shell: login form, then local desk, then Edge app window. No hanging TTY.
param()
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Log = Join-Path $Root 'app-start.log'
function Write-AppLog([string]$line) {
  try { Add-Content -LiteralPath $Log -Value ((Get-Date).ToString('o') + ' ' + $line) -Encoding UTF8 } catch { }
}
try {
  Add-Type -Name Native -Namespace Win32 -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@ -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 8; $i++) {
    $hwnd = [Win32.Native]::GetConsoleWindow()
    if ($hwnd -ne [IntPtr]::Zero) {
      [Win32.Native]::ShowWindow($hwnd, 0) | Out-Null
      break
    }
    Start-Sleep -Milliseconds 50
  }

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Write-AppLog 'ui-ready'

  $LoginUrl = 'https://{{TDH_HOST}}:8443/company/login'
  $Desk = 'http://127.0.0.1:17803'

  function Test-DeskUp {
    try {
      $c = New-Object System.Net.Sockets.TcpClient
      $iar = $c.BeginConnect('127.0.0.1', 17803, $null, $null)
      $ok = $iar.AsyncWaitHandle.WaitOne(400)
      $up = $ok -and $c.Connected
      $c.Close()
      return $up
    } catch { return $false }
  }

  function Invoke-AppLogin([string]$user, [string]$pass) {
    $body = '{"username":' + (ConvertTo-Json $user) + ',"password":' + (ConvertTo-Json $pass) + '}'
    try {
      $resp = Invoke-WebRequest -Uri $LoginUrl -Method POST -ContentType 'application/json; charset=utf-8' -Body $body -UseBasicParsing -TimeoutSec 12
      return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300 -and $resp.Content -match '"ok": true')
    } catch {
      Write-AppLog ('login-fail ' + $_.Exception.Message)
      return $false
    }
  }

  function Start-LocalDesk {
    $ps1 = Join-Path $Root 'start.ps1'
    if (-not (Test-Path -LiteralPath $ps1)) { throw 'start-ps1-missing' }
    if (Test-DeskUp) { return }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arg = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ps1 + '" -Hidden -NoOpen'
    Start-Process -FilePath $ps -ArgumentList $arg -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 45; $i++) {
      Start-Sleep -Seconds 1
      if (Test-DeskUp) { return }
    }
    throw 'desk-not-up'
  }

  function Open-AppWindow {
    $edge = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($edge) {
      Start-Process -FilePath $edge -ArgumentList @('--app=' + $Desk)
    } else {
      Start-Process $Desk
    }
  }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'TDHarness'
  $form.Width = 420
  $form.Height = 280
  $form.StartPosition = 'CenterScreen'
  $form.TopMost = $true
  $form.Font = New-Object System.Drawing.Font('Microsoft YaHei', 10)
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $title = New-Object System.Windows.Forms.Label
  $title.Text = '登录本机 Agent'
  $title.AutoSize = $true
  $title.Font = New-Object System.Drawing.Font('Microsoft YaHei', 14, [System.Drawing.FontStyle]::Bold)
  $title.Location = New-Object System.Drawing.Point(24, 18)
  $uLab = New-Object System.Windows.Forms.Label
  $uLab.Text = '账号'
  $uLab.AutoSize = $true
  $uLab.Location = New-Object System.Drawing.Point(24, 58)
  $user = New-Object System.Windows.Forms.TextBox
  $user.Width = 350
  $user.Location = New-Object System.Drawing.Point(24, 82)
  $pLab = New-Object System.Windows.Forms.Label
  $pLab.Text = '密码'
  $pLab.AutoSize = $true
  $pLab.Location = New-Object System.Drawing.Point(24, 114)
  $pass = New-Object System.Windows.Forms.TextBox
  $pass.Width = 350
  $pass.UseSystemPasswordChar = $true
  $pass.Location = New-Object System.Drawing.Point(24, 138)
  $go = New-Object System.Windows.Forms.Button
  $go.Text = '登录'
  $go.Width = 350
  $go.Height = 36
  $go.Location = New-Object System.Drawing.Point(24, 178)
  $err = New-Object System.Windows.Forms.Label
  $err.AutoSize = $true
  $err.ForeColor = [System.Drawing.Color]::FromArgb(217, 45, 32)
  $err.Location = New-Object System.Drawing.Point(24, 220)
  $form.Controls.AddRange(@($title, $uLab, $user, $pLab, $pass, $go, $err))
  $form.AcceptButton = $go
  $form.Add_Shown({ $form.TopMost = $false; $form.Activate() })

  $go.Add_Click({
    $err.Text = ''
    $u = $user.Text.Trim()
    $p = $pass.Text
    if ($u.Length -lt 2 -or $p.Length -lt 4) { $err.Text = '账号或密码不对'; return }
    $go.Enabled = $false
    try {
      if (-not (Invoke-AppLogin $u $p)) { $err.Text = '账号或密码不对'; return }
      Start-LocalDesk
      Open-AppWindow
      $form.Close()
    } catch {
      Write-AppLog ('desk-fail ' + $_.Exception.Message)
      $err.Text = '打不开本机 Agent'
    } finally {
      $go.Enabled = $true
    }
  })

  Write-AppLog 'form-run'
  [System.Windows.Forms.Application]::Run($form)
  Write-AppLog 'form-exit'
} catch {
  Write-AppLog ('crash ' + $_.Exception.ToString())
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'TDHarness') | Out-Null
  } catch {
    (New-Object -ComObject WScript.Shell).Popup($_.Exception.Message, 8, 'TDHarness', 16) | Out-Null
  }
  exit 1
}
