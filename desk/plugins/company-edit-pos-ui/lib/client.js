window.__ModuleLoader__.load({
	id: "company-edit-pos-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const inject = [];

		function walkLeaves(node, out) {
			if (node == null) return;
			if (node.kind === "leaf") {
				out.push(node);
				return;
			}
			const kids = node.children || [];
			for (let i = 0; i < kids.length; i++) walkLeaves(kids[i], out);
		}

		function activePath(ctx) {
			const sb = typeof ctx.get === "function" ? ctx.get("betterSidebar") : undefined;
			if (sb == null || typeof sb.getSnapshot !== "function") return "";
			const snap = sb.getSnapshot();
			const state = snap && snap.state;
			if (state == null) return "";
			const leaves = [];
			walkLeaves(state.splits, leaves);
			let pane = null;
			for (let i = 0; i < leaves.length; i++) {
				if (leaves[i].id === state.activePane) pane = leaves[i];
			}
			if (pane == null) pane = leaves[0];
			if (pane == null) return "";
			const tabs = pane.tabs || [];
			for (let i = 0; i < tabs.length; i++) {
				if (tabs[i].id === pane.active && tabs[i].path) return String(tabs[i].path);
			}
			return "";
		}

		function readCaret() {
			if (typeof document === "undefined" || typeof document.querySelector !== "function") {
				return null;
			}
			const root = document.querySelector("[data-dsh-panel-host] .cm-content");
			if (root == null || typeof document.getSelection !== "function") return null;
			const sel = document.getSelection();
			if (sel == null || sel.rangeCount === 0) return null;
			const range = sel.getRangeAt(0);
			if (!root.contains(range.startContainer)) return null;
			const pre = document.createRange();
			pre.selectNodeContents(root);
			pre.setEnd(range.startContainer, range.startOffset);
			const from = pre.toString().length;
			pre.setEnd(range.endContainer, range.endOffset);
			const to = pre.toString().length;
			const text = root.textContent || "";
			const before = text.slice(0, from);
			const nl = before.lastIndexOf("\n");
			const line = before.split("\n").length;
			const ch = from - (nl + 1);
			const scroller = document.querySelector("[data-dsh-panel-host] .cm-scroller");
			return {
				line: line,
				ch: ch,
				from: from,
				to: to,
				scrollTop: scroller == null ? 0 : scroller.scrollTop,
			};
		}

		function tick(ctx) {
			const path = activePath(ctx);
			const caret = readCaret();
			if (path === "" || caret == null || typeof fetch !== "function") return;
			const sessionId = ctx.session && ctx.session.id ? String(ctx.session.id) : "";
			fetch("/company/edit-pos", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path: path,
					line: caret.line,
					ch: caret.ch,
					from: caret.from,
					to: caret.to,
					scrollTop: caret.scrollTop,
					sessionId: sessionId,
				}),
			}).catch(function () {});
		}

		function apply(ctx) {
			if (typeof ctx.effect !== "function") return;
			ctx.effect(function () {
				const t = setInterval(function () {
					tick(ctx);
				}, 2500);
				return function () {
					clearInterval(t);
				};
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
