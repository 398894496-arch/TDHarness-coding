# Linux CIFS workspace refusal (C2b)

Linux does not call the Windows `materializeAclGrant` method. The independent
`company-sandbox-linux-cifs-v1` patch inserts a precheck at `confine(argv, policy)`
before configured-runner and normal runner selection. It applies only to Linux
workspace-write policies; read-only and other operating systems bypass it.

The check uses Node's `statfsSync(root, { bigint: true })`. Linux reports the
resolved filesystem through this syscall, including a symlink's target. The
SMB, CIFS and SMB2 constants come from
[Linux UAPI magic.h](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h).
Both coding setup scripts include the mark. Windows drive probing and its cache
remain separate. No PowerShell, mount command or shell process is launched.

Missing paths, access failures and malformed results fail with
`COMPANY_WORKSPACE_PROBE_FAILED`. Known SMB/CIFS types fail with
`COMPANY_WORKSPACE_NOT_LOCAL` before runner selection/profile creation.

This is specifically a CIFS-family root check, not a declaration that all other
filesystems are local. It does not inspect descendant submounts, NFS/FUSE remote
storage or overlay backing stores. It does not close races after the check.
The native synchronous call has no userspace timeout and may block on an
unhealthy mount. Results are not cached, so each confinement checks again.

## Verification

`node scripts/prove-linux-cifs.js` applies the actual patcher to a fixture and
checks SMB/CIFS/SMB2 plus signed type representation, refusal before both runner
paths, local types, malformed/failed probes, read-only bypass, other-platform
bypass, idempotence and a disconnected-precheck negative control.

`scripts/prove-patches.js` also extracts and exercises the actual patched pinned
kernel's confine method. Native runner creation and native CIFS mounting are not
performed by those substituted-type tests.

On Linux the proof queries the real local test directory, a symlink and a missing
path. Set `TDH_TEST_CIFS_ROOT` to an existing CIFS directory to require real mount
refusal (`LINUX_CIFS_MOUNT_PROVE_OK=1`). The proof neither mounts nor unmounts a
share. Without that variable it explicitly reports real-share coverage skipped.
