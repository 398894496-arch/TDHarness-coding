'use strict';

const { spawnSync } = require('node:child_process');

// Functions are embedded into dsh-sandbox-local (which imports spawnSync).
// The installed kernel does not require this checkout. Lexical UNC detection
// is separate from Windows drive probing.
function companyWorkspaceIsNetworkPath(p) {
  if (typeof p !== 'string') return false;
  const normalized = p.replace(/\//g, '\\');
  if (/^\\\\\?\\[A-Za-z]:\\/.test(normalized)) return false;
  return normalized.startsWith('\\\\');
}

function companyWindowsDriveRoot(p) {
  if (typeof p !== 'string') return '';
  const normalized = p.replace(/\//g, '\\');
  const match = normalized.match(/^(?:\\\\\?\\)?([A-Za-z]:)\\/);
  return match ? match[1].toUpperCase() : '';
}

function companyProbeWindowsDrive(drive, run = spawnSync) {
  if (!/^[A-Z]:$/.test(drive)) throw new Error('Invalid drive name');
  // Query DOS device mapping and drive type, not localized command output.
  // Only the validated drive name is interpolated. These calls do not read
  // workspace contents or grant ACLs.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class TdhDriveProbe {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern uint QueryDosDeviceW(string name, StringBuilder target, int size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern uint GetDriveTypeW(string root);
}
'@
$drive = '${drive}'
$target = New-Object System.Text.StringBuilder 32768
$count = [TdhDriveProbe]::QueryDosDeviceW($drive, $target, $target.Capacity)
$queryError = if ($count -eq 0) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { 0 }
$driveType = [TdhDriveProbe]::GetDriveTypeW($drive + '\')
@{driveType = [int]$driveType; target = $target.ToString(); queryError = $queryError} | ConvertTo-Json -Compress
`;
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const result = run(systemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536, cwd: systemRoot,
    });
  if (!result || result.error || result.status !== 0) {
    throw new Error('Windows drive probe failed or timed out', { cause: result && result.error });
  }
  return JSON.parse(result.stdout.trim());
}

function companyWindowsWorkspaceKind(p, probe = companyProbeWindowsDrive) {
  const drive = companyWindowsDriveRoot(p);
  if (!drive) throw new Error('Expected an absolute Windows drive path');
  const info = probe(drive);
  if (!info || !Number.isInteger(info.driveType) || typeof info.target !== 'string'
      || !Number.isInteger(info.queryError) || info.queryError < 0) {
    throw new Error('Invalid Windows drive probe response');
  }
  if (info.driveType === 4) return 'mapped'; // DRIVE_REMOTE, including SMB/WebDAV.
  if (info.queryError !== 0 || !info.target) throw new Error('Cannot resolve DOS device');
  if (info.target.startsWith('\\??\\')) return 'subst'; // DOS alias, even onto a local disk.
  if (/^\\Device\\(?:Mup|LanmanRedirector|WebDavRedirector)(?:\\|$)/i.test(info.target)) return 'mapped';
  if (![2, 3, 5, 6].includes(info.driveType)) throw new Error('Drive type is unknown or root is missing');
  if (!/^\\Device\\/i.test(info.target)) throw new Error('Unrecognized DOS device target');
  return 'local';
}

function companyCachedWindowsWorkspaceKind(p, options = {}) {
  const drive = companyWindowsDriveRoot(p);
  if (!drive) throw new Error('Expected an absolute Windows drive path');
  const cache = options.cache || (options.probe ? new Map()
    : (companyCachedWindowsWorkspaceKind.cache ||= new Map()));
  const now = options.now === undefined ? Date.now() : options.now;
  const cached = cache.get(drive);
  if (cached && cached.expiresAt > now) return cached.kind;
  if (cached) cache.delete(drive);
  const kind = companyWindowsWorkspaceKind(p, options.probe);
  // Cache only a successful local classification. Refused aliases and probe
  // failures are retried immediately after the operator fixes the drive.
  const cacheMs = options.cacheMs === undefined ? 30000 : options.cacheMs;
  if (kind === 'local' && Number.isFinite(cacheMs) && cacheMs > 0) {
    cache.set(drive, { kind, expiresAt: now + cacheMs });
  }
  return kind;
}

function companyWorkspaceHint(workspaceRoot) {
  return 'workspace-write requires a directly addressed local workspace. '
    + '"' + workspaceRoot + '" is a network path or a mapped/SUBST alias; '
    + 'this sandbox does not grant workspace ACLs through it. Use the original local directory. '
    + 'Network shares must be access-controlled by the server.';
}

function companyAssertLocalWorkspace(workspaceRoot, options = {}) {
  let kind = companyWorkspaceIsNetworkPath(workspaceRoot) ? 'network' : 'local';
  if (kind === 'local' && (options.platform || process.platform) === 'win32') {
    try {
      kind = companyCachedWindowsWorkspaceKind(workspaceRoot, options);
    } catch (cause) {
      const err = new Error('sandbox-local: cannot verify workspace drive for "' + workspaceRoot
        + '"; no workspace ACL grant was attempted. Windows PowerShell drive probing must be available.', { cause });
      err.code = 'COMPANY_WORKSPACE_PROBE_FAILED';
      throw err;
    }
  }
  if (kind === 'local') return;
  const err = new Error('sandbox-local: refusing workspace-write (' + kind + '). ' + companyWorkspaceHint(workspaceRoot));
  err.code = 'COMPANY_WORKSPACE_NOT_LOCAL';
  throw err;
}

function companyGrantError(workspaceRoot, cause) {
  const err = new Error('sandbox-local: windows-acl workspace grant failed for "' + workspaceRoot
    + '" after the path check. Check the volume permissions and original error.', { cause });
  err.code = 'COMPANY_WORKSPACE_GRANT_FAILED';
  return err;
}

function sandboxPathHelperSource() {
  return [companyWorkspaceIsNetworkPath, companyWindowsDriveRoot, companyProbeWindowsDrive,
    companyWindowsWorkspaceKind, companyCachedWindowsWorkspaceKind,
    companyWorkspaceHint, companyAssertLocalWorkspace,
    companyGrantError].map((fn) => fn.toString()).join('\n');
}

module.exports = {
  companyWorkspaceIsNetworkPath, companyWindowsDriveRoot, companyProbeWindowsDrive,
  companyWindowsWorkspaceKind, companyCachedWindowsWorkspaceKind,
  companyAssertLocalWorkspace, companyGrantError, sandboxPathHelperSource,
};
