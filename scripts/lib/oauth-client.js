'use strict';

const { providerSpec } = require('./oauth-providers');
const { parsePastedOAuth, parsePastedOAuthCode, accountIdFromToken, pkce, randomState } = require('./oauth-tokens');
const { fallbackModelsFor, mergeDiscoveredModels, normalizeModels, discoverUpstreamModels } = require('./model-meta');
const { setGrant } = require('./credentials-store');

class OAuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const SESSION_TTL_MS = 10 * 60 * 1000;
const USER_AGENT = 'tdh-coding';

function tokenRequest(provider, payload) {
  const headers = { accept: 'application/json', 'user-agent': USER_AGENT };
  let bodyPayload = { ...payload };
  if (provider.clientSecret) {
    if (provider.clientSecretInBody) bodyPayload = { ...bodyPayload, client_secret: provider.clientSecret };
    else headers.authorization = `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}`;
  }
  if (provider.tokenBody === 'json') {
    headers['content-type'] = 'application/json';
    return { headers, body: JSON.stringify(bodyPayload) };
  }
  headers['content-type'] = 'application/x-www-form-urlencoded';
  return { headers, body: new URLSearchParams(bodyPayload) };
}

class LocalOAuth {
  constructor({ fetchImpl, now } = {}) {
    this.fetchImpl = fetchImpl ?? fetch;
    this.now = now ?? (() => Date.now());
    this.sessions = new Map();
  }

  gc() {
    const t = this.now();
    for (const [state, s] of this.sessions) {
      if (t - s.createdAt > SESSION_TTL_MS) this.sessions.delete(state);
    }
  }

  provider(id) {
    const p = providerSpec(id);
    if (!p) throw new OAuthError('oauth_unsupported', `unknown provider ${id}`);
    return p;
  }

  newSession(providerId, extra = {}) {
    this.gc();
    const state = randomState();
    const session = {
      state,
      providerId,
      status: 'pending',
      createdAt: this.now(),
      ...extra,
    };
    this.sessions.set(state, session);
    return session;
  }

  start(providerId, input = {}) {
    const provider = this.provider(providerId);
    if (provider.flow === 'device_code') return this.startDevice(provider, input);
    return this.startAuthorize(provider, input);
  }

  startAuthorize(provider, input) {
    const { verifier, challenge } = pkce();
    const redirectUri = provider.redirectUri;
    const session = this.newSession(provider.id, {
      flow: provider.flow,
      verifier,
      redirectUri,
      models: input.models,
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
      reasoningEfforts: input.reasoningEfforts,
    });
    const url = new URL(provider.authorizeUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', provider.scope);
    url.searchParams.set('state', session.state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    for (const [key, value] of Object.entries(provider.authorizeParams ?? {})) url.searchParams.set(key, value);
    return {
      flow: session.flow,
      authorizeUrl: url.toString(),
      state: session.state,
      callbackUrl: redirectUri,
      pasteHint: provider.pasteHint || null,
    };
  }

  async startDevice(provider, input) {
    if ((provider.deviceStyle || 'codex') === 'rfc8628') return this.startDeviceRfc(provider, input);
    let res;
    try {
      res = await this.fetchImpl(provider.deviceUserCodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ client_id: provider.clientId }),
      });
    } catch (err) {
      throw new OAuthError('oauth_device_unreachable', `device endpoint unreachable: ${err.message}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data.user_code || data.usercode) || !data.device_auth_id) {
      throw new OAuthError('oauth_device_failed', 'device code request failed');
    }
    const userCode = data.user_code || data.usercode;
    const verificationUri = provider.verificationUri || data.verification_uri || data.verification_url;
    const session = this.newSession(provider.id, {
      flow: 'device_code',
      deviceStyle: 'codex',
      userCode,
      deviceAuthId: data.device_auth_id,
      verificationUri,
      models: input.models,
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
      reasoningEfforts: input.reasoningEfforts,
    });
    return {
      flow: 'device_code',
      state: session.state,
      userCode,
      verificationUri,
      verificationUriComplete: data.verification_uri_complete || verificationUri,
    };
  }

  async startDeviceRfc(provider, input) {
    let res;
    try {
      res = await this.fetchImpl(provider.deviceUserCodeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ client_id: provider.clientId, scope: provider.scope || '' }),
      });
    } catch (err) {
      throw new OAuthError('oauth_device_unreachable', `device endpoint unreachable: ${err.message}`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !(data.user_code || data.usercode) || !data.device_code) {
      throw new OAuthError('oauth_device_failed', 'device code request failed');
    }
    const userCode = data.user_code || data.usercode;
    const verificationUri = data.verification_uri || data.verification_url || provider.verificationUri;
    const session = this.newSession(provider.id, {
      flow: 'device_code',
      deviceStyle: 'rfc8628',
      userCode,
      deviceCode: data.device_code,
      verificationUri,
      models: input.models,
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
      reasoningEfforts: input.reasoningEfforts,
    });
    return {
      flow: 'device_code',
      state: session.state,
      userCode,
      verificationUri,
      verificationUriComplete: data.verification_uri_complete || verificationUri,
    };
  }

  publicStatus(session) {
    return {
      status: session.status,
      error: session.error ?? null,
      provider: session.providerId,
      flow: session.flow ?? null,
      userCode: session.userCode ?? null,
      verificationUri: session.verificationUri ?? null,
      models: session.status === 'authorized'
        ? (session.discoveredModels ?? []).map((m) => ({ id: m.id, ...(m.name ? { name: m.name } : {}) }))
        : undefined,
    };
  }

  async status(state) {
    const s = this.sessions.get(state);
    if (!s) throw new OAuthError('oauth_state_unknown', 'login session missing or expired');
    if (s.flow === 'device_code' && s.status === 'pending') {
      try {
        await this.pollDeviceOnce(s);
      } catch (err) {
        if (err instanceof OAuthError && err.code === 'oauth_device_pending') {
          /* still waiting */
        } else {
          s.status = 'error';
          s.error = err.message;
        }
      }
    }
    return this.publicStatus(s);
  }

  async complete(providerId, input = {}) {
    const state = String(input.state ?? '');
    const s = this.sessions.get(state);
    if (!s) throw new OAuthError('oauth_bad_state', 'invalid or expired state');
    if (s.providerId !== providerId) throw new OAuthError('oauth_channel_mismatch', 'provider does not match login session');
    const pasted = parsePastedOAuth(input.code);
    if (pasted.state && pasted.state !== s.state) throw new OAuthError('oauth_state_mismatch', 'pasted code does not match this login');
    await this.finishWithCode(s, { code: pasted.code });
    return this.publicStatus(s);
  }

  async finishWithCode(s, query) {
    if (s.status !== 'pending') throw new OAuthError('oauth_replay', 'this login was already finished');
    if (this.now() - s.createdAt > SESSION_TTL_MS) {
      s.status = 'error';
      s.error = 'login expired';
      throw new OAuthError('oauth_expired', 'login expired');
    }
    if (query.error) {
      s.status = 'error';
      s.error = String(query.error_description || query.error);
      throw new OAuthError('oauth_denied', s.error);
    }
    const code = parsePastedOAuthCode(query.code);
    if (!code) throw new OAuthError('oauth_no_code', 'authorization code missing');
    const provider = this.provider(s.providerId);
    const tokens = await this.exchange(provider, code, s);
    await this.authorizeTokens(s, provider, tokens);
    return s;
  }

  async authorizeTokens(s, provider, tokens) {
    const access = tokens.access_token;
    if (!access) throw new OAuthError('oauth_no_token', 'token endpoint returned no access_token');
    const expiresIn = Number(tokens.expires_in);
    const channel = { id: provider.id, hint: provider.hint, contextWindow: s.contextWindow, maxTokens: s.maxTokens };
    const discovered = await discoverUpstreamModels({
      baseUrl: provider.defaultBaseUrl,
      credential: access,
      api: provider.id === 'chatgpt' ? 'chatgpt-codex' : provider.id === 'claude' ? 'anthropic-messages' : undefined,
      authStyle: provider.authStyle,
      channel,
      fetchImpl: this.fetchImpl,
    }).catch((err) => ({ models: fallbackModelsFor(channel), source: 'fallback', reason: err.message }));
    let catalog = discovered.models ?? [];
    if (catalog.length === 0) catalog = normalizeModels(s.models);
    if (catalog.length === 0) catalog = fallbackModelsFor(channel);
    if (catalog.length === 0) {
      s.status = 'error';
      s.error = 'could not discover models; pass --models';
      throw new OAuthError('models_required', s.error);
    }
    s.pending = {
      access,
      refreshToken: tokens.refresh_token,
      expiresIn,
      chatgptAccountId: accountIdFromToken(tokens.id_token || access),
    };
    s.discoveredModels = catalog;
    s.verifier = undefined;
    s.deviceAuthId = undefined;
    s.deviceCode = undefined;
    s.status = 'authorized';
    return s;
  }

  async commit(providerId, input = {}, { credentialsFile } = {}) {
    const state = String(input.state ?? '');
    const s = this.sessions.get(state);
    if (!s) throw new OAuthError('oauth_bad_state', 'invalid or expired state');
    if (s.providerId !== providerId) throw new OAuthError('oauth_channel_mismatch', 'provider does not match login session');
    if (s.status !== 'authorized' || !s.pending) throw new OAuthError('oauth_not_authorized', 'finish login before selecting models');
    if (this.now() - s.createdAt > SESSION_TTL_MS) {
      s.status = 'error';
      s.error = 'login expired';
      throw new OAuthError('oauth_expired', 'login expired');
    }
    const selected = normalizeModels(input.models ?? s.models);
    if (selected.length === 0) throw new OAuthError('models_required', 'pick at least one model');
    const provider = this.provider(s.providerId);
    const contextWindow = Number(input.contextWindow ?? s.contextWindow);
    const maxTokens = Number(input.maxTokens ?? s.maxTokens);
    const overrides = {
      contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined,
      maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : undefined,
      reasoningEfforts: input.reasoningEfforts ?? s.reasoningEfforts,
    };
    const models = mergeDiscoveredModels(selected, s.discoveredModels, overrides, { id: provider.id, hint: provider.hint });
    const p = s.pending;
    const expires = Number.isFinite(p.expiresIn) ? this.now() + p.expiresIn * 1000 : undefined;
    const grant = setGrant(credentialsFile, provider.recordKey, {
      access: p.access,
      refresh: p.refreshToken,
      expires,
      accountId: p.chatgptAccountId,
    });
    s.pending = undefined;
    s.status = 'success';
    s.models = models;
    return {
      status: 'success',
      provider: provider.id,
      overlayId: provider.overlayId,
      recordKey: grant.recordKey,
      models: models.map((m) => ({ id: m.id, contextWindow: m.contextWindow, maxTokens: m.maxTokens })),
    };
  }

  async pollDeviceOnce(s) {
    const provider = this.provider(s.providerId);
    if ((s.deviceStyle || provider.deviceStyle) === 'rfc8628') return this.pollDeviceRfc(s, provider);
    let res;
    try {
      res = await this.fetchImpl(provider.devicePollUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ device_auth_id: s.deviceAuthId, user_code: s.userCode }),
      });
    } catch (err) {
      throw new OAuthError('oauth_device_unreachable', `device poll unreachable: ${err.message}`);
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 || res.status === 404 || data.error === 'authorization_pending' || data.status === 'pending') {
      throw new OAuthError('oauth_device_pending', 'waiting for browser confirm');
    }
    if (!res.ok || data.error) throw new OAuthError('oauth_denied', String(data.error_description || data.error || `device poll HTTP ${res.status}`));
    const code = data.authorization_code || data.code;
    if (!code) throw new OAuthError('oauth_no_code', 'device poll returned no code');
    if (data.code_verifier) s.verifier = data.code_verifier;
    s.redirectUri = provider.deviceRedirectUri || s.redirectUri;
    const tokens = await this.exchange(provider, code, s);
    await this.authorizeTokens(s, provider, tokens);
  }

  async pollDeviceRfc(s, provider) {
    let res;
    try {
      const { headers, body } = tokenRequest(provider, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: s.deviceCode,
        client_id: provider.clientId,
      });
      res = await this.fetchImpl(provider.tokenUrl, { method: 'POST', headers, body });
    } catch (err) {
      throw new OAuthError('oauth_device_unreachable', `device poll unreachable: ${err.message}`);
    }
    const data = await res.json().catch(() => ({}));
    const err = data.error;
    if (err === 'authorization_pending' || err === 'slow_down' || data.status === 'pending') {
      throw new OAuthError('oauth_device_pending', 'waiting for browser confirm');
    }
    if (!res.ok || err) throw new OAuthError('oauth_denied', String(data.error_description || err || `device poll HTTP ${res.status}`));
    if (!data.access_token) throw new OAuthError('oauth_no_token', 'token endpoint returned no access_token');
    await this.authorizeTokens(s, provider, data);
  }

  async postToken(provider, payload, failCode = 'oauth_token_failed') {
    const { headers, body } = tokenRequest(provider, payload);
    let res;
    try {
      res = await this.fetchImpl(provider.tokenUrl, { method: 'POST', headers, body });
    } catch (err) {
      throw new OAuthError('oauth_token_unreachable', `token endpoint unreachable: ${err.message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new OAuthError(failCode, failCode === 'oauth_refresh_failed' ? 'refresh failed' : 'token exchange failed');
    try {
      return JSON.parse(text);
    } catch {
      throw new OAuthError('oauth_token_bad_json', 'token endpoint returned unreadable JSON');
    }
  }

  exchange(provider, code, session) {
    const payload = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: session.redirectUri,
      client_id: provider.clientId,
      code_verifier: session.verifier,
    };
    if (provider.tokenBody === 'json' && session.state) payload.state = session.state;
    return this.postToken(provider, payload);
  }
}

module.exports = { LocalOAuth, OAuthError, SESSION_TTL_MS, tokenRequest };
