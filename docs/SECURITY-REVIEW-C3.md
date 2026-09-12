# C3 privilege-patch review

## Verdict: retain the coding/share split; narrow the DACL exception

The default coding mark lists in both setup scripts exclude custom trusted-host
skills and UNC DACL patches. Preserve that C4 boundary. Direct full-patcher use
and `TDH_FULL_PATCHES=1` remain an explicit company/share deployment choice.

## Custom skill roots: keep only as deployment-trusted configuration

`company-skill-custom-trusted-v1` marks every configured custom root trusted.
`company-skill-get-custom-trusted-v1` passes trusted-host mode to `parseSkillFile`
for custom candidates. In the inspected kernel implementation, `readSkillText`
then uses Node `readFile` rather than `ctx.fs`; root listing similarly selects
the host filesystem. The OS account's read permissions still apply.

Consequently, a configurable custom root CAN point outside the intended workspace.
These patches do not impose a workspace allowlist or ask for path approval.
Anyone able to influence the effective configuration can influence the trusted
roots; a writable skill directory or its links also remains a trust concern.
Do not interpret successful skill loading as proof of sandbox confinement.

Keep these marks out of the coding subset. Full/share deployments must provision
the configuration and skill directories as operator-controlled inputs, and must
not treat employee- or model-controlled configuration as trusted. This review
does not establish who can edit a private desk deployment's configuration.
No new claim of application-enforced root authorization is made here.

## DACL copying: narrow

The v1 patch returned on local Win32 access-denied and EACCES failures, including
errors reading the source descriptor. It also treated extended local paths as
UNC and skipped copying whenever either endpoint was UNC. These could suppress
the permission-preservation failure of a local or mixed-path operation.

The v2 patch skips only when BOTH endpoints are syntactic UNC shares. Ordinary
local, extended-local and device paths retain the original read/set operations
and errors. Read exceptions retain their identity; failed native writes retain
the original Win32 error. The shared UNC predicate also stops the existing
ReplaceFileW patch from classifying extended-local paths as network shares.

The retained UNC exception still does not preserve the source DACL; server-side
policy/inheritance must be acceptable, including if the two endpoints are on
different shares. Mapping, junction resolution, concurrent remapping, native ACL
confinement, and the separate ReplaceFileW access-denied fallback are not proven
or repaired by this scoped change. Install a fresh pinned prefix after v1.

## Evidence

`node scripts/prove-privilege-patches.js` applies the real patcher to fixtures,
verifies local and mixed-path failures, extended paths, UNC-only skipping,
trusted custom versus untrusted workspace skill flags, coding-list exclusion,
idempotence and explicit refusal of a legacy ACL prefix. It prints
`PRIVILEGE_PATCHES_PROVE_OK=1` on Linux and Windows CI.

The proof uses controlled native API substitutes and a skill parser observer.
It verifies patch behavior and the trust flag, not native NTFS enforcement,
real SMB policies or a complete live skill-loading flow. The standard patch
proof separately verifies the anchors on the pinned kernel.
