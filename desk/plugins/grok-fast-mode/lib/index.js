import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const STORE = "D:/dsh/shared/grok-fast.json";
const CHANNEL = "/grok-fast";

function readEnabled() {
	try {
		return JSON.parse(readFileSync(STORE, "utf8")).enabled === true;
	} catch {
		return true;
	}
}

function writeEnabled(enabled) {
	mkdirSync("D:/dsh/shared", { recursive: true });
	writeFileSync(STORE, `${JSON.stringify({ enabled: !!enabled }, null, 2)}\n`, "utf8");
}

export const name = "grok-fast-mode";

export function apply(ctx) {
	ctx.inject(["connection"], (scoped) => {
		const connection = scoped.get("connection");
		if (connection === undefined) return;
		scoped.effect(() => connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
			try {
				if (endpoint === "get") return { ok: true, value: { enabled: readEnabled() } };
				if (endpoint === "set") {
					writeEnabled(payload?.enabled === true);
					return { ok: true, value: { enabled: readEnabled() } };
				}
				return { ok: false, error: { message: `unknown /grok-fast endpoint "${endpoint}"` } };
			} catch (error) {
				return { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
			}
		}, { authority: "trusted-host" }), "grok-fast-mode: /grok-fast rpc channel");
	});
}
