'use strict';

// Keep these functions self-contained: the patcher embeds their source into
// the installed ESM kernel, which must not depend on this checkout at runtime.
function companyWorkspaceIsNetworkPath(p) {
  return typeof p === 'string' && (p.startsWith('\\\\') || p.startsWith('//'));
}

function companyWorkspaceHint(workspaceRoot) {
  return 'workspace-write confinement is granted by an NTFS ACL on the volume that holds the workspace. '
    + '"' + workspaceRoot + '" is not on a local volume, so there is no volume here to grant on and this '
    + 'sandbox cannot confine anything on it. Put the agent workspace on a local disk and mount the company '
    + 'share separately: the share is access-controlled on the server (per-person SMB account plus per-dept '
    + 'NTFS ACL), not by this sandbox.';
}

function companyAssertLocalWorkspace(workspaceRoot) {
  if (!companyWorkspaceIsNetworkPath(workspaceRoot)) return;
  const err = new Error('sandbox-local: refusing workspace-write on a network workspace. ' + companyWorkspaceHint(workspaceRoot));
  err.code = 'COMPANY_WORKSPACE_NOT_LOCAL';
  throw err;
}

function companyGrantError(workspaceRoot, cause) {
  // Mapped drives remain outside this lexical check; see C2 in BUGS.md.
  const err = new Error(
    'sandbox-local: windows-acl workspace grant failed for "' + workspaceRoot + '". '
      + 'If this workspace is on a mapped network drive or a UNC path, that is the likely cause: '
      + companyWorkspaceHint(workspaceRoot),
    { cause }
  );
  err.code = 'COMPANY_WORKSPACE_GRANT_FAILED';
  return err;
}

function sandboxPathHelperSource() {
  return [companyWorkspaceIsNetworkPath, companyWorkspaceHint,
    companyAssertLocalWorkspace, companyGrantError].map((fn) => fn.toString()).join('\n');
}

module.exports = {
  companyWorkspaceIsNetworkPath,
  companyAssertLocalWorkspace,
  companyGrantError,
  sandboxPathHelperSource,
};
