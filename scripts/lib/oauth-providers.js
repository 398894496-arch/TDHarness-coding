'use strict';

// Public installed-app OAuth clients used by the vendor CLIs (Codex / Grok / Claude Code).
// These are not account secrets. Gemini Code Assist for personal Google One is retired; omit it.

const PROVIDERS = {
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    flow: 'device_code',
    deviceStyle: 'codex',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    deviceUserCodeUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
    devicePollUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    verificationUri: 'https://auth.openai.com/codex/device',
    deviceRedirectUri: 'https://auth.openai.com/deviceauth/callback',
    scope: 'openid profile email offline_access',
    authStyle: 'bearer',
    recordKey: 'llm-pi-ai/openai-codex',
    overlayId: 'openai-codex',
    defaultBaseUrl: 'https://chatgpt.com/backend-api/codex',
    hint: 'gpt-5.5',
    catalog: true,
  },
  grok: {
    id: 'grok',
    label: 'xAI / Grok',
    flow: 'device_code',
    deviceStyle: 'rfc8628',
    clientId: 'b1a00492-073a-47ea-816f-4c329264a828',
    authorizeUrl: 'https://auth.x.ai/oauth2/authorize',
    tokenUrl: 'https://auth.x.ai/oauth2/token',
    deviceUserCodeUrl: 'https://auth.x.ai/oauth2/device/code',
    verificationUri: 'https://auth.x.ai/activate',
    scope: 'openid profile email offline_access grok-cli:access api:access',
    authStyle: 'bearer',
    recordKey: 'llm-pi-ai/xai',
    overlayId: 'xai',
    defaultBaseUrl: 'https://api.x.ai/v1',
    hint: 'grok-4.6, grok-4.6-fast',
    catalog: true,
  },
  claude: {
    id: 'claude',
    label: 'Claude',
    flow: 'authorization_code_paste',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',
    scope: 'org:create_api_key user:profile user:inference user:sessions:claude_code',
    tokenBody: 'json',
    authorizeParams: { code: 'true' },
    authStyle: 'anthropic-oauth',
    recordKey: 'llm-pi-ai/anthropic',
    overlayId: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    hint: 'claude-opus-4-6',
    catalog: true,
    pasteHint: 'After the browser login, paste the callback code (or the whole URL) from the Anthropic console page.',
  },
};

function providerSpec(id) {
  return PROVIDERS[id] ?? null;
}

function listProviders() {
  return Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    label: p.label,
    flow: p.flow,
    overlayId: p.overlayId,
    recordKey: p.recordKey,
    hint: p.hint,
  }));
}

module.exports = { PROVIDERS, providerSpec, listProviders };
