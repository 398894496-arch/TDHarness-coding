#!/usr/bin/env bash
# Mount the Win company SMB share on an employee Mac. Files stay on Win.
# Agent stays local. No sudo. Mount point is $HOME/company (ASCII).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE="$HERE/node/bin/node"
SMB_JS="$HERE/mac-smb-mount.js"
[[ -x "$NODE" && -f "$SMB_JS" ]] || { echo "bundled-node-or-smb-js-missing" >&2; exit 2; }

LAN="${COMPANY_SMB_LAN:-{{TDH_HOST}}}"
TS="${COMPANY_SMB_TS:-{{TDH_HOST}}}"
SHARE="${COMPANY_SMB_SHARE:-dsh-company}"
MNT="${COMPANY_SMB_MNT:-$HOME/company}"
SMB_USER="${COMPANY_SMB_USER:-dshshare}"
PASSFILE="${COMPANY_SMB_PASS:-$HOME/.dsh-company-rc8/.smb-dshshare}"
RC8="${HOME}/.dsh-company-rc8"
if [ -f "$RC8/smb.user" ]; then SMB_USER="$(tr -d '\r\n' < "$RC8/smb.user")"; fi
if [ -f "$RC8/smb.pass" ]; then PASSFILE="$RC8/smb.pass"; fi

is_smb() {
  mount | grep -F " on $MNT " | grep -q smbfs
}

# Darwin: //smb-user@LAN/SHARE on $HOME/company (smbfs, ...)
mounted_smb_user() {
  "$NODE" "$SMB_JS" who "$MNT"
}

pick_host() {
  host_up() {
    local h="$1"
    [[ -n "$h" && "$h" != __* ]] || return 1
    # Darwin -t is seconds. -W is milliseconds; -W 2 was a 2ms timeout and always failed.
    ping -c 1 -t 2 "$h" >/dev/null 2>&1 && return 0
    nc -z -G 3 "$h" 445 >/dev/null 2>&1 && return 0
    nc -z -G 3 "$h" 8443 >/dev/null 2>&1 && return 0
    return 1
  }
  on_company_ts() {
    local bin=""
    if [[ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]]; then
      bin=/Applications/Tailscale.app/Contents/MacOS/Tailscale
    elif command -v tailscale >/dev/null 2>&1; then
      bin="$(command -v tailscale)"
    fi
    [[ -n "$bin" ]] || return 1
    local text
    text="$("$bin" status --json 2>/dev/null || true)"
    [[ "$text" == *'{{TDH_HOST}}'* ]]
  }
  # Off-LAN: {{TDH_HOST}} may ping via subnet routes (or a home LAN with the
  # same prefix) while SMB 445 is LocalSubnet-only. Prefer the tailnet IP.
  if on_company_ts && host_up "$TS"; then echo "$TS"; return 0; fi
  if host_up "$LAN"; then echo "$LAN"; return 0; fi
  if host_up "$TS"; then echo "$TS"; return 0; fi
  return 1
}

mkdir -p "$MNT"
if is_smb; then
  have="$(mounted_smb_user || true)"
  if [ -n "${SMB_USER:-}" ] && [ -n "$have" ] && [ "$have" != "$SMB_USER" ]; then
    # Login wrote a different SMB account. Keeping the old mount makes
    # _office visible but not writable (ABE). Boss then dies at desk-lease.
    echo "MOUNT_REAUTH=$have->$SMB_USER"
    /sbin/umount "$MNT" 2>/dev/null || diskutil unmount "$MNT" >/dev/null || {
      echo "BLOCKED=mount-reauth-busy|$have" >&2
      exit 2
    }
  else
    echo "MOUNT_ALREADY=1"
    echo "MNT=$MNT"
    echo "MAC_MOUNT_OK=1"
    exit 0
  fi
fi

if mount | grep -F " on $MNT " >/dev/null; then
  echo "BLOCKED=mnt-busy-not-smb|$MNT" >&2
  exit 2
fi

HOST="$(pick_host)" || {
  echo "BLOCKED=server-unreachable" >&2
  exit 2
}
echo "SMB_HOST=$HOST"

if [ ! -f "$PASSFILE" ]; then
  echo "BLOCKED=passfile-missing" >&2
  exit 2
fi
chmod 600 "$PASSFILE" 2>/dev/null || true

try_mount() {
  "$NODE" "$SMB_JS" mount "$1" "$SHARE" "$MNT" "$SMB_USER" "$PASSFILE"
}

# Password stays in the 600 file. Do not print it. Strip it from mount stderr.
if ! try_mount "$HOST"; then
  OTHER=""
  if [ "$HOST" = "$LAN" ] && [ -n "$TS" ] && [[ "$TS" != __* ]]; then OTHER="$TS"; fi
  if [ "$HOST" = "$TS" ] && [ -n "$LAN" ] && [[ "$LAN" != __* ]]; then OTHER="$LAN"; fi
  if [ -n "$OTHER" ] && [ "$OTHER" != "$HOST" ]; then
    echo "SMB_HOST_RETRY=$OTHER"
    if try_mount "$OTHER"; then
      HOST="$OTHER"
    else
      echo "BLOCKED=mount-failed|$HOST|$SHARE" >&2
      exit 2
    fi
  else
    echo "BLOCKED=mount-failed|$HOST|$SHARE" >&2
    exit 2
  fi
fi

if ! is_smb; then
  echo "BLOCKED=not-smb-after-mount" >&2
  exit 2
fi

echo "MNT=$MNT"
echo "MAC_MOUNT_OK=1"
