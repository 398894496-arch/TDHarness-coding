# Security

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository (private vulnerability reporting). Do not open a public issue for something that can be exploited. Include what you ran, what you saw, and the version (`VERSION` in the server's checkout). Expect a first answer within a few days; fixes ship as a normal dated release with the finding described in [CHANGELOG.md](CHANGELOG.md) once it is fixed.

Supported: the latest release on `main`. Sites update by pulling `main` and re-running setup ([docs/SERVER.md](docs/SERVER.md#upgrade-back-up-uninstall)).

## What TDH protects, and how

| Asset | Protection |
| --- | --- |
| Model keys and subscriptions | Only on the server (`D:\dsh\runtime\gateway.env`, OAuth files), never sent to desks; only an admin's token can change them |
| Calls to models, web search, image and video | The gateway answers only a live per-person login token (or a server-side service token); deactivating a person stops them on the next request; per-person usage ledger |
| Traffic between desks and the server | TLS through Caddy with the server's own root, which setup exports and the clients trust; the plaintext gateway port is closed to the LAN once desks have moved |
| Sign-in | Salted PBKDF2-SHA256 hashes, constant-time compare, throttling per login and per address, a random seed-admin password per install, self-service password change |
| Client updates | Ed25519-signed `version.json`, sha256 per pack and per delta file; desks refuse anything else |
| The company share | One Windows account per person; NTFS rights from the roster: a person's folder (raw conversations, memory, deliverables) for them, their director and admins; handbook and company memory changed only by admins and directors; folders a person cannot open are hidden |
| The server's own folders | `runtime` (keys, tokens, passwords, signing key) and `brain` (raw conversations) for SYSTEM and administrators only |
| The knowledge base | Search scoped by person and department, raw conversations only by path for owner, director, admin; logged without the question |
| Web fetch from the server | Private and internal addresses are refused, including IPv4 embedded in IPv6 forms |

Proofs for most of this run in CI (`scripts/prove-*.js`, `scripts/prove-people.py`); the folder rights are proven on the server with `server\prove-secure-folders.ps1`.

## What TDH does not protect against

- **The employee.** The agent runs with the employee's own rights on their own computer. It can read what they can read and run what they can run. TDH controls keys, quotas, the company disk and who sees what; it does not sandbox a person from their own machine.
- **The server's administrators.** They can open every file on the server, including everyone's raw conversations. Every desk says so.
- **Prompt injection.** Content the agent reads (web pages, documents, the handbook) can try to steer it. Limiting who can write the handbook and company memory narrows this; it does not remove it. Destructive desktop actions wait for the person's yes.
- **A compromised server.** Whoever controls the Windows server controls the site.
- **Identity beyond the roster.** No AD / LDAP / SSO, no second factor yet.

Past findings and their fixes: [docs/SECURITY-REVIEW-C3.md](docs/SECURITY-REVIEW-C3.md) and the changelog (search for 复评 / review).
