window.__ModuleLoader__.load({
	id: "image-send-durable",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const inject = ["conversation"];
		function apply() {
			// Native image blocks stay in the session so the official dialog can
			// render them. Host half only masks describe_image.
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
