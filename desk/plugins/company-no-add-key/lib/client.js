window.__ModuleLoader__.load({
	id: "company-no-add-key",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		const inject = ["slots"];

		// Additive CSS only. Do not register on settings.onboarding: that
		// coordinator shows one step at a time, and a null render that never
		// complete()s freezes welcome-notice / composer.
		const CSS = [
			'[data-slot="settings.section"] input[type="password"] { display: inline-block; }',
			'[data-slot="settings.section"] input[autocomplete="new-password"],',
			'[data-slot="settings.section"] input[autocomplete="current-password"] { display: inline-block; }',
			'[data-slot="settings.onboarding"] input[type="password"] { display: inline-block; }'
		].join("\n");

		function HideOfficialKeyFields() {
			return React.createElement("style", null, CSS);
		}

		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", function () {
				return ctx.slots.register({
					name: "sidebar.footer.action",
					id: "company-no-add-key",
					order: 60
				}, HideOfficialKeyFields);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
