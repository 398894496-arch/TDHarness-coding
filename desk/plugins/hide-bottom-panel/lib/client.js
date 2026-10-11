window.__ModuleLoader__.load({
	id: "hide-bottom-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const inject = ["slots"];

		const CSS = [
			"/* Keep the right better-sidebar. Hide the bottom workbench and its toggle. */",
			"[data-dsh-bottom-panel] { display: none !important; height: 0 !important; visibility: hidden !important; pointer-events: none !important; transform: none !important; }",
			"[class*=\"bottomPanel\"] { display: none !important; }",
			"[class*=\"bottomResize\"] { display: none !important; }",
			"[class*=\"bottomClose\"] { display: none !important; }",
			"[data-dsh-panel-host] [data-dsh-bottom-panel] { display: none !important; }",
			"[data-dsh-toggle-cluster] > *:first-child { display: none !important; }",
			"[data-dsh-toggle-cluster] button[aria-label*=\"底部面板\"],",
			"[data-dsh-toggle-cluster] button[aria-label*=\"bottom panel\" i],",
			"button[aria-label=\"展开底部面板\"],",
			"button[aria-label=\"折叠底部面板\"],",
			"button[title=\"展开底部面板\"],",
			"button[title=\"折叠底部面板\"],",
			"button[aria-label=\"Expand bottom panel\"],",
			"button[aria-label=\"Collapse bottom panel\"],",
			"button[title=\"Expand bottom panel\"],",
			"button[title=\"Collapse bottom panel\"] { display: none !important; }",
			"html, :root, #root { --dsh-sidebar-height: 0px !important; }",
			"[data-slot=\"root\"] { --dsh-sidebar-height: 0px !important; }",
			"#root > div[data-slot=\"root\"] > div > div:nth-child(2) { margin-bottom: 0 !important; }"
		].join("\n");

		function plantCss() {
			if (typeof document === "undefined" || typeof document.getElementById !== "function") return;
			if (!document.head || typeof document.createElement !== "function") return;
			let el = document.getElementById("hide-bottom-panel-css");
			if (el === null) {
				el = document.createElement("style");
				el.id = "hide-bottom-panel-css";
				document.head.appendChild(el);
			}
			el.textContent = CSS;
		}

		function HideBottomPanel() {
			return React.createElement("style", null, CSS);
		}

		function apply(ctx) {
			plantCss();
			ctx.slots.inject("sidebar.footer.action", function () {
				return ctx.slots.register({
					name: "sidebar.footer.action",
					id: "hide-bottom-panel",
					order: 50
				}, HideBottomPanel);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
