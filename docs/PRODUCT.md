# TDHarness-coding

Small-team coding tree on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). **Usable. Not a mature product.**

This page is the public product detail for the *coding* edition. It is not an employee installer and not a hosted SaaS.

## Who it is for

A handful of people who can clone, pin official `@deepseek-ai/dsh`, apply the patches in this repo, and put in their own API key. Local folder as the workspace.

Not for: “download Setup and it just works”, SLA, or replacing the official `dsh` install.

## What you get

- Kernel patches (Windows junctions on UNC, SMB-safe writes, session publish on smbfs, …)
- A solo overlay (`overlays/solo.yml`) — local workspace-write, no company gateway
- Known bugs written down in [BUGS.md](../BUGS.md)
- Issues and PRs **here** (upstream does not take external PRs; their Issues are closed)

## What you do not get

- Company login, Tailscale, SMB chairs, Caddy, roster
- A guaranteed upgrade channel
- The office client branded TDHarness

The name `TDHarness-coding` can change later. Do not bake it into npm or bundle ids.

## Install

See [README](../README.md). Pin is in `kernel.yml` (currently `0.1.1-rc.2`).

## Upstream

MIT. Report vanilla kernel bugs in [upstream Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) and link the Issue here. Product work stays in this repository.
