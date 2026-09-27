# TDH server from this repo

Clone on a Windows machine, then run `pwsh -File scripts\setup-all.ps1` as Administrator. That finds git / node / python, pulls LFS, and starts the server. To wipe a previous install first: `pwsh -File scripts\wipe-tdh-server.ps1`.

That starts:

- download and login on `https://<this-pc>:8443/`
- people API on `127.0.0.1:4181`
- knowledge search on `127.0.0.1:4182` (empty brain)
- model gateway on `0.0.0.0:8450`

It does **not** upload or copy:

- company documents
- brain / knowledge text
- model subscription keys
- Tailscale auth keys
- office roster or office IPs

Those stay on the machine that runs setup. The seed admin is created locally: `tdh` / `12345678`. Setup must log in as that account (`LOGIN_PROVE_OK=1`) and plant the desktop client. Put a model key in `D:\dsh\runtime\gateway.env` (copied from `server/gateway.env.example`). Restart the `Autostart-Gateway` task after editing.

Needs: Windows, Administrator, Python 3, Node 22+, Git LFS (`git lfs pull`).
