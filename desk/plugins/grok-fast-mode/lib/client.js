window.__ModuleLoader__.load({
	id: "grok-fast-mode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		const CHANNEL = "/grok-fast";
		const inject = ["connection"];
		const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';

		async function callFast(rpc, endpoint, payload) {
			const result = await rpc.call(CHANNEL, endpoint, payload);
			if (!result?.ok) throw new Error(result?.error?.message ?? "grok-fast rpc failed");
			return result.value;
		}

		function FastSwitch(props) {
			const rpc = props.rpc;
			const [enabled, setEnabled] = react.useState(true);
			const [busy, setBusy] = react.useState(false);
			react.useEffect(() => {
				if (rpc === undefined) return undefined;
				let cancelled = false;
				callFast(rpc, "get", {}).then((value) => {
					if (!cancelled) setEnabled(value.enabled === true);
				}, () => {});
				return () => { cancelled = true; };
			}, [rpc]);
			const on = enabled === true;
			return react.createElement(
				"button",
				{
					type: "button",
					role: "switch",
					"aria-checked": on ? "true" : "false",
					"aria-label": "快速推理",
					title: on ? "Grok 快速推理已开" : "Grok 快速推理已关",
					disabled: busy || props.locked === true,
					onClick: () => {
						if (rpc === undefined || busy) return;
						const next = !on;
						setBusy(true);
						setEnabled(next);
						callFast(rpc, "set", { enabled: next }).then((value) => {
							setEnabled(value.enabled === true);
						}, () => {
							setEnabled(on);
						}).finally(() => setBusy(false));
					},
					style: {
						display: "inline-flex",
						alignItems: "center",
						gap: "8px",
						height: "32px",
						padding: "0 4px 0 8px",
						border: "none",
						borderRadius: "16px",
						background: "transparent",
						color: "inherit",
						cursor: busy ? "default" : "pointer",
						opacity: busy || props.locked === true ? 0.7 : 1,
						fontFamily: FONT,
					},
				},
				react.createElement("span", { style: { fontSize: "13px", fontWeight: 600, fontFamily: FONT } }, "快速推理"),
				react.createElement(
					"span",
					{
						"aria-hidden": "true",
						style: {
							position: "relative",
							width: "40px",
							height: "22px",
							borderRadius: "11px",
							background: on ? "#30d158" : "#8e8e93",
							flexShrink: 0,
							transition: "background 160ms ease",
						},
					},
					react.createElement("span", {
						style: {
							position: "absolute",
							top: "2px",
							left: on ? "20px" : "2px",
							width: "18px",
							height: "18px",
							borderRadius: "50%",
							background: "#fff",
							boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
							transition: "left 160ms ease",
						},
					}),
				),
			);
		}

		function FastSettings(props) {
			return react.createElement(
				"div",
				{ style: { padding: "16px 20px", fontFamily: FONT } },
				react.createElement("div", { style: { fontSize: "16px", fontWeight: 600, marginBottom: "12px", fontFamily: FONT } }, "Grok 快速推理"),
				react.createElement("div", { style: { fontSize: "12px", opacity: 0.7, marginBottom: "12px", fontFamily: FONT } }, "只对 Grok 生效。打开后走 SuperGrok Fast。"),
				react.createElement(FastSwitch, { rpc: props.rpc }),
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			const rpc = ctx.get("connection")?.rpc;
			slots.inject("conversation.input.right", () => slots.register(
				{ name: "conversation.input.right", id: "grok-fast-toggle" },
				(props) => react.createElement(FastSwitch, { rpc, locked: props.locked }),
			));
			slots.inject("settings.section", () => slots.register(
				{ name: "settings.section", id: "grok-fast-mode", order: 55, label: () => "快速推理" },
				() => react.createElement(FastSettings, { rpc }),
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
