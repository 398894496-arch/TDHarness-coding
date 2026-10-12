' Open the WinForms host. No PowerShell.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe = here & "\TDHarness.exe"
If Not fso.FileExists(exe) Then
  sh.Popup "missing TDHarness.exe", 8, "TDHarness", 16
  WScript.Quit 2
End If
sh.Run """" & exe & """", 1, False
