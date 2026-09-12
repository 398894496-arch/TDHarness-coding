'use strict';
const { statfsSync: companyStatfsSync } = require('node:fs');

function companyAssertLinuxWorkspace(policy, platform = process.platform, statfs = companyStatfsSync) {
  if (platform !== 'linux' || policy.mode !== 'workspace-write') return;
  let type;
  try {
    if (typeof policy.workspaceRoot !== 'string' || !policy.workspaceRoot.startsWith('/')) {
      throw new Error('Expected an absolute Linux workspace path');
    }
    const info = statfs(policy.workspaceRoot, { bigint: true });
    if (!info || typeof info.type !== 'bigint') throw new Error('Invalid statfs response');
    type = BigInt.asUintN(32, info.type);
  } catch (cause) {
    const err = new Error('sandbox-local: cannot determine Linux workspace filesystem; command confinement was not attempted.', { cause });
    err.code = 'COMPANY_WORKSPACE_PROBE_FAILED';
    throw err;
  }
  // Linux UAPI include/uapi/linux/magic.h: SMB, CIFS and SMB2 superblock types.
  if ([0x517bn, 0xff534d42n, 0xfe534d42n].includes(type)) {
    const err = new Error('sandbox-local: refusing workspace-write on a Linux CIFS/SMB filesystem. Use a local workspace directory.');
    err.code = 'COMPANY_WORKSPACE_NOT_LOCAL';
    throw err;
  }
}

module.exports = { companyAssertLinuxWorkspace };
