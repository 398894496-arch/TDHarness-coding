'use strict';

const SKEW_MS = 120_000;

function parsePastedOAuth(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { code: '', state: '' };
  try {
    const u = new URL(s);
    const fromQuery = u.searchParams.get('code');
    if (fromQuery) return { code: fromQuery.split('#')[0], state: u.searchParams.get('state') || '' };
    if (u.hash) {
      const h = new URLSearchParams(u.hash.replace(/^#/, ''));
      if (h.get('code')) return { code: h.get('code'), state: h.get('state') || '' };
    }
  } catch {
    /* not a URL */
  }
  const hash = s.indexOf('#');
  if (hash >= 0) {
    return {
      code: s.slice(0, hash).replace(/^code=/i, '').trim(),
      state: s.slice(hash + 1).trim(),
    };
  }
  return { code: s.replace(/^code=/i, '').trim(), state: '' };
}

function parsePastedOAuthCode(raw) {
  return parsePastedOAuth(raw).code;
}

function decodeJwtPayload(token) {
  const raw = String(token ?? '');
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (parts[1].length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function accountIdFromToken(token) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload !== 'object') return undefined;
  const namespaced = payload['https://api.openai.com/auth'];
  const id = namespaced?.chatgpt_account_id || payload.chatgpt_account_id;
  return id ? String(id) : undefined;
}

function tokenExpiresAtMs(item) {
  if (item?.tokenExpiresAt) {
    const t = Date.parse(item.tokenExpiresAt);
    if (Number.isFinite(t)) return t;
  }
  if (typeof item?.expires === 'number' && Number.isFinite(item.expires)) return item.expires;
  const payload = decodeJwtPayload(item?.access || item?.credential);
  const exp = Number(payload?.exp);
  if (Number.isFinite(exp) && exp > 0) return exp * 1000;
  return undefined;
}

function needsRefresh(item, now = Date.now(), skewMs = SKEW_MS) {
  if (!item?.refresh && !item?.refreshToken) return false;
  const exp = tokenExpiresAtMs(item);
  if (exp == null) return false;
  return exp - now <= skewMs;
}

function pkce() {
  const crypto = require('node:crypto');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function randomState() {
  return require('node:crypto').randomBytes(24).toString('base64url');
}

module.exports = {
  SKEW_MS,
  parsePastedOAuth,
  parsePastedOAuthCode,
  decodeJwtPayload,
  accountIdFromToken,
  tokenExpiresAtMs,
  needsRefresh,
  pkce,
  randomState,
};
