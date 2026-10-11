export const name = "image-send-durable";

const DESCRIBE_IMAGE_TOOL = "describe_image";

export function apply(ctx) {
	const disposers = new Map();

	function mask(agent) {
		if (agent == null || typeof agent !== "object") return;
		const tools = agent.ctx && agent.ctx.tools;
		if (tools == null || typeof tools.restrict !== "function") return;
		try {
			const prev = disposers.get(agent.id);
			if (typeof prev === "function") prev();
		} catch {}
		try {
			const stop = tools.restrict({ deny: [DESCRIBE_IMAGE_TOOL] });
			if (typeof stop === "function") disposers.set(agent.id, stop);
		} catch {}
	}

	ctx.on("agent/created", ({ agent }) => mask(agent));
	ctx.on("agent/disposed", ({ agent }) => {
		try {
			const prev = disposers.get(agent.id);
			if (typeof prev === "function") prev();
		} catch {}
		disposers.delete(agent.id);
	});
	ctx.on("agent/request", async (payload, next) => {
		const resolved = await next();
		mask(payload.agent);
		queueMicrotask(() => mask(payload.agent));
		setTimeout(() => mask(payload.agent), 30);
		return resolved;
	});
}
