# Local model setup (coding tree)

This repo does **not** ship a company gateway, roster, or seats. Model traffic stays between your machine and the vendor.

Official `dsh` already has a Models page (API keys, custom OpenAI-compatible routes, and vendor logins that pi-ai ships). This tree adds a **CLI** that records the same local facts, with a `*_OK=1` proof and no office login.

## What it records

| Action | Where the secret goes | Where the route goes |
| --- | --- | --- |
| `login chatgpt` / `grok` / `claude` | `$DSH_HOME/.credentials.yaml` record `llm-pi-ai/<provider>` (OAuth grant) | optional extra `dsh-llm-pi-ai` route in an overlay |
| `custom --label … --base-url … --key …` | `$DSH_HOME/.credentials.yaml` ref such as `ACME_GATEWAY_API_KEY` | overlay route with `apiKeyEnv` (never the key) |
| `--context` / per-model context | not a secret | overlay `contextWindow` / `defaultContextWindow` |

The overlay never stores access tokens. The credential file is owner-only on POSIX (`chmod 600`).

## Commands

```bash
node scripts/models.js list
node scripts/prove-models.js   # MODELS_PROVE_OK=1 — mock token endpoints only
```

OAuth (browser login, then the CLI writes the grant):

```bash
node scripts/models.js login grok
# device code: open the printed URL, enter the user code
node scripts/models.js commit grok --state STATE --session /tmp/tdh-oauth-STATE.json --models grok-4.6 --context 256000
```

```bash
node scripts/models.js login claude
# paste-code: open authorizeUrl, paste the callback code or URL
node scripts/models.js complete claude --state STATE --code 'PASTE' --session …
node scripts/models.js commit claude --state STATE --session … --models claude-opus-4-6
```

Custom endpoint:

```bash
node scripts/models.js custom --label 'Acme Gateway' --base-url 'https://llm.example.test/v1' --key "$ACME_KEY" --models acme-large --context 123456
```

Credentials always go to `$DSH_HOME/.credentials.yaml`. Overlay YAML is written only with `--write-overlay` (default file `overlays/solo.yml`, override with `--overlay`) so a login does not replace the sandbox overlay by accident. Point `--credentials` / `--dsh-home` at a throwaway home in tests.

## Providers in this CLI

Public installed-app clients used by the vendor CLIs (not account secrets):

- **chatgpt** — Codex device code → record `llm-pi-ai/openai-codex`
- **grok** — xAI RFC 8628 device code → `llm-pi-ai/xai`
- **claude** — Claude Code authorize + paste callback → `llm-pi-ai/anthropic`

Gemini / Google One is **not** included: personal Code Assist on the old Gemini CLI path was retired (2026-06-18). Use a key or a custom endpoint if you have a working Google route.

## Proof

`node scripts/prove-models.js` starts no browser and hits no vendor. It mocks token / device / `/models` endpoints and checks:

- pasted `CODE#STATE` and callback URLs parse
- ChatGPT device-code → grant with `chatgpt_account_id`
- Claude paste-code rejects a mismatched state, then records the grant
- Grok RFC 8628 device-code records the grant
- custom endpoint writes `apiKeyEnv` + context, never the key, into the overlay
- public status JSON does not echo access tokens

Green line: `MODELS_PROVE_OK=1`.
