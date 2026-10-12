window.__ModuleLoader__.load({
	id: "company-shell",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");
		// Verified live on the desk (2026-08-21): the host's per-plugin require
		// resolves this to the same icon/primitive set the shipped rows use —
		// real SVG icon components (IconPanelLeftOutline16, IconCloseOutline16,
		// IconChevronLeftOutline14/Right, IconCheckOutline16, ...) plus Button /
		// Pill / Tooltip. Using these instead of Unicode glyphs (◧ ✕) is what
		// makes the collapse toggle and close button match the rest of the frame
		// instead of rendering as font-dependent boxes.
		const P0 = require("@deepseek-ai/dsh-client-ui-primitives");
		// 0.1.7 renamed Icon*16 / Icon*14 / Icon*20 to Regular / Medium.
		// A missing icon crashes CompanySidebar on first paint and the left
		// workspace column disappears.
		const P = Object.assign({}, P0);
		const ICON_ALIAS = {
			IconArchiveOutline20: "IconArchiveOutlineRegular",
			IconCheckOutline16: "IconCheckOutlineRegular",
			IconCloseFill14: "IconCloseFillRegular",
			IconCloseOutline16: "IconCloseOutlineRegular",
			IconDownloadOutline16: "IconDownloadOutlineRegular",
			IconEditOutline16: "IconEditOutlineRegular",
			IconEllipsisOutline16: "IconEllipsisOutlineRegular",
			IconPanelLeftOutline16: "IconPanelLeftOutlineRegular",
			IconPersonalizationOutline16: "IconPersonalizationOutlineRegular",
			IconPlusOutline16: "IconPlusOutlineRegular",
			IconSearchOutline16: "IconSearchOutlineRegular"
		};
		for (const oldName in ICON_ALIAS) {
			if (!P[oldName]) P[oldName] = P0[ICON_ALIAS[oldName]];
		}
		const inject = ["slots", "workspaces", "layout", "sessions"];
		// Latin from the system UI face (Segoe UI on Windows, SF on macOS), Chinese
		// from the system CJK face. Neither Segoe nor SF carries Chinese glyphs, so
		// no Chinese name is ever drawn by a Latin font's fallback.
		const FONT = '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans SC", sans-serif';
		const MONO = '"Cascadia Mono", Consolas, "SF Mono", Menlo, "Microsoft YaHei UI", monospace';

		// The sidebar publishes its own live width as a CSS variable so the third
		// column docks against the real edge instead of a number baked in here
		// (the sidebar is user-resizable and collapsible).
		const SIDEBAR_VAR = "--company-sidebar-width";

		// Colors come from the shipped theme alias tokens, never hard-coded. Those
		// tokens are what the official appearance row overrides, so reading them
		// is how this shell follows light/dark.
		//
		// Note that bg-base / bg-layer-1 / bg-layer-2 can collapse to the same
		// value under some themes, so surfaces must be separated by borders, not
		// by fill.
		const T = {
			base: "var(--dsw-alias-bg-base)",
			sidebar: "var(--dsw-specific-sidebar-fill)",
			border1: "var(--dsw-alias-border-l1)",
			border2: "var(--dsw-alias-border-l2)",
			brand: "var(--dsw-alias-brand-primary)",
			label: "var(--dsw-alias-label-primary)",
			label2: "var(--dsw-alias-label-secondary)",
			ok: "var(--dsw-alias-state-success-primary)",
			err: "var(--dsw-alias-state-error-primary)",
			warn: "var(--dsw-alias-state-warn-primary)"
		};
		const tint = function (token, pct) {
			return "color-mix(in srgb, " + token + " " + pct + "%, transparent)";
		};

		// Declared here, not next to the docking helpers that also use it: the CSS
		// string below is built at module scope, so anything it interpolates has to
		// be initialized before it. A `const` further down parses fine and then
		// fails at import time with "cannot access before initialization", which
		// takes the whole frame with it now that the shipped sidebar row is off.
		const ANIM = "var(--ds-transition-duration-slow, 240ms) var(--ds-ease-in-out, ease-in-out)";
		// Layout hard-codes the collapsed track at 56. We paint a 48px rail and
		// override the frame's first grid track when the sidebar is collapsed
		// (see [data-sidebar-collapsed] below). Keep the two numbers in lockstep.
		const RAIL_W = 48;
		// The site's brand on the three brand seats (sidebar mark, sidebar name, hero mark).
		// A site fills these with a site patch: images as data URLs (painted as a mask in the
		// chrome's label colour), the wordmark's width / height, and the name screen readers
		// say. Without them the desk shows the product name as text. @@SITE_BRAND
		const SITE_BRAND_WORDMARK = "";
		const SITE_BRAND_MARK = "";
		const SITE_BRAND_RATIO = 0;
		const SITE_BRAND_LABEL = "TDHarness";

		// company-settings-look-v2. Every page this shell adds to settings, and
		// the sidebar's new-session / panel rows, share this one look: a page
		// title, grouped cards of rows, quiet buttons, chips for choices. Colors
		// are theme tokens only, so dark mode follows the official appearance row.
		const CARD_FILL = "var(--dsw-alias-settings-card-fill, " + T.base + ")";
		const CARD_LINE = "var(--dsw-alias-settings-card-stroke, " + T.border2 + ")";
		const HOVER = "var(--dsw-alias-interactive-bg-hover, " + tint(T.label2, 8) + ")";
		const QUIET = "var(--dsw-alias-fill-tsp-secondary, " + tint(T.label2, 10) + ")";
		const LABEL3 = "var(--dsw-alias-label-tertiary, " + T.label2 + ")";
		const svgUrl = function (body) {
			return "url(\"data:image/svg+xml," + encodeURIComponent(
				"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round'>" + body + "</svg>"
			) + "\")";
		};
		const NAV_ICONS = {
			account: svgUrl("<circle cx='8' cy='5.5' r='2.6'/><path d='M3 13.4c.6-2.3 2.6-3.8 5-3.8s4.4 1.5 5 3.8'/>"),
			floor: svgUrl("<circle cx='6' cy='5.6' r='2.2'/><path d='M1.9 13c.5-2 2.1-3.3 4.1-3.3s3.6 1.3 4.1 3.3'/><path d='M10.4 3.5a2.2 2.2 0 0 1 0 4.2'/><path d='M11.6 9.9c1.3.4 2.2 1.5 2.5 3.1'/>"),
			people: svgUrl("<rect x='2' y='3' width='12' height='10' rx='2'/><circle cx='6' cy='7' r='1.5'/><path d='M3.9 10.9c.4-.9 1.2-1.5 2.1-1.5s1.7.6 2.1 1.5'/><path d='M9.8 6.6h2.6'/><path d='M9.8 9h1.8'/>"),
			version: svgUrl("<path d='M13.2 8a5.2 5.2 0 1 1-1.5-3.7'/><path d='M13.2 2.6v2.2H11'/><path d='M8 5.4V8l1.8 1.2'/>")
		};
		const NAV_GLYPH = { "账号": "account", "同事": "floor", "人员": "people", "版本": "version" };
		const CHEVRON = svgUrl("<path d='M4.5 6.25 8 9.75l3.5-3.5'/>");
		const LOOK_CSS = [
			// Settings nav glyphs for the sections this shell adds (the host falls
			// back to a gear for every id it does not know).
			".VOzbGW_navCell[data-cs-nav] .VOzbGW_navIcon { display: none !important; }",
			".VOzbGW_navCell[data-cs-nav]::before {",
			"  content: \"\"; flex: none; width: 16px; height: 16px; background: currentColor;",
			"  -webkit-mask: var(--cs-ico) center / 16px 16px no-repeat; mask: var(--cs-ico) center / 16px 16px no-repeat;",
			"}",
			".VOzbGW_navCell[data-cs-nav=\"account\"] { --cs-ico: " + NAV_ICONS.account + "; }",
			".VOzbGW_navCell[data-cs-nav=\"floor\"] { --cs-ico: " + NAV_ICONS.floor + "; }",
			".VOzbGW_navCell[data-cs-nav=\"people\"] { --cs-ico: " + NAV_ICONS.people + "; }",
			".VOzbGW_navCell[data-cs-nav=\"version\"] { --cs-ico: " + NAV_ICONS.version + "; }",

			".cs-set { padding: 2px 0 28px; color: " + T.label + "; font-size: 13px; line-height: 20px; }",
			".cs-set *, .cs-set *::before, .cs-set *::after { box-sizing: border-box; }",
			".cs-set-title { margin: 0 0 4px; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; color: " + T.label + "; }",
			".cs-set-desc { margin: 0 0 22px; font-size: 13px; line-height: 20px; color: " + T.label2 + "; }",
			".cs-set-group { margin: 0 0 22px; }",
			".cs-set-gh { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 26px; margin: 0 2px 8px; }",
			".cs-set-gl { font-size: 12px; font-weight: 600; color: " + T.label2 + "; letter-spacing: 0.02em; }",
			".cs-set-gx { font-size: 12px; color: " + LABEL3 + "; display: inline-flex; align-items: center; gap: 8px; }",
			".cs-set-card { border-radius: 12px; border: 0.5px solid " + CARD_LINE + "; background: " + CARD_FILL + "; overflow: hidden; }",
			".cs-set-row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 10px 16px; }",
			".cs-set-card > * + * { border-top: 0.5px solid " + T.border1 + "; }",
			".cs-set-main { flex: 1; min-width: 0; }",
			".cs-set-rt { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: " + T.label + "; }",
			".cs-set-rt > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".cs-set-rd { margin-top: 2px; font-size: 12px; line-height: 18px; color: " + T.label2 + "; overflow: hidden; text-overflow: ellipsis; }",
			".cs-set-side { flex: none; display: flex; align-items: center; gap: 8px; }",
			".cs-set-row-tall { min-height: 76px; padding: 14px 16px; gap: 14px; }",
			".cs-set-row-tall .cs-set-rt { font-size: 15px; }",
			".cs-set-row-off .cs-avatar, .cs-set-row-off .cs-set-rt > span:first-child { opacity: 0.5; }",
			".cs-set-empty { padding: 18px 16px; font-size: 13px; color: " + LABEL3 + "; text-align: center; }",
			".cs-set-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; padding: 12px 16px; background: " + tint(T.label2, 3) + "; }",
			".cs-set-foot > .cs-set-note { flex: 1; min-width: 0; margin: 0; }",
			".cs-set-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: -8px 0 22px; }",
			".cs-set-note { margin: 10px 2px 0; font-size: 12px; line-height: 18px; color: " + T.label2 + "; }",
			".cs-set-note-warn { color: " + T.warn + "; }",
			".cs-set-note-err { color: " + T.err + "; }",
			".cs-mono { font-family: " + MONO + "; font-size: 12px; letter-spacing: 0; }",
			".cs-num { font-variant-numeric: tabular-nums; }",
			".cs-strong { font-weight: 600; color: " + T.label + "; }",
			".cs-muted { color: " + LABEL3 + "; }",

			".cs-avatar { position: relative; flex: none; width: 32px; height: 32px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;",
			"  background: " + tint(T.brand, 13) + "; color: " + T.brand + "; font-size: 13px; font-weight: 600; text-transform: uppercase; }",
			".cs-avatar-lg { width: 44px; height: 44px; font-size: 17px; }",
			".cs-avatar[data-online]::after { content: \"\"; position: absolute; right: -1px; bottom: -1px; width: 10px; height: 10px; border-radius: 50%;",
			"  background: " + LABEL3 + "; box-shadow: 0 0 0 2px " + CARD_FILL + "; }",
			".cs-avatar[data-online=\"1\"]::after { background: " + T.ok + "; }",

			".cs-badge { display: inline-flex; align-items: center; gap: 4px; flex: none; height: 20px; padding: 0 8px; border-radius: 10px;",
			"  font-size: 11.5px; line-height: 20px; font-weight: 500; white-space: nowrap; background: " + QUIET + "; color: " + T.label2 + "; }",
			".cs-badge-ok { background: " + tint(T.ok, 14) + "; color: " + T.ok + "; }",
			".cs-badge-warn { background: " + tint(T.warn, 14) + "; color: " + T.warn + "; }",
			".cs-badge-err { background: " + tint(T.err, 12) + "; color: " + T.err + "; }",
			".cs-badge-brand { background: " + tint(T.brand, 12) + "; color: " + T.brand + "; }",
			".cs-badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }",

			".cs-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: none; height: 30px; padding: 0 12px; border-radius: 8px;",
			"  border: 0.5px solid " + T.border2 + "; background: " + T.base + "; color: " + T.label + "; cursor: pointer; white-space: nowrap;",
			"  font: 500 13px/1 " + FONT + "; transition: background-color .15s ease, opacity .15s ease, border-color .15s ease; }",
			".cs-btn:hover:not(:disabled) { background: " + HOVER + "; }",
			".cs-btn:disabled { opacity: 0.45; cursor: default; }",
			".cs-btn:focus-visible { outline: 2px solid " + tint(T.brand, 55) + "; outline-offset: 1px; }",
			".cs-btn-sm { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 7px; }",
			".cs-btn-primary { background: " + T.label + "; color: " + T.base + "; border-color: transparent; }",
			".cs-btn-primary:hover:not(:disabled) { background: " + T.label + "; opacity: 0.86; }",
			".cs-btn-ghost { background: transparent; border-color: transparent; color: " + T.label2 + "; }",
			".cs-btn-ghost:hover:not(:disabled) { color: " + T.label + "; }",
			".cs-btn-danger { background: transparent; border-color: transparent; color: " + T.err + "; }",
			".cs-btn-danger:hover:not(:disabled) { background: " + tint(T.err, 9) + "; }",
			".cs-btn-danger-solid { background: " + T.err + "; border-color: transparent; color: #fff; }",
			".cs-btn-danger-solid:hover:not(:disabled) { background: " + T.err + "; opacity: 0.88; }",

			".cs-select { appearance: none; -webkit-appearance: none; height: 28px; padding: 0 26px 0 10px; border-radius: 7px; cursor: pointer;",
			"  border: 0.5px solid " + T.border2 + "; color: " + T.label + "; font: 400 12.5px/1 " + FONT + ";",
			"  background: " + T.base + "; }",
			".cs-select-wrap { position: relative; display: inline-flex; flex: none; }",
			".cs-select-wrap::after { content: \"\"; position: absolute; right: 8px; top: 50%; width: 12px; height: 12px; margin-top: -6px; pointer-events: none;",
			"  background: " + T.label2 + "; -webkit-mask: " + CHEVRON + " center / 12px 12px no-repeat; mask: " + CHEVRON + " center / 12px 12px no-repeat; }",
			".cs-select:hover:not(:disabled) { border-color: " + T.label2 + "; }",
			".cs-select:disabled { opacity: 0.5; cursor: default; }",
			".cs-input { width: 100%; height: 34px; padding: 0 12px; border-radius: 8px; border: 0.5px solid " + T.border2 + ";",
			"  background: " + T.base + "; color: " + T.label + "; font: 400 13px/1 " + FONT + "; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }",
			".cs-input::placeholder { color: " + LABEL3 + "; }",
			// company-no-add-key hides password boxes in settings (no API keys typed
			// into the desk). The people page's initial-password box is not a key.
			".cs-set .cs-form input.cs-input[type=\"password\"] { display: block !important; }",
			".cs-input:focus, .cs-select:focus-visible { border-color: " + T.brand + "; box-shadow: 0 0 0 3px " + tint(T.brand, 16) + "; outline: none; }",
			".cs-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; padding: 16px; }",
			".cs-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }",
			".cs-field > span { font-size: 12px; line-height: 16px; color: " + T.label2 + "; }",
			".cs-field .cs-select-wrap, .cs-field .cs-select { width: 100%; }",
			".cs-field .cs-select { height: 34px; font-size: 13px; }",

			".cs-confirm { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: " + tint(T.err, 6) + "; font-size: 12.5px; color: " + T.label + "; }",
			".cs-confirm > span { flex: 1; min-width: 0; }",

			".cs-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 0 0 22px; }",
			".cs-stat { padding: 14px 16px; border-radius: 12px; border: 0.5px solid " + CARD_LINE + "; background: " + CARD_FILL + "; min-width: 0; }",
			".cs-stat-k { font-size: 12px; line-height: 16px; color: " + T.label2 + "; }",
			".cs-stat-v { margin-top: 6px; font-size: 22px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; color: " + T.label + "; }",
			".cs-stat-v small { margin-left: 3px; font-size: 13px; font-weight: 500; color: " + T.label2 + "; }",
			".cs-stat-s { margin-top: 2px; font-size: 11.5px; line-height: 16px; color: " + LABEL3 + "; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
			".cs-meter { height: 6px; margin-top: 10px; border-radius: 3px; background: " + QUIET + "; overflow: hidden; }",
			".cs-meter > i { display: block; height: 100%; border-radius: 3px; background: " + T.ok + "; transition: width .3s ease; }",
			".cs-meter-warn > i { background: " + T.warn + "; }",
			".cs-meter-err > i { background: " + T.err + "; }",

			".cs-quota { display: flex; align-items: center; gap: 16px; margin: 0 0 22px; padding: 14px 16px; border-radius: 12px; border: 0.5px solid " + CARD_LINE + "; background: " + CARD_FILL + "; }",
			".cs-quota-main { flex: 1; min-width: 0; }",
			".cs-quota-k { font-size: 12px; color: " + T.label2 + "; }",
			".cs-quota-v { display: flex; align-items: baseline; gap: 6px; margin-top: 2px; font-size: 22px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }",
			".cs-quota-v small { font-size: 12px; font-weight: 400; color: " + T.label2 + "; }",
			".cs-quota-side { flex: none; text-align: right; font-size: 12px; line-height: 18px; color: " + T.label2 + "; }",

			".cs-vendor { border-radius: 12px; border: 0.5px solid " + CARD_LINE + "; background: " + CARD_FILL + "; overflow: hidden; }",
			".cs-vendor + .cs-vendor { margin-top: 8px; }",
			".cs-vendor-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 10px 16px; border: none; background: transparent;",
			"  cursor: pointer; text-align: left; font: inherit; color: inherit; }",
			".cs-vendor-head:hover { background: " + tint(T.label2, 4) + "; }",
			".cs-vendor-logo { flex: none; width: 32px; height: 32px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center;",
			"  background: " + T.label + "; color: " + T.base + "; font-size: 14px; font-weight: 700; box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, .14); }",
			// Brand tiles keep their own colors in both themes.
			".cs-vendor-logo-grok, .cs-vendor-logo-openai { background: #0d0d0d; color: #fff; }",
			".cs-vendor-logo-claude { background: #f5f0e8; color: #d97757; box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, .08); }",
			".cs-vendor-logo svg { display: block; }",
			".cs-avatar { overflow: hidden; }",
			".cs-avatar-img { width: 100%; height: 100%; object-fit: cover; display: block; }",
			".cs-avatar-edit { position: relative; flex: none; padding: 0; border: none; background: transparent; border-radius: 50%; cursor: pointer; }",
			".cs-avatar-edit:disabled { cursor: default; }",
			".cs-avatar-cam { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%;",
			"  background: rgba(0, 0, 0, .45); color: #fff; font-size: 11px; font-weight: 500; opacity: 0; transition: opacity .15s ease; }",
			".cs-avatar-edit:hover .cs-avatar-cam, .cs-avatar-edit:focus-visible .cs-avatar-cam { opacity: 1; }",
			".cs-name-edit { display: flex; align-items: center; gap: 8px; }",
			".cs-name-edit .cs-input { max-width: 220px; height: 30px; }",
			"form.cs-set-row .cs-input { flex: 1; min-width: 0; height: 30px; }",
			".cs-vendor-chev { flex: none; width: 16px; height: 16px; background: " + T.label2 + "; transition: transform .2s ease;",
			"  -webkit-mask: " + CHEVRON + " center / 16px 16px no-repeat; mask: " + CHEVRON + " center / 16px 16px no-repeat; transform: rotate(-90deg); }",
			".cs-vendor.is-open .cs-vendor-chev { transform: none; }",
			".cs-vendor-body { border-top: 0.5px solid " + T.border1 + "; }",
			".cs-vendor-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }",
			".cs-vendor-msg { padding: 0 16px 16px; font-size: 12.5px; line-height: 20px; color: " + T.label2 + "; }",

			".cs-seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: 9px; background: " + QUIET + "; }",
			".cs-seg button { height: 26px; padding: 0 12px; border: none; border-radius: 7px; background: transparent; cursor: pointer;",
			"  color: " + T.label2 + "; font: 500 12.5px/1 " + FONT + "; transition: background-color .15s ease, color .15s ease; }",
			".cs-seg button:hover { color: " + T.label + "; }",
			".cs-seg button.is-on { background: " + T.base + "; color: " + T.label + "; box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 0 0 0.5px " + T.border1 + "; }",

			".cs-mlist > * + * { border-top: 0.5px solid " + T.border1 + "; }",
			".cs-mrow { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 8px 16px; }",
			".cs-mrow-off .cs-mrow-name { color: " + T.label2 + "; }",
			".cs-mrow-name { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 13.5px; font-weight: 500; }",
			".cs-mrow-name > span:first-child { margin-right: 2px; }",
			".cs-mrow-tiers { flex: none; display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 62%; }",
			".cs-tick { flex: none; width: 18px; height: 18px; border-radius: 5px; padding: 0; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;",
			"  border: 1.5px solid " + T.border2 + "; background: " + T.base + "; color: " + T.base + "; transition: background-color .15s ease, border-color .15s ease; }",
			".cs-tick:hover { border-color: " + T.label2 + "; }",
			".cs-tick.is-on { background: " + T.label + "; border-color: " + T.label + "; }",
			".cs-tick svg { display: block; opacity: 0; }",
			".cs-tick.is-on svg { opacity: 1; }",
			".cs-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px; border-radius: 12px; cursor: pointer;",
			"  border: 0.5px solid " + T.border2 + "; background: transparent; color: " + T.label2 + "; font: 500 12px/1 " + FONT + ";",
			"  transition: background-color .15s ease, color .15s ease, border-color .15s ease; }",
			".cs-chip:hover { color: " + T.label + "; border-color: " + T.label2 + "; }",
			".cs-chip.is-on { background: " + tint(T.label, 8) + "; border-color: " + tint(T.label, 30) + "; color: " + T.label + "; }",
			".cs-chip-fast.is-on { background: " + tint(T.warn, 14) + "; border-color: " + tint(T.warn, 45) + "; color: " + T.warn + "; }",
			".cs-chip svg { display: block; }",

			// Sidebar: new session + global panels (plugins), above the workspaces.
			".cs-side-new { flex: none; padding: 2px 10px 6px; }",
			".cs-new { display: flex; align-items: center; gap: 8px; width: 100%; height: 36px; padding: 0 12px; border-radius: 10px; cursor: pointer;",
			"  border: 0.5px solid " + T.border2 + "; background: " + T.base + "; color: " + T.label + "; font: 500 13px/1 " + FONT + ";",
			"  box-shadow: 0 1px 2px rgba(0, 0, 0, .04); transition: background-color .15s ease; }",
			".cs-new:hover { background: " + HOVER + "; }",
			".cs-new svg { flex: none; display: block; }",
			".cs-side-nav { flex: none; display: flex; flex-direction: column; gap: 2px; padding: 0 10px 8px; }",
			".cs-nav-row { display: flex; align-items: center; gap: 8px; width: 100%; height: 34px; padding: 0 12px; border: none; border-radius: 8px; cursor: pointer;",
			"  background: transparent; color: " + T.label + "; font: 400 13px/1 " + FONT + "; text-align: left; }",
			".cs-nav-row:hover { background: var(--dsw-specific-sidebar-nav-item-hover, " + HOVER + "); }",
			".cs-nav-row.is-on { background: var(--dsw-specific-sidebar-nav-item-active, " + tint(T.label2, 12) + "); font-weight: 500; }",
			".cs-nav-glyph { flex: none; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; color: " + T.label2 + "; }",
			".cs-nav-row.is-on .cs-nav-glyph { color: " + T.label + "; }",
			".cs-side-rail .cs-side-new, .cs-side-rail .cs-side-nav { display: flex; flex-direction: column; align-items: center; padding: 0; gap: 8px; }",
			".cs-side-rail .cs-new, .cs-side-rail .cs-nav-row { width: 36px; height: 36px; padding: 0; justify-content: center; border-radius: 10px; }",
			".cs-side-rail .cs-new { border-color: transparent; background: transparent; box-shadow: none; }",
			".cs-side-rail .cs-new:hover { background: " + HOVER + "; }",
			// One 10px gutter for everything in the wide column: the borrowed
			// workspace tree and the settings foot used to sit on the very edge.
			".cs-side:not(.cs-side-rail) .cs-pane-sess { padding: 0 10px; }",
			".cs-side:not(.cs-side-rail) .cs-foot { padding: 4px 10px 8px; }"
		].join("\n");

		// company-task-card-look-v2: the task card panel.
		const CARD_CSS = [
			".cs-tc { display: flex; flex-direction: column; height: 100%; min-height: 0; font-family: " + FONT + "; color: " + T.label + "; }",
			".cs-tc *, .cs-tc *::before, .cs-tc *::after { box-sizing: border-box; }",
			".cs-tc-head { flex: none; padding: 16px 18px 14px; border-bottom: 0.5px solid " + T.border1 + "; }",
			".cs-tc-top { display: flex; align-items: flex-start; gap: 8px; }",
			".cs-tc-title { flex: 1; min-width: 0; margin: 0; padding: 3px 6px; margin-left: -6px; border: 1px solid transparent; border-radius: 8px;",
			"  background: transparent; color: " + T.label + "; font: 600 17px/1.4 " + FONT + "; outline: none; width: 100%; }",
			".cs-tc-title:not([readonly]):hover { border-color: " + T.border1 + "; }",
			".cs-tc-title:not([readonly]):focus { border-color: " + T.brand + "; box-shadow: 0 0 0 3px " + tint(T.brand, 14) + "; }",
			".cs-tc-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin-top: 8px; font-size: 12px; color: " + T.label2 + "; }",
			".cs-tc-who { display: inline-flex; align-items: center; gap: 6px; }",
			".cs-tc-who .cs-avatar { width: 20px; height: 20px; font-size: 10px; }",
			".cs-tc-arrow { color: " + LABEL3 + "; }",
			".cs-tc-steps { display: flex; align-items: center; gap: 0; margin-top: 14px; }",
			".cs-tc-step { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: " + LABEL3 + "; white-space: nowrap; }",
			".cs-tc-step i { width: 8px; height: 8px; border-radius: 50%; background: " + T.border2 + "; flex: none; }",
			".cs-tc-step.is-done { color: " + T.label2 + "; }",
			".cs-tc-step.is-done i { background: " + T.ok + "; }",
			".cs-tc-step.is-now { color: " + T.label + "; font-weight: 600; }",
			".cs-tc-step.is-now i { background: " + T.brand + "; box-shadow: 0 0 0 3px " + tint(T.brand, 18) + "; }",
			".cs-tc-step.is-bad { color: " + T.err + "; font-weight: 600; }",
			".cs-tc-step.is-bad i { background: " + T.err + "; box-shadow: 0 0 0 3px " + tint(T.err, 16) + "; }",
			".cs-tc-line { flex: 1; height: 1px; min-width: 14px; margin: 0 8px; background: " + T.border2 + "; }",
			".cs-tc-line.is-done { background: " + T.ok + "; }",
			".cs-tc-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 18px 18px; }",
			".cs-tc-sec { padding: 14px 0; }",
			".cs-tc-sec + .cs-tc-sec { border-top: 0.5px solid " + T.border1 + "; }",
			".cs-tc-sh { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }",
			".cs-tc-st { font-size: 12px; font-weight: 600; color: " + T.label2 + "; letter-spacing: 0.02em; }",
			".cs-tc-sx { font-size: 11.5px; color: " + LABEL3 + "; }",
			".cs-tc-text { width: 100%; min-height: 84px; resize: vertical; padding: 10px 12px; border-radius: 10px; border: 0.5px solid " + T.border2 + ";",
			"  background: " + T.base + "; color: " + T.label + "; font: 400 13px/1.65 " + FONT + "; outline: none; transition: border-color .15s ease, box-shadow .15s ease; }",
			".cs-tc-text:focus { border-color: " + T.brand + "; box-shadow: 0 0 0 3px " + tint(T.brand, 14) + "; }",
			".cs-tc-text::placeholder { color: " + LABEL3 + "; }",
			".cs-tc-read { padding: 10px 12px; border-radius: 10px; background: " + QUIET + "; font-size: 13px; line-height: 1.65; white-space: pre-wrap; word-break: break-word; }",
			".cs-tc-read.is-empty { color: " + LABEL3 + "; }",
			".cs-tc-hint { margin-top: 6px; font-size: 11.5px; line-height: 1.5; color: " + LABEL3 + "; }",
			".cs-tc-saved { font-size: 11px; color: " + T.ok + "; }",
			".cs-tc-list { border-radius: 10px; border: 0.5px solid " + T.border1 + "; overflow: hidden; }",
			".cs-tc-list > * + * { border-top: 0.5px solid " + T.border1 + "; }",
			".cs-tc-item { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 10px 8px 12px; cursor: default; }",
			".cs-tc-item.is-link { cursor: pointer; }",
			".cs-tc-item.is-link:hover { background: " + tint(T.label2, 5) + "; }",
			".cs-tc-item-main { flex: 1; min-width: 0; }",
			".cs-tc-item-t { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".cs-tc-item-d { margin-top: 1px; font-size: 11.5px; color: " + T.label2 + "; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".cs-tc-ico { flex: none; width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;",
			"  background: " + QUIET + "; color: " + T.label2 + "; font-size: 11px; font-weight: 600; }",
			".cs-tc-ico.is-live { background: " + tint(T.brand, 14) + "; color: " + T.brand + "; }",
			".cs-tc-empty { padding: 14px 12px; font-size: 12px; color: " + LABEL3 + "; text-align: center; }",
			".cs-tc-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }",
			".cs-tc-folder { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 7px 10px; border-radius: 9px; background: " + QUIET + "; font-size: 11.5px; color: " + T.label2 + "; }",
			".cs-tc-folder code { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: " + MONO + "; font-size: 11.5px; color: " + T.label + "; }",
			".cs-tc-stamp { position: relative; padding: 12px 14px; border-radius: 10px; font-size: 13px; line-height: 1.6; }",
			".cs-tc-stamp.is-ok { background: " + tint(T.ok, 10) + "; border: 0.5px solid " + tint(T.ok, 35) + "; }",
			".cs-tc-stamp.is-bad { background: " + tint(T.err, 8) + "; border: 0.5px solid " + tint(T.err, 30) + "; }",
			".cs-tc-stamp b { display: block; margin-bottom: 2px; font-size: 12px; }",
			".cs-tc-stamp.is-ok b { color: " + T.ok + "; }",
			".cs-tc-stamp.is-bad b { color: " + T.err + "; }",
			".cs-tc-events { margin: 0; padding: 0; list-style: none; }",
			".cs-tc-events li { position: relative; padding: 0 0 10px 16px; font-size: 12px; line-height: 1.5; color: " + T.label2 + "; }",
			".cs-tc-events li::before { content: \"\"; position: absolute; left: 3px; top: 6px; width: 6px; height: 6px; border-radius: 50%; background: " + T.border2 + "; }",
			".cs-tc-events li::after { content: \"\"; position: absolute; left: 5.5px; top: 14px; bottom: 0; width: 1px; background: " + T.border1 + "; }",
			".cs-tc-events li:last-child::after { display: none; }",
			".cs-tc-events b { font-weight: 500; color: " + T.label + "; }",
			".cs-tc-events span { color: " + LABEL3 + "; margin-left: 6px; font-size: 11px; }",
			".cs-tc-foot { flex: none; padding: 12px 18px 14px; border-top: 0.5px solid " + T.border1 + "; background: " + T.base + "; }",
			".cs-tc-foot .cs-tc-text { min-height: 60px; margin-bottom: 10px; }",
			".cs-tc-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }",
			".cs-tc-actions > .cs-tc-note { flex: 1; min-width: 0; margin: 0; font-size: 11.5px; line-height: 1.45; color: " + T.label2 + "; }",
			".cs-tc-form { display: flex; flex-direction: column; gap: 14px; padding-top: 14px; }",
			".cs-tc-form .cs-field > span { font-weight: 500; }",
			".cs-tc-err { margin-top: 8px; font-size: 12px; color: " + T.err + "; }"
		].join("\n");
		const CSS = [
			// 说明书硬约束：整页含官方工作区树，不用随附英文字体画中文名。
			"html[data-company-shell], html[data-company-shell] body,",
			".cs-side, .cs-side *,",
			".YDXeBa_projectRow, .YDXeBa_projectRow * {",
			"  font-family: " + FONT + " !important;",
			"}",
			".cs-side {",
			"  height: 100%; min-height: 0; box-sizing: border-box;",
			"  display: flex; flex-direction: column;",
			"  font-family: " + FONT + ";",
			"  background: " + T.sidebar + "; color: " + T.label + ";",
			"  padding: 6px 0 0;",
			"}",
			".cs-side-head {",
			"  flex: none; display: flex; align-items: center; gap: 8px;",
			"  box-sizing: border-box; height: 36px;",
			"  padding: 4px 10px 4px 12px;",
			"}",
			".cs-side-brand {",
			"  display: flex; align-items: center; gap: 6px; min-width: 0;",
			"  margin: 0; padding: 0; border: none; background: transparent;",
			"  color: inherit; cursor: pointer;",
			"}",
			".cs-side-brand:hover { opacity: 0.72; }",
			".cs-side-name { font-size: 13px; font-weight: 600; }",
			".cs-icon-btn {",
			"  margin-left: auto; flex: none; cursor: pointer;",
			"  display: inline-flex; align-items: center; justify-content: center;",
			"  box-sizing: border-box; padding: 0;",
			"  width: 28px; height: 28px; border-radius: 50%;",
			"  background: transparent; color: " + T.label2 + ";",
			"  border: 1px solid transparent;",
			"}",
			".cs-icon-btn:hover { background: " + tint(T.brand, 10) + "; }",
			".cs-icon-btn svg { display: block; flex: none; }",
			".cs-desk-file { display: inline-flex; align-items: center; }",
			".cs-desk-file-btn {",
			"  font-family: " + FONT + "; font-size: 12px; line-height: 1;",
			"  height: 28px; padding: 0 8px; border-radius: 8px; cursor: pointer;",
			"  border: 1px solid " + T.border1 + "; background: transparent; color: " + T.label + ";",
			"}",
			".cs-desk-file-btn:hover { background: " + tint(T.brand, 10) + "; }",
			".cs-desk-file-btn:disabled { opacity: 0.5; cursor: default; }",
			// Official ComposerAttachments drop mask is images-only and stays up
			// when a capture drop never reaches its reset(). Hide the invitation;
			// company-shell owns files via 文件 + inbox.
			".BInVoG_mask { display: none !important; }",
			".cs-desk-drop {",
			"  display: none; position: fixed; inset: 0; z-index: 4000;",
			"  pointer-events: none; align-items: center; justify-content: center;",
			"  background: var(--dsw-alias-bg-mask-drop, color-mix(in srgb, black 40%, transparent));",
			"  backdrop-filter: blur(8px);",
			"}",
			".cs-desk-drop.cs-desk-drop-on { display: flex; }",
			".cs-desk-drop-card {",
			"  text-align: center; color: " + T.label + "; font-family: " + FONT + ";",
			"  padding: 0 40px;",
			"}",
			".cs-desk-drop-title { font-size: 20px; font-weight: 600; }",
			".cs-desk-drop-desc { font-size: 14px; color: " + T.label2 + "; margin-top: 12px; }",

			// Collapsed rail. Official workspace/settings controls are 36×36
			// (qDHVXG_rail / VOzbGW_rail). Our toggle and mark have to share that
			// box or they sit 2–8px off the stack. 48px is the narrowest track
			// that still fits a 36px icon with a 6px gutter; layout's own
			// SIDEBAR_COLLAPSED is 56.
			".cs-side-rail { padding: 8px 0 6px; overflow: hidden; gap: 8px; }",
			".cs-side-rail .cs-side-head {",
			"  flex-direction: column; align-items: center; justify-content: flex-start;",
			"  gap: 8px; padding: 0; height: auto; min-height: 0;",
			"}",
			".cs-side-rail .cs-side-head > * {",
			"  flex: none; display: flex; align-items: center; justify-content: center;",
			"  width: 36px; height: 36px;",
			"}",
			".cs-side-rail .cs-side-brand {",
			"  justify-content: center; align-items: center;",
			"  width: 36px; height: 36px;",
			"}",
			".cs-side-rail .cs-icon-btn {",
			"  margin-left: 0; width: 36px; height: 36px; padding: 0;",
			"}",
			".cs-side-rail .cs-side-brand,",
			".cs-side-rail .cs-region,",
			".cs-side-rail .cs-tabrow {",
			"  display: none !important;",
			"}",
			".cs-side-rail .cs-foot {",
			"  display: flex; flex-direction: column; align-items: center; gap: 8px;",
			"}",
			".cs-side-rail .qDHVXG_iconButton,",
			".cs-side-rail .VOzbGW_trigger {",
			"  width: 36px !important; height: 36px !important; margin: 0 !important;",
			"}",
			"[data-slot=\"settings.action\"], .VOzbGW_actions {",
			"  display: none !important;",
			"}",
			"html:not([data-company-desk-role=\"admin\"]) .VOzbGW_navList > button:nth-child(n + 3) {",
			"  display: none !important;",
			"}",
			"html[data-company-desk-role=\"admin\"] .VOzbGW_navList > button:nth-child(n + 4) {",
			"  display: none !important;",
			"}",
			".cs-people button.cs-logout {",
			"  height: 32px; padding: 0 14px; border: none; border-radius: 6px; cursor: pointer;",
			"  background: " + T.brand + "; color: " + T.base + "; font-weight: 600;",
			"  max-width: 160px; font-family: " + FONT + "; font-size: 13px;",
			"}",
			".cs-people button.cs-logout:disabled { opacity: 0.55; cursor: default; }",
			".cs-people button.cs-kernel-btn {",
			"  height: 32px; padding: 0 14px; border: 1px solid #ddd; border-radius: 8px; cursor: pointer;",
			"  background: #fff; color: #222; font-weight: 500;",
			"  font-family: " + FONT + "; font-size: 13px;",
			"}",
			".cs-people button.cs-kernel-btn:disabled { opacity: 0.55; cursor: default; }",
			".cs-people { padding: 8px 0 24px; max-width: 720px; }",
			".cs-floor-table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 12px 0; }",
			".cs-sub-wrap { overflow-x: auto; margin-top: 8px; }",
			".cs-sub-table { width: 100%; min-width: 520px; border-collapse: collapse; font-size: 13px; }",
			".cs-sub-table th, .cs-sub-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid " + T.border1 + "; vertical-align: middle; }",
			".cs-sub-table th { color: " + T.label2 + "; font-weight: 600; white-space: nowrap; }",
			".cs-sub-table td:nth-child(1), .cs-sub-table td:nth-child(2), .cs-sub-table td:nth-child(3), .cs-sub-table td:nth-child(5) { white-space: nowrap; }",
			".cs-floor-table th, .cs-floor-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid " + T.border1 + "; }",
			".cs-floor-table th { color: " + T.label2 + "; font-weight: 600; }",
			".cs-on { color: " + T.ok + "; }",
			".cs-off { color: " + T.label2 + "; }",
			".cs-people h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; }",
			".cs-people p, .cs-people li { font-size: 13px; color: " + T.label2 + "; line-height: 1.5; }",
			".cs-people-list { list-style: none; margin: 12px 0; padding: 0; }",
			".cs-people-list li {",
			"  display: flex; gap: 8px 10px; align-items: center; flex-wrap: wrap;",
			"  padding: 10px 0; border-bottom: 1px solid " + T.border1 + ";",
			"}",
			".cs-people-list li.is-off { opacity: 0.7; }",
			".cs-people-meta {",
			"  display: flex; gap: 10px; align-items: center; flex-wrap: wrap;",
			"  flex: 1 1 240px; min-width: 0;",
			"}",
			".cs-people-login { font-weight: 600; color: " + T.label + "; min-width: 88px; }",
			".cs-people-actions { display: flex; gap: 6px; flex-wrap: wrap; flex: 1 1 220px; justify-content: flex-end; }",
			".cs-people-actions button {",
			"  height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer;",
			"  border: 1px solid " + T.border2 + "; background: transparent;",
			"  color: " + T.label + "; font-family: " + FONT + "; font-size: 12px;",
			"}",
			".cs-people-actions button.cs-warn {",
			"  color: " + T.err + "; border-color: " + T.err + ";",
			"}",
			".cs-people-actions button.cs-pending {",
			"  background: " + T.err + "; color: " + T.base + "; border-color: " + T.err + "; font-weight: 600;",
			"}",
			".cs-people-confirm { flex: 1 1 100%; margin: 0; font-size: 12px; color: " + T.warn + "; }",
			".cs-join-row { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }",
			".cs-join-row button {",
			"  height: 32px; padding: 0 14px; border-radius: 6px; cursor: pointer;",
			"  border: 1px solid " + T.border2 + "; background: transparent;",
			"  color: " + T.label + "; font-family: " + FONT + "; font-size: 13px;",
			"}",
			".cs-join-row button.is-on {",
			"  background: " + T.brand + "; color: " + T.base + "; border-color: " + T.brand + "; font-weight: 600;",
			"}",
			".cs-people form { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }",
			".cs-people label { font-size: 12px; color: " + T.label2 + "; }",
			".cs-people input, .cs-people select {",
			"  height: 32px; padding: 0 8px; border-radius: 6px;",
			"  border: 1px solid " + T.border2 + "; background: " + T.base + ";",
			"  color: " + T.label + "; font-family: " + FONT + ";",
			"}",
			".cs-people button[type=\"submit\"] {",
			"  height: 32px; border: none; border-radius: 6px; cursor: pointer;",
			"  background: " + T.brand + "; color: " + T.base + "; font-weight: 600;",
			"}",
			".cs-people-note { margin-top: 8px; font-size: 12px; }",
			".cs-side-rail .qDHVXG_sectionHeader,",
			".cs-side-rail .qDHVXG_searchButton,",
			".cs-side-rail .qDHVXG_search,",
			".cs-side-rail button[aria-label=\"搜索会话\"],",
			".cs-side-rail button[aria-label=\"Search sessions\"] {",
			"  display: none !important;",
			"}",
			".cs-side .qDHVXG_sectionHeader { height: 36px; margin: 0 0 8px 0; padding-right: 40px; }",
			".cs-side .qDHVXG_iconButton { width: 28px; height: 28px; }",
			// Hero fish sits in a 34px grid track. A wordmark is wider (often ~6:1), so
			// widen that first column when our mark is the occupant.
			".pXSMma_headline:has([data-company-shell=\"brand-wordmark\"]) {",
			"  grid-template-columns: auto !important;",
			"}",
			".pXSMma_headline:has([data-company-shell=\"brand-wordmark\"]) .pXSMma_headlineText,",
			".pXSMma_headline:has([data-company-shell=\"brand-wordmark\"]) .pXSMma_previewBadge {",
			"  display: none !important;",
			"}",
			".pXSMma_headline:has([data-company-shell=\"brand-text\"]) {",
			"  grid-template-columns: auto auto !important;",
			"}",
			"[data-company-shell=\"brand-wordmark\"], [data-company-shell=\"brand-mark\"] {",
			"  display: inline-block; flex: none; vertical-align: middle;",
			"  background: var(--dsw-alias-label-primary);",
			"}",
			// Borrowed-DOM, same class of seam as the conversation padding squeeze.
			// The frame writes inline grid-template-columns with 56 as the first
			// track. Override only when details is also closed, so we don't smash
			// a live details column. Open-details + collapsed-sidebar stays 56.
			"[data-sidebar-collapsed][data-details-collapsed] { grid-template-columns: " + RAIL_W + "px minmax(0, 1fr) 0px !important; }",

			".cs-tabrow { flex: none; padding: 0 10px 8px 10px; }",
			".cs-tablist {",
			"  display: flex; gap: 2px; padding: 2px;",
			"  border-radius: 8px; background: " + tint(T.label2, 8) + ";",
			"}",
			".cs-tab {",
			"  flex: 1; text-align: center; cursor: pointer;",
			"  font-family: " + FONT + "; font-size: 12px;",
			"  padding: 5px 8px; border-radius: 6px;",
			"  background: transparent; color: " + T.label2 + ";",
			"  border: none;",
			"}",
			".cs-tab-on { background: " + T.base + "; color: " + T.label + "; font-weight: 600; }",
			"html[data-company-task-open] .wSkVaW_heroWorkspaceRow { display: none !important; }",
			// Task card is a fixed overlay. Indent the live conversation root so the
			// composer / hero sit in the remaining strip, including after startSession
			// replaces the node (inline padding on the old wrap would be lost).
			"html[data-company-task-open] [data-phase]:has(>[data-conversation-scroll]) {",
			"  box-sizing: border-box;",
			"  padding-left: var(--company-inspector-width, 0px);",
			"  transition: padding-left " + ANIM + ";",
			"}",
			"html[data-company-task-dragging] [data-phase]:has(>[data-conversation-scroll]) {",
			"  transition: none;",
			"}",
			// Provisioned pointers only. Hide kebab and "添加工作区".
			// Keep the per-folder "+" so a new chat can land in 部门 or 个人.
			".cs-side .YDXeBa_projectRow button[aria-label^=\"工作区\"],",
			".cs-side .YDXeBa_projectRow button[aria-label^=\"Workspace actions\"],",
			"button[aria-label=\"添加工作区\"],",
			"button[aria-label=\"添加工作区…\"],",
			"button[aria-label=\"Add workspace\"],",
			"button[aria-label=\"Add workspace…\"],",
			"[data-slot=\"sidebar.workspaces.directoryFlow\"],",
			"[data-slot=\"conversation.hero.workspace.directoryFlow\"],",
			"button[aria-label=\"新建文件夹\"],",
			"button[aria-label=\"Create folder\"],",
			".nL4_yW_sessionLogButton {",
			"  display: none !important;",
			"}",

			".cs-region { flex: 1; min-height: 0; display: flex; flex-direction: column; }",
			".cs-pane { flex: 1; min-height: 0; display: flex; flex-direction: column; }",
			".cs-pane-off { display: none; }",
			".cs-pane-sess { position: relative; }",
			".cs-pane-sess > :last-child { flex: 1; min-height: 0; overflow: auto; }",
			".cs-sess-archive {",
			"  position: absolute; top: 6px; right: 74px; z-index: 2;",
			"  padding: 0; pointer-events: none;",
			"}",
			// Team desk: the session folder lives on the server, so "open in
			// Explorer/Finder" has nothing useful to open. The official right
			// sidebar (files, terminal, browser) stays.
			"[data-slot=\"conversation.session.header.utilities\"]:has(img[src*=\"open-in-app/\"]) { display: none !important; }",
			"[data-dsh-toggle-cluster] { right: 72px !important; top: 12px !important; transition: right .2s ease !important; }",
			"html[data-company-rightbar-open] [data-dsh-toggle-cluster] { right: calc(var(--company-rightbar-width, 0px) + 10px) !important; }",
			"html[data-company-rightbar-drag] [data-dsh-toggle-cluster] { transition: none !important; }",
			".cs-sess-archive .cs-icon-btn { pointer-events: auto; margin-left: 0; }",
			".cs-side .qDHVXG_sectionHeader button svg {",
			"  display: block; width: 16px; height: 16px;",
			"}",
			// Official workspace tree paints "工作区" / "会话" in this label.
			// The sessions tab already says 会话; the three characters are noise.
			".cs-side .qDHVXG_sectionLabel { display: none !important; }",
			".cs-secthead {",
			"  flex: none; display: flex; align-items: center;",
			"  box-sizing: border-box; min-height: 36px; gap: 4px;",
			"  padding: 4px 10px;",
			"}",
			".cs-secthead-end { justify-content: flex-end; }",
			".cs-secthead .cs-icon-btn { margin-left: 0; }",
			".cs-secthead .cs-archive-end { margin-left: auto; }",
			".cs-search {",
			"  display: flex; align-items: center; min-width: 0; flex: 1; justify-content: flex-end;",
			"}",
			".cs-search-open {",
			"  flex: 1; height: 28px; gap: 4px; justify-content: flex-start;",
			"  border: 1px solid " + T.border2 + "; border-radius: 999px; padding: 0 6px;",
			"}",
			".cs-search-input {",
			"  flex: 1; min-width: 0; border: none; outline: none; background: transparent;",
			"  font-family: " + FONT + "; font-size: 12px; color: " + T.label + ";",
			"}",
			".cs-icon-btn-on { background: " + tint(T.brand, 14) + "; color: " + T.label + "; }",
			".cs-empty { padding: 16px 12px; font-size: 12px; color: " + T.label2 + "; }",
			".cs-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px 8px; }",
			".cs-row {",
			"  padding: 8px 10px; margin-bottom: 4px; border-radius: 8px; cursor: pointer;",
			"  border: 1px solid transparent;",
			"  font-size: 12px; font-weight: 400;",
			"}",
			".cs-row:hover { background: " + tint(T.label2, 8) + "; }",
			".cs-row-on {",
			"  background: " + tint(T.brand, 10) + "; border-color: " + tint(T.brand, 35) + ";",
			"}",
			".cs-row-t {",
			"  display: flex; align-items: center; gap: 8px;",
			"  font-size: 12px; line-height: 1.45;",
			"}",
			".cs-row-t-name {",
			"  flex: 1; min-width: 0; overflow: hidden;",
			"  text-overflow: ellipsis; white-space: nowrap;",
			"  font-size: 12px; font-weight: 400;",
			"}",
			".cs-row-m {",
			"  margin-top: 2px; font-size: 11px; font-weight: 400; line-height: 1.4;",
			"  color: " + T.label2 + ";",
			"}",
			".cs-dot {",
			"  flex: none; width: 8px; height: 8px; border-radius: 999px;",
			"}",
			".cs-row .cs-icon-btn { margin-left: 0; width: 22px; height: 22px; }",
			".cs-row-menu { flex: none; opacity: 0; }",
			".cs-row:hover .cs-row-menu, .cs-row-on .cs-row-menu, .cs-row-menu-on { opacity: 1; }",
			".cs-dot-wait { background: color-mix(in srgb, " + T.warn + " 20%, #e8c440 80%); }",
			".cs-dot-ok { background: " + T.ok + "; }",
			".cs-dot-no { background: " + T.err + "; }",
			".cs-group {",
			"  font-size: 11px; padding: 10px 10px 4px 10px; color: " + T.label2 + ";",
			"}",
			".cs-folder {",
			"  display: flex; align-items: center; gap: 8px;",
			"  padding: 8px 6px 8px 10px; margin-bottom: 0; border-radius: 8px; cursor: pointer;",
			"  border: none; background: transparent; flex: 1; min-width: 0; text-align: left;",
			"  font-family: " + FONT + "; color: " + T.label + ";",
			"}",
			".cs-folder:hover { background: " + tint(T.label2, 8) + "; }",
			".cs-folder-pin { font-weight: 600; }",
			".cs-folder-row {",
			"  display: flex; align-items: center; gap: 2px; margin-bottom: 4px;",
			"}",
			".cs-folder-open { background: " + tint(T.label2, 8) + "; }",
			".cs-folder-name {",
			"  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",
			"  font-size: 12px;",
			"}",
			".cs-folder-row .cs-folder-menu { flex: none; opacity: 0; }",
			".cs-folder-row:hover .cs-folder-menu, .cs-folder-row .cs-folder-menu-on { opacity: 1; }",
			".cs-row-nested { padding-left: 10px; }",
			".cs-folder-add {",
			"  display: flex; align-items: center; gap: 6px;",
			"  padding: 6px 10px; font-size: 12px; color: " + T.label2 + ";",
			"  cursor: pointer; border: none; background: transparent; width: 100%;",
			"  font-family: " + FONT + "; text-align: left;",
			"}",
			".cs-folder-add:hover { color: " + T.label + "; }",
			".cs-foot { flex: none; }",

			".cs-pill {",
			"  display: inline-flex; align-items: center; gap: 4px;",
			"  font-size: 10px; padding: 1px 6px; border-radius: 999px; margin-left: 6px;",
			"  white-space: nowrap;",
			"}",
			".cs-pill-wait { background: " + tint(T.warn, 16) + "; color: " + T.warn + "; }",
			".cs-pill-ok { background: " + tint(T.ok, 16) + "; color: " + T.ok + "; }",

			".cs-insp {",
			"  position: absolute; top: 0; bottom: 0;",
			"  left: var(" + SIDEBAR_VAR + ", 280px);",
			"  z-index: 5; pointer-events: auto;",
			"  box-sizing: border-box; overflow: hidden;",
			"  display: flex; flex-direction: column;",
			"  font-family: " + FONT + ";",
			"  background: " + T.base + "; color: " + T.label + ";",
			"  border-right: 1px solid " + T.border1 + ";",
			"}",
			// The column animates its own width to match the padding animation on
			// the conversation host, so the two edges move as one. While dragging
			// both are unanimated, or the panel lags behind the cursor.
			".cs-insp:not(.cs-insp-drag) { transition: width " + ANIM + "; }",
			".cs-insp-grip {",
			"  position: absolute; top: 0; bottom: 0; right: -2px; width: 5px;",
			"  cursor: col-resize; z-index: 6;",
			"}",
			".cs-insp-grip:hover { background: " + tint(T.brand, 30) + "; }",
			"@media (prefers-reduced-motion: reduce) {",
			"  .cs-insp:not(.cs-insp-drag) { transition: none; }",
			"}",
			".cs-insp-head { flex: none; padding: 12px 14px 0 14px; }",
			".cs-insp-titlerow {",
			"  display: flex; align-items: flex-start; gap: 8px; min-height: 32px;",
			"}",
			".cs-insp-title {",
			"  display: flex; align-items: center; gap: 8px;",
			"  font-size: 14px; font-weight: 600; line-height: 1.4;",
			"}",
			".cs-insp-title-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".cs-insp-title-input {",
			"  flex: 1; min-width: 0; box-sizing: border-box;",
			"  font-family: " + FONT + "; font-size: 14px; font-weight: 600; line-height: 1.4;",
			"  padding: 2px 6px; margin: -2px 0; border-radius: 6px;",
			"  border: 1px solid " + T.border2 + "; background: " + T.base + "; color: " + T.label + ";",
			"}",
			".cs-insp-title-input:focus { outline: none; border-color: " + T.brand + "; }",
			".cs-insp-sub { font-size: 11px; margin-top: 3px; color: " + T.label2 + "; }",
			// The shipped Button's own variant covers the box model (border,
			// padding, radius, hover); this only adds the one thing no variant
			// expresses — a danger tint for "打回重做", since Button ships
			// primary/ghost/outline/toolbar and nothing red.
			".cs-btn-no { border-color: " + tint(T.err, 55) + " !important; color: " + T.err + " !important; }",

			".cs-insp-tabs {",
			"  flex: none; display: flex; gap: 14px; padding: 10px 14px 0 14px;",
			"  border-bottom: 1px solid " + T.border1 + ";",
			"}",
			".cs-insp-tab {",
			"  font-family: " + FONT + "; font-size: 12px; cursor: pointer;",
			"  padding: 4px 0 8px 0; color: " + T.label2 + ";",
			"  background: transparent; border: none; border-bottom: 2px solid transparent;",
			"}",
			".cs-insp-tab-on { color: " + T.label + "; border-bottom-color: " + T.brand + "; }",
			".cs-insp-body {",
			"  flex: 1; min-height: 0; overflow-y: auto;",
			"  padding: 12px 14px; font-size: 12px; line-height: 1.75;",
			"}",
			".cs-sect { margin-bottom: 14px; }",
			".cs-sect-t { font-size: 11px; margin-bottom: 6px; color: " + T.label2 + "; }",
			".cs-sect-head {",
			"  display: flex; align-items: center; justify-content: space-between;",
			"  gap: 8px; margin-bottom: 6px;",
			"}",
			".cs-sect-head .cs-sect-t { margin-bottom: 0; }",
			".cs-card {",
			"  padding: 9px 11px; border-radius: 8px;",
			"  border: 1px solid " + T.border1 + ";",
			"}",
			".cs-card + .cs-card { margin-top: 6px; }",
			".cs-cardrow { display: flex; align-items: center; gap: 8px; }",
			".cs-cardrow-file { justify-content: space-between; }",
			".cs-file-acts { flex: none; display: flex; align-items: center; gap: 6px; margin-left: auto; }",
			".cs-file-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
			".cs-file-in { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }",
			".cs-kind {",
			"  flex: none; font-size: 10px; padding: 1px 6px; border-radius: 999px;",
			"  color: " + T.label2 + "; border: 1px solid " + T.border1 + ";",
			"}",
			".cs-kv { color: " + T.label2 + "; }",
			".cs-note {",
			"  margin-top: 10px; padding: 8px 10px; border-radius: 6px; font-size: 11px;",
			"  background: " + tint(T.brand, 7) + "; color: " + T.label2 + "; line-height: 1.65;",
			"}",
			".cs-ta {",
			"  width: 100%; box-sizing: border-box; margin-top: 8px;",
			"  font-family: " + FONT + "; font-size: 12px;",
			"  padding: 8px; border-radius: 6px; resize: none; min-height: 72px;",
			"  background: " + T.base + "; color: " + T.label + ";",
			"  border: 1px solid " + T.border2 + ";",
			"}",
			".cs-ta-body { margin-top: 0; min-height: 96px; }",
			".cs-lock { margin-top: 6px; font-size: 10.5px; color: " + T.label2 + "; }",
			".cs-stamp {",
			"  position: relative;",
			"  min-height: 72px;",
			"  padding: 10px 12px 28px 12px;",
			"  border-radius: 8px;",
			"  border: 1px solid " + T.border1 + ";",
			"  font-size: 12px; line-height: 1.75;",
			"  white-space: pre-wrap; word-break: break-word;",
			"}",
			".cs-stamp-who {",
			"  position: absolute; right: 10px; bottom: 8px;",
			"  font-size: 11px; color: " + T.label2 + ";",
			"}",
			".cs-insp-verdict {",
			"  flex: none; padding: 10px 14px 12px 14px;",
			"  border-top: 1px solid " + T.border1 + ";",
			"  background: " + T.base + ";",
			"}",
			".cs-send { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; width: 100%; }",
			".cs-send-sel {",
			"  flex: 1; min-width: 148px; height: 32px; padding: 0 8px; border-radius: 6px;",
			"  border: 1px solid " + T.border2 + "; background: " + T.base + ";",
			"  color: " + T.label + "; font-family: " + FONT + ";",
			"}",
			".cs-insp-foot {",
			"  flex: none; padding: 9px 14px; font-size: 11px; color: " + T.label2 + ";",
			"  border-top: 1px solid " + T.border1 + ";",
			"  display: flex; align-items: center; gap: 8px;",
			"}",
			".cs-log-row { cursor: pointer; }",
			".cs-log-row:hover { border-color: " + T.brand + "; }",
			".cs-sess-bar {",
			"  flex: none; display: flex; gap: 6px; flex-wrap: wrap;",
			"  padding: 0 10px 8px 10px;",
			"}",
			".cs-header-chip {",
			"  font-family: " + FONT + ";",
			"  display: inline-flex; align-items: center; gap: 4px;",
			"  height: 22px; max-width: 180px; padding: 0 8px;",
			"  border: none; border-radius: 6px; cursor: pointer;",
			"  background: var(--dsw-alias-fill-tsp-secondary);",
			"  color: var(--dsw-alias-label-secondary);",
			"  font-size: 12px; line-height: 22px;",
			"  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;",
			"}",
			".cs-header-chip:hover { color: var(--dsw-alias-label-primary); }",
			".cs-header-chip:disabled { cursor: default; opacity: 0.55; }",
			".cs-sub-quota {",
			"  margin: 0 0 8px 0; padding: 8px 12px; border-radius: 12px;",
			"  background: var(--dsw-alias-settings-card-fill, var(--dsw-alias-fill-tsp-secondary));",
			"  color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px;",
			"}",
			".cs-model-card {",
			"  display: flex; align-items: center; gap: 8px;",
			"  margin: 0 0 8px 0; padding: 12px 14px; border-radius: 12px;",
			"  border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3));",
			"  background: var(--dsw-alias-settings-card-fill, transparent);",
			"}",
			".cs-model-dot {",
			"  width: 8px; height: 8px; border-radius: 50%; flex: none;",
			"  background: var(--dsw-alias-state-success-primary, #12b76a);",
			"}",
			".cs-model-dot-off {",
			"  width: 8px; height: 8px; border-radius: 50%; flex: none;",
			"  background: var(--dsw-alias-state-error-primary, #e5484d);",
			"}",
			".cs-model-name { font-size: 14px; font-weight: 500; }",
			".cs-model-note { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }",
			".cs-proxy-kicker { margin: 14px 0 8px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }",
			".cs-proxy-card { margin: 0 0 8px; border-radius: 12px; border: 0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3)); overflow: hidden; }",
			".cs-proxy-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 12px 14px; border: none; background: transparent; cursor: pointer; text-align: left; font: inherit; color: inherit; }",
			".cs-proxy-body { padding: 0 14px 12px; }",
			".cs-proxy-modes, .cs-proxy-panel { display: flex; flex-wrap: wrap; gap: 8px; }",
			".cs-proxy-modes button, .cs-proxy-panel button { height: 28px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3, #ddd); background: transparent; cursor: pointer; font: inherit; }",
			".cs-proxy-modes button.is-on, .cs-proxy-panel button.is-on { border-color: var(--dsw-alias-label-primary, #111); }",
			".cs-cat { display: flex; flex-direction: column; gap: 8px; width: 100%; }",
			".cs-cat-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
			".cs-cat input[type=text], .cs-cat input[type=password] { height: 32px; min-width: 220px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3, #ddd); padding: 0 8px; font: inherit; background: #fff; color: #111; }",
			".cs-apply { height: 36px; margin-top: 8px; padding: 0 14px; border: 0; border-radius: 8px; background: #111; color: #fff; cursor: pointer; font: inherit; }"
		].join("\n") + "\n" + LOOK_CSS + "\n" + CARD_CSS;

		function Style() {
			React.useEffect(function () {
				closeDetailsQuiet();
				const blocked = {
					"添加工作区": 1,
					"添加工作区…": 1,
					"删除工作区": 1,
					"Add workspace": 1,
					"Add workspace…": 1,
					"Delete workspace": 1
				};
				function labelOf(el) {
					return (el.getAttribute("aria-label") || el.textContent || "")
						.replace(/\s+/g, " ").trim();
				}
				function settingsNavKeep() {
					const keep = { "通用设置": 1, "General": 1 };
					keep["账号"] = 1;
					keep["Account"] = 1;
					keep["同事"] = 1;
					keep["Team"] = 1;
					if (canManagePeople()) {
						keep["人员"] = 1;
						keep["People"] = 1;
						keep["Agent 预设"] = 1;
						keep["Agent presets"] = 1;
					}
					if (shellRole === "admin") {
						keep["快速推理"] = 1;
						keep["Fast"] = 1;
						keep["Subscriptions"] = 1;
						keep["模型"] = 1;
						keep["订阅"] = 1;
						keep["内核"] = 1;
						keep["版本"] = 1;
					}
					return keep;
				}
				function rowOf(el) {
					let cur = el;
					const t = (el.textContent || "").replace(/\s+/g, " ").trim();
					while (cur.parentElement) {
						const pt = (cur.parentElement.textContent || "").replace(/\s+/g, " ").trim();
						if (pt.length > t.length + 48) return cur;
						cur = cur.parentElement;
					}
					return el;
				}
				function hideOfficialImageDrop() {
					if (typeof document === "undefined" || !document.querySelectorAll) return;
					const masks = document.querySelectorAll(".BInVoG_mask");
					for (let i = 0; i < masks.length; i++) {
						masks[i].style.setProperty("display", "none", "important");
					}
				}
				function hideWorkspaceAdd() {
					if (typeof document === "undefined") return;
					hideOfficialImageDrop();
					const buttons = document.querySelectorAll(
						"button[aria-label=\"添加工作区\"], button[aria-label=\"Add workspace\"], " +
						".nL4_yW_sessionLogButton"
					);
					for (let i = 0; i < buttons.length; i++) {
						buttons[i].style.setProperty("display", "none", "important");
					}
					const all = document.querySelectorAll("button");
					for (let i = 0; i < all.length; i++) {
						const lab = (all[i].textContent || "").replace(/\s+/g, " ").trim();
						if (lab === "Session log") {
							all[i].style.setProperty("display", "none", "important");
						}
					}
					for (let i = 0; i < buttons.length; i++) {
						buttons[i].style.setProperty("display", "none", "important");
					}
				}
				// Voice input is switched off for this desk: turning it on broke the
				// Windows desk's page (2026-10-04). Its card is not offered at all.
				function hideVoiceInput() {
					if (typeof document === "undefined") return;
					const marks = document.querySelectorAll('button[aria-label="启用 语音输入"], button[aria-label="停用 语音输入"], button[aria-label="Enable Voice input"], button[aria-label="Disable Voice input"]');
					for (let i = 0; i < marks.length; i++) {
						const card = marks[i].closest("li");
						if (card) card.style.setProperty("display", "none", "important");
					}
					const titles = document.querySelectorAll('[class*="_cardTitle"]');
					for (let i = 0; i < titles.length; i++) {
						const t = (titles[i].textContent || "").trim();
						if (t !== "语音输入" && t !== "Voice input") continue;
						const card = titles[i].closest("li");
						if (card) card.style.setProperty("display", "none", "important");
					}
				}
				function hideBetaNotice() {
					if (typeof document === "undefined") return;
					const dialogs = document.querySelectorAll("[role=\"dialog\"]");
					for (let i = 0; i < dialogs.length; i++) {
						const text = (dialogs[i].textContent || "").replace(/\s+/g, " ");
						if (text.indexOf("内测声明") < 0) continue;
						dialogs[i].style.setProperty("display", "none", "important");
					}
				}
				function hideSettingsChrome() {
					if (typeof document === "undefined") return;
					try { document.documentElement.setAttribute("data-company-desk-role", shellRole); } catch (err) {}
					const cells = document.querySelectorAll(".VOzbGW_navCell, .VOzbGW_navList button");
					for (let i = 0; i < cells.length; i++) {
						const span = cells[i].querySelector(".VOzbGW_navLabel") || cells[i];
						const lab = (span.textContent || "").replace(/\s+/g, " ").trim();
						if (!lab) continue;
						const glyph = NAV_GLYPH[lab];
						if (glyph && cells[i].getAttribute("data-cs-nav") !== glyph) cells[i].setAttribute("data-cs-nav", glyph);
						if (settingsNavKeep()[lab]) cells[i].style.setProperty("display", "flex", "important");
						else cells[i].style.setProperty("display", "none", "important");
					}
					const actions = document.querySelectorAll("[data-slot=\"settings.action\"], .VOzbGW_actions button");
					for (let i = 0; i < actions.length; i++) {
						const lab = labelOf(actions[i]);
						if (!lab || lab === "打开配置文件" || lab.indexOf("Open configuration") !== -1) {
							const wrap = actions[i].closest(".VOzbGW_actions") || actions[i];
							wrap.style.display = "none";
						}
					}
					const dialogs = document.querySelectorAll("[role=\"dialog\"]");
					for (let i = 0; i < dialogs.length; i++) {
						const walk = document.createTreeWalker(dialogs[i], NodeFilter.SHOW_TEXT);
						let n;
						while ((n = walk.nextNode())) {
							const v = (n.nodeValue || "").replace(/\s+/g, " ").trim();
							if (!v) continue;
							if (v.indexOf("Catppuccin") === -1 && v.indexOf("检查 Catppuccin") === -1) continue;
							const row = rowOf(n.parentElement);
							if (row && row !== dialogs[i]) row.style.display = "none";
						}
					}
					const effortBtns = document.querySelectorAll("._7KE1Ra_option, [role=\"menuitemradio\"]");
					for (let i = 0; i < effortBtns.length; i++) {
						const nameEl = effortBtns[i].querySelector("._7KE1Ra_modelName");
						const lab = ((nameEl && nameEl.textContent) || effortBtns[i].textContent || "").replace(/\s+/g, " ").trim();
						if (lab === "Off" || lab === "off" || lab === "关闭" ||
							lab === "Default" || lab === "default" || lab === "默认" ||
							lab.indexOf("Default") === 0 || lab.indexOf("默认") === 0) {
							effortBtns[i].style.setProperty("display", "none", "important");
						}
					}
				}
				function swapAccessLabel(root) {
					if (!root || !root.querySelectorAll) return;
					if (root.nodeType === 1 || root === document.body) {
						const labeled = (root.querySelectorAll ? root.querySelectorAll("[aria-label]") : []);
						const list = labeled.length !== undefined ? labeled : [];
						for (let i = 0; i < list.length; i++) {
							const a = list[i].getAttribute("aria-label") || "";
							if (a.indexOf("Workspace Write") !== -1) {
								list[i].setAttribute("aria-label", a.replace(/Workspace Write/g, "Full Access"));
							}
						}
						if (root.getAttribute && (root.getAttribute("aria-label") || "").indexOf("Workspace Write") !== -1) {
							root.setAttribute("aria-label", root.getAttribute("aria-label").replace(/Workspace Write/g, "Full Access"));
						}
					}
					if (!root.querySelectorAll && root.nodeType !== 1) return;
					const walk = document.createTreeWalker(root.nodeType === 1 || root === document.body ? root : document.body, NodeFilter.SHOW_TEXT);
					let n;
					while ((n = walk.nextNode())) {
						const v = n.nodeValue;
						if (!v || v.indexOf("Workspace Write") === -1) continue;
						n.nodeValue = v.replace(/Workspace Write/g, "Full Access");
					}
				}
				function paintWorkspaceTitles() {
					if (typeof document === "undefined") return;
					const snap = workspaceListFn() || {};
					const items = snap.items || snap.workspaces || [];
					const byBase = {};
					let hasPersonal = false;
					let hasOrg = false;
					for (let i = 0; i < items.length; i++) {
						const it = items[i] || {};
						const p = String(it.path || "").replace(/\\/g, "/");
						const parts = p.split("/").filter(Boolean);
						const base = (parts[parts.length - 1] || "").toLowerCase();
						const title = String(it.title || it.name || "");
						if (base) byBase[base] = title;
						if (title === "个人") hasPersonal = true;
						if (title === "团队" || title === "公司") hasOrg = true;
					}
					const fallback = {
						company: "团队",
						_office: "个人",
						content: "团队",
						ops: "团队",
						visual: "团队",
						wms: "团队",
						live: "团队",
						director: "个人",
						"emp-a": "个人",
						"emp-emp-a": "个人"
					};
					const rows = document.querySelectorAll(".YDXeBa_projectRow");
					for (let i = 0; i < rows.length; i++) {
						const row = rows[i];
						// The row's own title, not "the first word of everything inside
						// it". On hover 0.2.x adds controls to the row; read as one
						// string, their text became the first word, the row no longer
						// looked like 个人 / 团队, and the rule below hid it. It came back
						// when the pointer left, so it flickered under the pointer.
						let first = "";
						const scan = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
						let node;
						while ((node = scan.nextNode())) {
							const holder = node.parentElement;
							if (holder && holder.closest('button, [role="tooltip"], [role="button"]') && holder.closest('button, [role="tooltip"], [role="button"]') !== row) continue;
							const word = (node.nodeValue || "").replace(/\s+/g, " ").trim().split(" ")[0] || "";
							if (word) { first = word; break; }
						}
						if (!first) continue;
						if (first === "未分组" || first === "Ungrouped") continue;
						let want = first === "个人" || first === "团队" || first === "公司" ? (first === "公司" ? "团队" : first) : (byBase[first.toLowerCase()] || fallback[first.toLowerCase()]);
						if (want === "company" || want === "公司") want = "团队";
						if (want === "_office") want = "个人";
						if (hasPersonal && hasOrg && want !== "个人" && want !== "团队" && first !== "个人" && first !== "团队" && first !== "公司") {
							row.style.setProperty("display", "none", "important");
							continue;
						}
						row.style.removeProperty("display");
						if (want && first !== want) {
							const walk = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
							let n;
							while ((n = walk.nextNode())) {
								if (!n.nodeValue || n.nodeValue.indexOf(first) === -1) continue;
								const parent = n.parentElement;
								if (parent && parent.closest("button")) continue;
								n.nodeValue = n.nodeValue.replace(first, want);
								break;
							}
						}
					}
				}
				function dockRightToggle() {
					const root = document.documentElement;
					const panel = document.querySelector("[data-dsh-panel]");
					if (!panel || String(panel.className || "").indexOf("panelHidden") >= 0) {
						root.removeAttribute("data-company-rightbar-open");
						root.removeAttribute("data-company-rightbar-drag");
						return;
					}
					const inline = panel.style && panel.style.width ? panel.style.width : "";
					if (inline.indexOf("vw") >= 0) {
						root.removeAttribute("data-company-rightbar-open");
						root.removeAttribute("data-company-rightbar-drag");
						return;
					}
					const host = panel.parentElement;
					const hostRight = host && host.getBoundingClientRect ? host.getBoundingClientRect().right : window.innerWidth;
					let seam = parseFloat(inline);
					if (!(seam > 0)) {
						const rect = panel.getBoundingClientRect();
						seam = hostRight - rect.left;
					}
					if (!(seam > 48)) {
						root.removeAttribute("data-company-rightbar-open");
						root.removeAttribute("data-company-rightbar-drag");
						return;
					}
					root.style.setProperty("--company-rightbar-width", Math.round(seam) + "px");
					root.setAttribute("data-company-rightbar-open", "1");
					if (panel.getAttribute("data-dragging") != null) root.setAttribute("data-company-rightbar-drag", "1");
					else root.removeAttribute("data-company-rightbar-drag");
				}
				function sweep(root) {
					hideSettingsChrome();
					hideVoiceInput();
					hideWorkspaceAdd();
					hideBetaNotice();
					paintWorkspaceTitles();
					dockRightToggle();
					if (!root || !root.querySelectorAll) return;
					swapAccessLabel(root);
					const items = root.querySelectorAll('[role="menuitem"]');
					let workspaceMenu = false;
					for (let i = 0; i < items.length; i++) {
						const lab = labelOf(items[i]);
						if (blocked[lab]) {
							items[i].style.display = "none";
							workspaceMenu = true;
						}
					}
					if (workspaceMenu) {
						for (let i = 0; i < items.length; i++) {
							const lab = labelOf(items[i]);
							if (lab === "重命名" || lab === "Rename") {
								items[i].style.display = "none";
							}
						}
					}
					const dialogs = root.querySelectorAll("[role=\"dialog\"]");
					for (let i = 0; i < dialogs.length; i++) {
						const text = (dialogs[i].textContent || "").replace(/\s+/g, " ");
						if (text.indexOf("Full access") !== -1 && (text.indexOf("确认启用") !== -1 || text.indexOf("Enable Full access") !== -1)) {
							dialogs[i].style.display = "none";
						}
					}
					const rows = root.querySelectorAll(".YDXeBa_projectRow");
					for (let i = 0; i < rows.length; i++) {
						const text = (rows[i].textContent || "").replace(/\s+/g, " ").trim();
						if (text === "未分组" || text === "Ungrouped" || text.indexOf("未分组") === 0) {
							const sect = rows[i].closest(".qDHVXG_groupSection") || rows[i].parentElement;
							if (sect) sect.style.display = "none";
						}
					}
				}
				try {
					document.documentElement.setAttribute("data-company-shell", "1");
					document.documentElement.setAttribute("lang", "zh-CN");
					document.documentElement.setAttribute("translate", "no");
					document.documentElement.classList.add("notranslate");
				} catch (err) {}
				// company-skip-onboarding-v1. The kernel's first-run steps (preview
				// notice, add-a-key prompt) live inside the models settings plugin and
				// cannot be switched off without losing that page, and a hidden step
				// that never completes freezes the composer. So answer each step with
				// its own dismiss button, once per dialog node.
				const answered = new WeakSet();
				function skipOnboarding() {
					const dialogs = document.querySelectorAll('[role="dialog"]');
					for (let i = 0; i < dialogs.length; i++) {
						const dialog = dialogs[i];
						if (answered.has(dialog)) continue;
						const head = dialog.querySelector('h1, h2, h3, [role="heading"]');
						const title = head ? String(head.textContent || "").trim() : "";
						let want = null;
						if (title === "预览版说明" || /^Preview/i.test(title)) want = /^(继续|Continue)$/;
						else if (title.indexOf("添加一个 API Key") === 0 || /^Add an API key/i.test(title)) want = /^(稍后配置|Later|Set up later|Skip)$/i;
						if (!want) continue;
						const buttons = dialog.querySelectorAll("button");
						for (let j = 0; j < buttons.length; j++) {
							if (!want.test(String(buttons[j].textContent || "").trim())) continue;
							answered.add(dialog);
							buttons[j].click();
							break;
						}
					}
				}
				sweep(document.body);
				skipOnboarding();
				const mo = new MutationObserver(function (recs) {
					hideSettingsChrome();
					hideWorkspaceAdd();
					skipOnboarding();
					for (let i = 0; i < recs.length; i++) sweep(recs[i].target);
				});
				mo.observe(document.body, { childList: true, subtree: true });
				// The right-sidebar toggle needs the panel's class and width, and only
				// those. Watching class/style on the whole page ran the full sweep on
				// every hover and every style this file itself sets.
				let watched = null;
				const panelMo = new MutationObserver(function () { dockRightToggle(); });
				const watchPanel = function () {
					const panel = document.querySelector("[data-dsh-panel]");
					if (panel === watched) return;
					panelMo.disconnect();
					watched = panel;
					if (panel) panelMo.observe(panel, { attributes: true, attributeFilter: ["class", "style", "data-dragging"] });
				};
				watchPanel();
				const panelFinder = new MutationObserver(watchPanel);
				panelFinder.observe(document.body, { childList: true, subtree: true });
				return function () { mo.disconnect(); panelMo.disconnect(); panelFinder.disconnect(); };
			}, []);
			return React.createElement("style", null, CSS);
		}

		// ------------------------------------------------------------------
		// Docking the third column so it squeezes the conversation instead of
		// floating on top of it.
		//
		// rc.8's layout face has no API to reserve horizontal room. Width lives
		// on <html> as --company-inspector-width; CSS indents the conversation
		// root ([data-phase] wrapping [data-conversation-scroll]). A CSS rule
		// survives startSession replacing the node; inline padding on the old
		// wrap would not. Hashed class names are not the selector.
		//
		// Nothing in this layer is remembered across reloads. A UI row may not
		// persist state, so width and selection die with the tab; remembering
		// them is a host service's job.
		// ------------------------------------------------------------------
		const INSPECTOR_MIN = 320;
		const INSPECTOR_MAX = 800;
		const INSPECTOR_DEFAULT = 560;

		let inspectorWidth = INSPECTOR_DEFAULT;
		function clampWidth(px) {
			return Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, Math.round(px)));
		}

		function conversationWrap() {
			if (typeof document === "undefined") return null;
			const port = document.querySelector("[data-conversation-scroll]");
			const wrap = port ? port.parentElement : null;
			return wrap instanceof HTMLElement ? wrap : null;
		}
		const TASK_PLACEHOLDER = "写下任务内容";

		function syncTaskComposer(on) {
			if (typeof document === "undefined") return;
			if (on) document.documentElement.setAttribute("data-company-task-open", "1");
			else document.documentElement.removeAttribute("data-company-task-open");
			const seat = document.querySelector("[data-composer-seat]");
			const areas = seat ? seat.querySelectorAll("textarea") : [];
			for (let i = 0; i < areas.length; i++) {
				const el = areas[i];
				if (on) {
					if (el.getAttribute("placeholder") !== TASK_PLACEHOLDER) {
						if (el.dataset.csPh == null) el.dataset.csPh = el.getAttribute("placeholder") || "";
						el.setAttribute("placeholder", TASK_PLACEHOLDER);
					}
					if (el.disabled) {
						el.dataset.csDis = "1";
						el.disabled = false;
					}
				} else {
					if (el.dataset.csPh != null) {
						el.setAttribute("placeholder", el.dataset.csPh);
						delete el.dataset.csPh;
					}
					if (el.dataset.csDis) {
						el.disabled = true;
						delete el.dataset.csDis;
					}
				}
			}
		}
		function sessionHeaderEl() {
			if (typeof document === "undefined") return null;
			const port = document.querySelector("[data-conversation-scroll]");
			const prev = port ? port.previousElementSibling : null;
			return prev instanceof HTMLElement ? prev : null;
		}

		function undock() {
			if (typeof document === "undefined") return;
			document.documentElement.style.removeProperty("--company-inspector-width");
			document.documentElement.removeAttribute("data-company-task-dragging");
		}

		// animate=false while dragging: the column has to track the pointer
		// exactly, and easing every pointermove reads as lag, not smoothness.
		function dockAt(px, animate) {
			if (typeof document === "undefined") return null;
			if (px <= 0) {
				undock();
				return conversationWrap();
			}
			const root = document.documentElement;
			root.style.setProperty("--company-inspector-width", px + "px");
			if (animate) root.removeAttribute("data-company-task-dragging");
			else root.setAttribute("data-company-task-dragging", "1");
			return conversationWrap();
		}

		// Which task the third column is showing. Module-level and in memory only:
		// the interface layer is not the data owner, so there is nothing to persist
		// here. Real selection state belongs to a host service once K3 exists.
		let selectedId = null;
		let pendingInjectTaskId = null;
		let closeDetailsFn = function () {};
		function closeDetailsQuiet() {
			try { closeDetailsFn(); } catch (err) {}
		}
		const watchers = new Set();
		function selectTask(id, opts) {
			selectedId = id;
			if (id) {
				closeDetailsQuiet();
				const task = findTask(id);
				if (task && task.unread) task.unread = false;
				if (opts && opts.revealSession) {
					openTaskSession(task);
				} else if (task && (taskOwnsSession(task, liveSession.id) || awaitingSessionForTaskId === id)) {
					pendingInjectTaskId = id;
				} else {
					pendingInjectTaskId = null;
				}
			} else {
				pendingInjectTaskId = null;
			}
			if (id === null) undock();
			pulse();
		}
		function pulse() {
			watchers.forEach(function (fn) { fn(); });
		}
		function useSelectedId() {
			const hook = React.useState(selectedId);
			const value = hook[0];
			const set = hook[1];
			React.useEffect(function () {
				const sync = function () { set(selectedId); };
				watchers.add(sync);
				sync();
				return function () { watchers.delete(sync); };
			}, []);
			return value;
		}
		function useShellPulse() {
			const hook = React.useState(0);
			const set = hook[1];
			React.useEffect(function () {
				const sync = function () { set(function (n) { return n + 1; }); };
				watchers.add(sync);
				return function () { watchers.delete(sync); };
			}, []);
			return hook[0];
		}

		let startSessionFn = function () {};
		let openSessionFn = function () {};
		let clearSessionFn = function () {};
		let sessionListFn = function () { return null; };
		let workspaceListFn = function () { return null; };
		let insertDeskTextFn = function () { return false; };
		// The session whose composer is on screen, as told by the composer's own
		// slot. 0.2.x dropped `current` from the session list, so this is the only
		// place that still knows which session a dropped file belongs to.
		let composerSessionId = "";
		let linked = { sessionId: null, taskId: null };
		let liveSession = { id: null, title: "" };
		let lastAssistantCache = "";
		let awaitingSessionForTaskId = null;
		let awaitingFromSessionId = null;
		let sidebarTabWant = null;
		let shellRole = "employee";
		let mailboxLogin = "";
		let mailboxLive = false;
		let mailboxErr = "";
		let floorRows = [];
		let spendSnap = { days: 7, by_person: [], by_model: [], total_yuan: 0 };
		// Departments come from the people service: [{ id, name }]. The id is
		// what a person row stores; the name is what people read.
		let DEPTS = [];
		function replaceDepts(rows) {
			if (!Array.isArray(rows)) return;
			DEPTS = rows.filter(function (d) { return d && d.id; });
			pulse();
		}
		function deptName(id) {
			const hit = DEPTS.find(function (d) { return d.id === id; });
			return hit ? hit.name : (id || "—");
		}
		function personOf(login) {
			return PEOPLE.find(function (p) { return p && p.login === login; }) || null;
		}
		function displayName(p) {
			return (p && (p.name || p.login)) || "";
		}
		const SHELL_ROLE_PIN = ""; // @@DESK_ROLE_PIN
		function readDeskRole() {
			try {
				if (SHELL_ROLE_PIN === "admin" || SHELL_ROLE_PIN === "director" || SHELL_ROLE_PIN === "employee") {
					return SHELL_ROLE_PIN;
				}
			} catch (err) {}
			return "employee";
		}
		function applyLoginRole(role, login) {
			if (role === "admin" || role === "director" || role === "employee") {
				shellRole = role;
			}
			if (login) mailboxLogin = String(login);
			pulse();
		}
		function fetchLoginRole() {
			return fetch("/company/me", {
				credentials: "same-origin",
				headers: { "Accept": "application/json" }
			}).then(function (res) {
				return res.json().then(function (j) {
					if (res.ok && j && j.ok) applyLoginRole(j.role, j.login);
					return j;
				}, function () { return null; });
			}, function () { return null; });
		}
		function canIssueVerdict() {
			return shellRole === "director" || shellRole === "admin";
		}
		// company-ticket-review-v1: 待审批 shows 上交人 + 批准/打回; board files/sessions win
		// company-ticket-upload-v1: 添加文件立刻 upload；提交验收 harvest 椅子上同名产物
		// company-ticket-thumb-v1: 缩略图走 POST action=file，不靠 GET img src
		function isSubmittedState(state) {
			return state === "待审批" || state === "待批示" || state === "已通过" || state === "未通过";
		}
		function taskSubmitter(task) {
			if (!task) return "";
			return String(task.submitted_by || task.to || "").trim();
		}
		function isSubmitter(task) {
			const me = deskLogin();
			const who = taskSubmitter(task);
			return !!(me && who && me === who);
		}
		function canReviewTask(task) {
			if (!task || !isAwaitingVerdict(task)) return false;
			if (isSubmitter(task) && !isIssuer(task)) return false;
			if (isSubmitter(task) && isIssuer(task) && shellRole === "employee") return false;
			if (shellRole === "admin") return true;
			if (shellRole === "director") return true;
			return isIssuer(task) && taskSubmitter(task) && taskSubmitter(task) !== deskLogin();
		}
		function canManagePeople() {
			return shellRole === "admin" || shellRole === "director";
		}
		function livePeople() {
			return PEOPLE.filter(function (p) {
				return p && p.login && p.status === "active";
			});
		}
		function peopleRoleText(role) {
			if (role === "admin") return "管理员";
			if (role === "director") return "总监";
			return "员工";
		}
		function peopleStatusText(st) {
			return st === "disabled" ? "已停用" : "在职";
		}
		function replacePeople(rows) {
			if (!Array.isArray(rows)) return;
			PEOPLE.splice(0, PEOPLE.length);
			for (let i = 0; i < rows.length; i++) PEOPLE.push(rows[i]);
			pulse();
		}
		function normalizeTask(row) {
			if (!row || !row.id) return null;
			const t = Object.assign({}, row);
			if (!Array.isArray(t.files)) t.files = [];
			if (!Array.isArray(t.sessions)) t.sessions = [];
			if (!Array.isArray(t.sessionIds)) {
				t.sessionIds = t.sessions.map(function (s) { return s && s.id; }).filter(Boolean);
			}
			if (t.assignment == null) t.assignment = "";
			if (t.summary == null) t.summary = "";
			if (!t.project || !t.project.id) t.project = { id: "inbox", title: (t.project && t.project.title) || "无标题" };
			t.archive_locked = !!t.archive_locked;
			return t;
		}
		function replaceTasks(rows) {
			if (!Array.isArray(rows)) return;
			const prevById = {};
			for (let i = 0; i < TASKS.length; i++) prevById[TASKS[i].id] = TASKS[i];
			const next = [];
			const seen = {};
			for (let i = 0; i < rows.length; i++) {
				const incoming = normalizeTask(rows[i]);
				if (!incoming) continue;
				const old = prevById[incoming.id];
				if (old) {
					mergeSessionBind(incoming, old);
					mergeFileBind(incoming, old);
					if (isDraft(incoming)) {
						if (assignmentDrafts[incoming.id] != null) incoming.assignment = assignmentDrafts[incoming.id];
						if (titleDrafts[incoming.id] != null) incoming.title = titleDrafts[incoming.id];
						if (contentDrafts[incoming.id] != null) incoming.summary = contentDrafts[incoming.id];
					} else {
						delete contentDrafts[incoming.id];
					}
				} else {
					mergeSessionBind(incoming, null);
					mergeFileBind(incoming, null);
				}
				next.push(incoming);
				seen[incoming.id] = true;
			}
			// Mailbox poll must not erase a card the employee is looking at, or a
			// local draft whose issue() has not come back yet. That was the 闪退:
			// selectedId pointed at a row replaceTasks just spliced out.
			for (let i = 0; i < TASKS.length; i++) {
				const t = TASKS[i];
				if (!t || seen[t.id]) continue;
				const local = /^t\d{10,}$/.test(String(t.id));
				if (local) {
					let twin = false;
					for (let j = 0; j < next.length; j++) {
						const n = next[j];
						if (!n || String(n.id).indexOf("tk-") !== 0) continue;
						if (n.title === t.title && n.state === t.state) {
							twin = true;
							mergeSessionBind(n, t);
							mergeFileBind(n, t);
							if (selectedId === t.id) selectedId = n.id;
							break;
						}
					}
					if (twin) continue;
				}
				if (local || t.id === selectedId) {
					next.unshift(t);
					seen[t.id] = true;
				}
			}
			TASKS.splice(0, TASKS.length);
			for (let i = 0; i < next.length; i++) TASKS.push(next[i]);
			pulse();
		}
		function adoptIssuedDraft(ticketId, dest, title) {
			if (!ticketId) return;
			let hit = null;
			if (selectedId && /^t\d{10,}$/.test(String(selectedId))) {
				hit = findTask(selectedId);
			}
			if (!hit) {
				for (let i = 0; i < TASKS.length; i++) {
					const t = TASKS[i];
					if (!t || !/^t\d{10,}$/.test(String(t.id))) continue;
					if (title && t.title !== title) continue;
					hit = t;
					break;
				}
			}
			if (!hit) return;
			const oldId = hit.id;
			hit.id = ticketId;
			if (mailboxLogin) hit.from = mailboxLogin;
			if (dest) hit.to = dest;
			if (assignmentDrafts[oldId] != null) {
				assignmentDrafts[ticketId] = assignmentDrafts[oldId];
				delete assignmentDrafts[oldId];
			}
			if (titleDrafts[oldId] != null) {
				titleDrafts[ticketId] = titleDrafts[oldId];
				delete titleDrafts[oldId];
			}
			if (contentDrafts[oldId] != null) {
				contentDrafts[ticketId] = contentDrafts[oldId];
				delete contentDrafts[oldId];
			}
			if (selectedId === oldId) selectedId = ticketId;
			if (awaitingSessionForTaskId === oldId) awaitingSessionForTaskId = ticketId;
			if (pendingInjectTaskId === oldId) pendingInjectTaskId = ticketId;
			if (linked.taskId === oldId) linked.taskId = ticketId;
			if (sessionBindMemo[oldId]) {
				sessionBindMemo[ticketId] = sessionBindMemo[oldId];
				delete sessionBindMemo[oldId];
			}
			if (fileBindMemo[oldId]) {
				fileBindMemo[ticketId] = fileBindMemo[oldId];
				delete fileBindMemo[oldId];
			}
		}
		function persistTitle(task, title) {
			const next = String(title || "").trim();
			if (!task || !next) return;
			task.title = next;
			titleDrafts[task.id] = next;
			pulse();
			if (typeof fetch !== "function") return;
			if (String(task.id).indexOf("tk-") !== 0) return;
			mailboxApi({
				action: "rename",
				ticket: task.id,
				title: next
			}).catch(function (err) {
				mailboxErr = String(err && err.message || err);
				pulse();
			});
		}
		function persistArchive(task, archived) {
			if (typeof fetch !== "function") return;
			if (String(task.id).indexOf("tk-") !== 0) return;
			mailboxApi({
				action: "archive",
				ticket: task.id,
				archived: !!archived
			}).catch(function (err) {
				mailboxErr = String(err && err.message || err);
				pulse();
			});
		}
		function mailboxApi(body) {
			const opt = {
				credentials: "same-origin",
				headers: { "Accept": "application/json" }
			};
			if (body) {
				opt.method = "POST";
				opt.headers["Content-Type"] = "application/json";
				opt.body = JSON.stringify(body);
			}
			return fetch("/company/mailbox", opt).then(function (res) {
				return res.json().then(function (j) {
					if (!res.ok || !j || !j.ok) {
						mailboxLive = false;
						mailboxErr = (j && j.error) || ("http-" + res.status);
						throw new Error(mailboxErr);
					}
					mailboxLive = true;
					mailboxErr = "";
					if (j.login) mailboxLogin = String(j.login);
					if (j.role === "admin" || j.role === "director" || j.role === "employee") {
						shellRole = j.role;
					}
					if (j.ticket && body && body.action === "issue") {
						adoptIssuedDraft(j.ticket, body.to, body.title);
					}
					if (j.tickets) replaceTasks(j.tickets);
					if (j.people) replacePeople(j.people);
					if (j.depts) replaceDepts(j.depts);
					if (Array.isArray(j.floor)) floorRows = j.floor;
					if (j.spend && typeof j.spend === "object") spendSnap = j.spend;
					return j;
				}, function () {
					mailboxLive = false;
					mailboxErr = "http-" + res.status;
					throw new Error(mailboxErr);
				});
			});
		}
		function peopleErr(msg) {
			const s = String(msg || "");
			if (s.indexOf("protect-seed-admin") >= 0) return "种子管理员不能停用或降权";
			if (s.indexOf("login-bad") >= 0) return "登录名只能用小写字母、数字和 . _ -，2 到 32 位，不能用中文。中文请填在「显示名」里";
			if (s.indexOf("login-taken") >= 0) return "这个登录名已经有人用了";
			if (s.indexOf("dept-unknown") >= 0) return "没有这个部门，刷新一下再试";
			if (s.indexOf("dept-name-taken") >= 0) return "已经有同名部门";
			if (s.indexOf("dept-name-empty") >= 0) return "部门名不能为空";
			if (s.indexOf("dept-not-empty") >= 0) return "部门里还有人，先把人调到别的部门再删";
			if (s.indexOf("dept-last") >= 0) return "至少要留一个部门";
			if (s.indexOf("avatar-bad") >= 0) return "头像格式不对，换一张 PNG 或 JPG 试试";
			if (s.indexOf("no-such-person") >= 0) return "花名册里没有这个人";
			if (s.indexOf("role-bad") >= 0) return "角色不对";
			if (s.indexOf("password-bad") >= 0) return "密码里不能有换行";
			if (s.indexOf("action-unknown") >= 0) return "服务器还不认这个操作，需要更新人员服务";
			if (s.indexOf("password-too-short") >= 0) return "密码至少 8 位";
			if (s.indexOf("forbidden") >= 0) return "只有老板和管理能改人员";
			if (s.indexOf("role-forbidden") >= 0) return "这个角色只能老板设";
			if (s.indexOf("person-missing") >= 0) return "花名册里没有这个人";
			if (s.indexOf("role-unknown") >= 0) return "角色不对";
			if (s.indexOf("dept-shape") >= 0) return "部门名只用 ASCII";
			if (s.indexOf("set-empty") >= 0) return "部门和角色至少改一项";
			if (s.indexOf("AbortError") >= 0 || s.indexOf("The operation was aborted") >= 0) return "控制面超时，请再试一次";
			if (s.indexOf("Failed to fetch") >= 0 || s.indexOf("http-404") >= 0) return "控制面未接通";
			if (s.indexOf("http-") === 0) return "控制面失败（" + s + "）";
			if (s.indexOf("BLOCKED=") === 0) return s.slice(8);
			if (s && s !== "undefined") return s;
			return "控制面失败";
		}
		function peopleApi(body) {
			const opt = {
				credentials: "same-origin",
				headers: { "Accept": "application/json" }
			};
			if (body) {
				opt.method = "POST";
				opt.headers["Content-Type"] = "application/json";
				opt.body = JSON.stringify(body);
			}
			let timer = null;
			if (typeof AbortController !== "undefined") {
				const ctl = new AbortController();
				opt.signal = ctl.signal;
				timer = setTimeout(function () { ctl.abort(); }, 25000);
			}
			const done = function () {
				if (timer) clearTimeout(timer);
			};
			return fetch("/company/people", opt).then(function (res) {
				return res.json().then(function (j) {
					done();
					if (!res.ok || !j || !j.ok) {
						throw new Error((j && j.error) || ("http-" + res.status));
					}
					if (j.people) replacePeople(j.people);
					if (j.depts) replaceDepts(j.depts);
					return j;
				}, function () {
					done();
					throw new Error("http-" + res.status);
				});
			}, function (err) {
				done();
				throw err;
			});
		}
		function roleLabel(role) {
			if (role === "admin") return "老板";
			if (role === "director") return "总监";
			return "员工";
		}
		function personLabel(p) {
			if (!p) return "";
			return roleLabel(p.role) + " " + p.login;
		}
		function findPerson(login) {
			const rows = livePeople();
			for (let i = 0; i < rows.length; i++) {
				if (rows[i].login === login) return rows[i];
			}
			return null;
		}
		function deskSelf() {
			const rows = livePeople();
			if (mailboxLogin) {
				for (let i = 0; i < rows.length; i++) {
					if (rows[i].login === mailboxLogin) return rows[i];
				}
			}
			const want = shellRole === "admin" ? "admin" : shellRole === "director" ? "director" : "employee";
			for (let i = 0; i < rows.length; i++) {
				if (rows[i].role === want) return rows[i];
			}
			return rows[0] || null;
		}
		function sendTaskTo(task, person) {
			if (!task || !person) return;
			task.toLogin = person.login;
			task.toRole = person.role;
			task.toLabel = personLabel(person);
			const self = deskSelf();
			if (person.role === "employee") {
				mailboxApi({
					action: "issue",
					to: person.login,
					title: task.title,
					assignment: task.assignment || task.title
				}).then(function (j) {
					if (j && j.ticket) task.id = j.ticket;
					pulse();
				}).catch(function (err) {
					mailboxErr = String(err && err.message || err);
					pulse();
				});
				return;
			}
			if (self && person.login === self.login) {
				pulse();
				return;
			}
			if (person.role === "admin" || person.role === "director") {
				setTaskState(task, "待审批");
				return;
			}
			pulse();
		}
		const verdictDrafts = {};
		const contentDrafts = {};
		const assignmentDrafts = {};
		const titleDrafts = {};
		const sessionBindMemo = {};
		const fileBindMemo = {};
		let listArtifactsFn = null;
		const wrappedSubmit = typeof WeakSet === "function" ? new WeakSet() : null;

		function liveSessionTitle() {
			const header = sessionHeaderEl();
			if (!header) return "";
			let t = (header.textContent || "").replace(/\s+/g, " ").trim();
			if (!t) return "";
			const cuts = ["对话", "极简", "标准", "Session log", "轨迹", "仅提供"];
			for (let i = 0; i < cuts.length; i++) {
				const cut = t.indexOf(cuts[i]);
				if (cut > 0) t = t.slice(0, cut).trim();
			}
			return t.slice(0, 48);
		}

		function ensureSessions(task) {
			if (!task) return;
			if (!task.sessions) task.sessions = [];
			if (!task.sessionIds) {
				task.sessionIds = task.sessions.map(function (s) { return s.id; });
			}
			if (!Array.isArray(task.files)) task.files = [];
			if (task.assignment == null) task.assignment = "";
			if (task.summary == null) task.summary = "";
			if (task.logPointer === undefined) task.logPointer = null;
		}

		function rememberBind(task) {
			if (!task || !task.id) return;
			ensureSessions(task);
			sessionBindMemo[task.id] = {
				sessions: task.sessions.slice(),
				sessionIds: task.sessionIds.slice()
			};
		}

		function mergeSessionBind(task, extra) {
			if (!task) return;
			ensureSessions(task);
			const bags = isSubmittedState(task.state)
				? [task]
				: [task, extra, sessionBindMemo[task.id]];
			const byId = {};
			const order = [];
			for (let b = 0; b < bags.length; b++) {
				const bag = bags[b];
				if (!bag) continue;
				const rows = bag.sessions || [];
				const ids = bag.sessionIds || rows.map(function (s) { return s && s.id; });
				for (let i = 0; i < ids.length; i++) {
					const id = ids[i];
					if (!id || byId[id]) continue;
					let row = null;
					for (let j = 0; j < rows.length; j++) {
						if (rows[j] && rows[j].id === id) { row = rows[j]; break; }
					}
					byId[id] = row || { id: id, title: String(id).slice(0, 12), when: "" };
					order.push(id);
				}
			}
			task.sessionIds = order;
			task.sessions = order.map(function (id) { return byId[id]; });
			task.trace = sessionTrace(task);
			rememberBind(task);
		}

		function fileKey(file) {
			if (!file) return "";
			const rel = String(file.path || "").replace(/\\/g, "/");
			if (rel) return "p:" + rel;
			return "n:" + String(file.name || "");
		}

		function pointerFiles(list) {
			const out = [];
			const seen = {};
			const rows = list || [];
			for (let i = 0; i < rows.length; i++) {
				const f = rows[i];
				if (!f || f.blob) continue;
				const k = fileKey(f);
				if (!k || k === "n:" || seen[k]) continue;
				seen[k] = true;
				out.push({
					name: f.name || "",
					path: f.path || "",
					kind: f.kind || "",
					meta: f.meta || "",
					source: f.source || ""
				});
			}
			return out;
		}

		function rememberFiles(task) {
			if (!task || !task.id) return;
			ensureSessions(task);
			fileBindMemo[task.id] = pointerFiles(task.files);
		}

		function mergeFileBind(task, extra) {
			if (!task) return;
			ensureSessions(task);
			const submitted = isSubmittedState(task.state);
			const bags = submitted
				? [task.files]
				: [task.files, extra && extra.files, fileBindMemo[task.id]];
			const byKey = {};
			const order = [];
			for (let b = 0; b < bags.length; b++) {
				const rows = bags[b] || [];
				for (let i = 0; i < rows.length; i++) {
					const f = rows[i];
					if (!f) continue;
					if (submitted && f.blob && !f.path) continue;
					const k = fileKey(f) || ("i:" + b + ":" + i);
					if (byKey[k]) {
						if (f.blob && !byKey[k].blob) byKey[k] = f;
						continue;
					}
					byKey[k] = f;
					order.push(k);
				}
			}
			if (submitted && extra && extra.files) {
				for (let i = 0; i < extra.files.length; i++) {
					const f = extra.files[i];
					if (!f || f.blob || !f.path) continue;
					const k = fileKey(f);
					if (!k || byKey[k]) continue;
					byKey[k] = f;
					order.push(k);
				}
			}
			task.files = order.map(function (k) { return byKey[k]; });
			rememberFiles(task);
		}

		function persistSession(task, sid) {
			if (!task || typeof fetch !== "function") return;
			if (String(task.id).indexOf("tk-") !== 0) return;
			if (!isOfficialSessionId(sid)) return;
			let title = "";
			for (let i = 0; i < task.sessions.length; i++) {
				if (task.sessions[i] && task.sessions[i].id === sid) {
					title = task.sessions[i].title || "";
					break;
				}
			}
			mailboxApi({
				action: "bind-session",
				ticket: task.id,
				session: sid,
				title: title || task.title || sid
			}).catch(function () {});
		}

		function persistSessions(task) {
			if (!task) return;
			ensureSessions(task);
			for (let i = 0; i < task.sessionIds.length; i++) {
				persistSession(task, task.sessionIds[i]);
			}
		}

		function persistUnbind(task, sid) {
			if (!task || typeof fetch !== "function") return;
			if (String(task.id).indexOf("tk-") !== 0) return;
			if (!isOfficialSessionId(sid)) return;
			mailboxApi({
				action: "unbind-session",
				ticket: task.id,
				session: sid
			}).catch(function () {});
		}

		function persistFile(task, file) {
			if (!task || !file || file.blob) return;
			if (typeof fetch !== "function") return;
			if (String(task.id).indexOf("tk-") !== 0) return;
			const rel = String(file.path || "").replace(/\\/g, "/");
			if (!rel) return;
			mailboxApi({
				action: "attach-file",
				ticket: task.id,
				name: file.name || rel.split("/").pop(),
				path: rel,
				kind: file.kind || "文件",
				meta: file.meta || "产物 · 已挂"
			}).catch(function () {});
		}

		function persistFiles(task) {
			const rows = (task && task.files) || [];
			for (let i = 0; i < rows.length; i++) persistFile(task, rows[i]);
		}

		function persistDetach(task, file) {
			if (!task || !file || file.blob) return;
			if (typeof fetch !== "function") return;
			if (String(task.id).indexOf("tk-") !== 0) return;
			const rel = String(file.path || "").replace(/\\/g, "/");
			const name = String(file.name || "");
			if (!rel && !name) return;
			const body = { action: "detach-file", ticket: task.id };
			if (name) body.name = name;
			if (rel) body.path = rel;
			mailboxApi(body).catch(function () {});
		}

		function flattenArtifacts(reply) {
			let cur = reply;
			if (cur && cur.value !== undefined) cur = cur.value;
			if (cur && cur.ok === true && cur.value !== undefined) cur = cur.value;
			if (cur && Array.isArray(cur.artifacts)) return cur.artifacts;
			if (Array.isArray(cur)) return cur;
			return [];
		}

		function artifactBase(row) {
			if (!row) return "";
			if (row.title) return String(row.title);
			if (row.name) return String(row.name);
			const p = String(row.path || "").replace(/\\/g, "/");
			const slash = p.lastIndexOf("/");
			return slash >= 0 ? p.slice(slash + 1) : p;
		}

		function attachArtifactRows(task, rows) {
			if (!task || !rows || !rows.length) return false;
			ensureSessions(task);
			let added = false;
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i] || {};
				const rel = String(row.path || "").replace(/\\/g, "/");
				const name = artifactBase(row);
				if (!rel && !name) continue;
				const fake = { name: name, path: rel, meta: "产物 · 已挂" };
				if (isStubAssignmentFile(fake)) continue;
				const k = fileKey(fake);
				let exists = false;
				for (let j = 0; j < task.files.length; j++) {
					if (fileKey(task.files[j]) === k) { exists = true; break; }
				}
				if (exists) continue;
				const entry = {
					name: name,
					path: rel,
					kind: fileKind({ name: name }),
					meta: "产物 · 已挂",
					source: "artifact"
				};
				task.files.push(entry);
				persistFile(task, entry);
				added = true;
			}
			if (added) {
				rememberFiles(task);
				pulse();
			}
			return added;
		}

		function pullHungArtifactsFor(task) {
			if (!task || typeof listArtifactsFn !== "function") return;
			if (!task.sessionIds || !task.sessionIds.some(isOfficialSessionId)) return;
			listArtifactsFn({}).then(function (reply) {
				attachArtifactRows(task, flattenArtifacts(reply));
			}).catch(function () {});
		}

		function pullHungArtifacts() {
			const task = findTask(selectedId) || findTask(linked.taskId);
			pullHungArtifactsFor(task);
		}

		// A task is worked in the person's own workspace: its task folder is there.
		function personalWorkspaceId() {
			const snap = workspaceListFn() || {};
			const items = snap.items || snap.workspaces || [];
			let first = null;
			for (let i = 0; i < items.length; i++) {
				const it = items[i] || {};
				if (!it.id) continue;
				if (!first) first = it.id;
				const title = String(it.title || it.name || "");
				const p = String(it.path || "").replace(/\\/g, "/").toLowerCase();
				if (title === "个人" || p.indexOf("/_office") >= 0 || p.indexOf("/emp-") >= 0) return it.id;
			}
			return first;
		}
		// Start a session for a card, with an opening line in its composer; the
		// session is linked to the card as soon as it exists (first message).
		// The session that sends a card's opening line is linked to that card
		// right then. 0.2.x gives a new session its id before the first message,
		// so waiting for "a new id to appear" missed it.
		let cardOpener = null;
		function startCardSession(task) {
			// The new session needs the whole width: an empty session page does not
			// shrink beside the card panel, it scrolls sideways under it. The card
			// is one click away again from the session header once linked.
			selectTask(null);
			// No "claim the next new session" here: that grabbed whichever session
			// appeared next, even one opened for something else.
			awaitingSessionForTaskId = null;
			awaitingFromSessionId = null;
			startSessionFn(personalWorkspaceId() || undefined);
			const line = "开始处理任务卡 " + task.id + "「" + task.title + "」：先用 task_card 读一下这张卡，说说你打算怎么做。";
			cardOpener = { taskId: task.id };
			let tries = 0;
			const put = function () {
				tries++;
				if (insertDeskTextFn(line, composerSessionId || undefined, true)) return;
				if (tries < 8) setTimeout(put, 250);
			};
			setTimeout(put, 400);
		}
		function teamWorkspaceId() {
			const snap = workspaceListFn() || {};
			const items = snap.items || snap.workspaces || [];
			let fallback = null;
			for (let i = 0; i < items.length; i++) {
				const it = items[i] || {};
				const id = it.id;
				if (!id) continue;
				const title = String(it.title || it.name || "");
				const p = String(it.path || "").replace(/\\/g, "/").toLowerCase();
				if (title === "团队" || title === "公司") return id;
				const personal = p.indexOf("/emp-") >= 0 || p.indexOf("/_office") >= 0
					|| title === "个人";
				if (!personal && (p.endsWith("/company") || p.indexOf("/dsh/company") >= 0 || title === "团队")) {
					fallback = id;
				}
			}
			return fallback;
		}

		function startTaskConsult(taskId) {
			requestTaskSession(taskId, function () {
				startSessionFn(teamWorkspaceId() || undefined);
			});
		}

		function sessionTrace(task) {
			ensureSessions(task);
			const n = task.sessionIds.length;
			return n ? ("已挂 " + n + " 条会话") : "尚未挂窗口";
		}

		function bindSession(task, sessionId, title) {
			if (!task || !sessionId) return false;
			ensureSessions(task);
			if (task.sessionIds.indexOf(sessionId) >= 0) {
				task.trace = sessionTrace(task);
				rememberBind(task);
				return false;
			}
			task.sessionIds.push(sessionId);
			task.sessions.push({
				id: sessionId,
				title: title || ("会话 " + String(sessionId).slice(0, 8)),
				when: "刚才"
			});
			task.trace = sessionTrace(task);
			rememberBind(task);
			persistSessions(task);
			pullHungArtifactsFor(task);
			return true;
		}

		function unbindSession(task, sessionId) {
			if (!task || !sessionId) return false;
			ensureSessions(task);
			const idx = task.sessionIds.indexOf(sessionId);
			if (idx < 0) return false;
			task.sessionIds.splice(idx, 1);
			task.sessions = task.sessions.filter(function (s) { return s.id !== sessionId; });
			task.trace = sessionTrace(task);
			if (linked.sessionId === sessionId && linked.taskId === task.id) {
				linked = { sessionId: null, taskId: null };
			}
			if (pendingInjectTaskId === task.id && !taskOwnsSession(task, liveSession.id)) {
				pendingInjectTaskId = null;
			}
			rememberBind(task);
			persistUnbind(task, sessionId);
			pulse();
			return true;
		}

		function hangSessionOnTask(task, sessionId, title) {
			const sid = sessionId || liveSession.id;
			if (!task || !sid) return false;
			const name = title
				|| (sid === liveSession.id ? (liveSession.title || liveSessionTitle()) : "")
				|| ("会话 " + String(sid).slice(0, 8));
			bindSession(task, sid, name);
			if (liveSession.id === sid) {
				linked = { sessionId: sid, taskId: task.id };
				pendingInjectTaskId = task.id;
			}
			pulse();
			return true;
		}

		function hangLiveOnTask(task, sessionId, title) {
			const sid = sessionId || liveSession.id;
			if (!task || !sid) return false;
			const known = sessionTitleOf(sid, "");
			const name = title || (known !== "未命名会话" ? known : "") || liveSession.title || liveSessionTitle() || known;
			bindSession(task, sid, name);
			linked = { sessionId: sid, taskId: task.id };
			pendingInjectTaskId = task.id;
			if (!liveSession.id || liveSession.id === sid) {
				liveSession = { id: sid, title: name };
			}
			pulse();
			return true;
		}

		function isOfficialSessionId(id) {
			return typeof id === "string" && id.indexOf("session-") === 0;
		}

		function taskOwnsSession(task, sessionId) {
			if (!task || !sessionId) return false;
			ensureSessions(task);
			return task.sessionIds.indexOf(sessionId) >= 0;
		}

		function resolveOfficialSessionId(task) {
			if (!task) return null;
			ensureSessions(task);
			for (let i = 0; i < task.sessionIds.length; i++) {
				if (isOfficialSessionId(task.sessionIds[i])) return task.sessionIds[i];
			}
			return null;
		}

		function isTerminalTask(task) {
			if (!task) return false;
			if (task.archived) return true;
			return task.state === "已通过" || task.state === "未通过" || task.state === "已放弃";
		}

		function dropPlaceholderSessions(task) {
			if (!task) return;
			ensureSessions(task);
			const keepIds = [];
			const keepRows = [];
			for (let i = 0; i < task.sessionIds.length; i++) {
				const id = task.sessionIds[i];
				if (!isOfficialSessionId(id)) continue;
				keepIds.push(id);
				for (let j = 0; j < task.sessions.length; j++) {
					if (task.sessions[j].id === id) keepRows.push(task.sessions[j]);
				}
			}
			task.sessionIds = keepIds;
			task.sessions = keepRows;
			task.trace = sessionTrace(task);
		}

		function openTaskSession(task) {
			if (!task) return;
			mergeSessionBind(task, null);
			mergeFileBind(task, null);
			persistSessions(task);
			pullHungArtifactsFor(task);
			const sid = resolveOfficialSessionId(task);
			if (sid) {
				pendingInjectTaskId = task.id;
				linked = { sessionId: sid, taskId: task.id };
				if (liveSession.id !== sid) {
					try { openSessionFn(sid); } catch (err) {}
				}
				return;
			}
			if (liveSession.id && taskOwnsSession(task, liveSession.id)) {
				pendingInjectTaskId = task.id;
				return;
			}
			if (task.sessionIds && task.sessionIds.length) {
				pendingInjectTaskId = task.id;
				const first = task.sessionIds[0];
				linked = { sessionId: first, taskId: task.id };
				if (liveSession.id !== first) {
					try { openSessionFn(first); } catch (err) {}
				}
				return;
			}
			if (isTerminalTask(task)) return;
			startCardSession(task);
		}

		function deskLogin() {
			return mailboxLogin || (deskSelf() && deskSelf().login) || "";
		}
		function isIssuer(task) {
			if (!task) return false;
			if (task.from === "我") return true;
			const me = deskLogin();
			return !!(me && task.from === me);
		}
		function canEditAssignment(task) {
			if (!task || !isDraft(task)) return false;
			if (shellRole === "director" || shellRole === "admin") return true;
			return isIssuer(task);
		}
		function canRenameTask(task) {
			if (!task || task.archive_locked) return false;
			if (shellRole === "director" || shellRole === "admin") return true;
			const me = deskLogin();
			if (isIssuer(task)) return true;
			return !!(me && (task.to === me || task.from === me));
		}
		function isStubAssignmentFile(file) {
			if (!file || file.name !== "assignment.md") return false;
			return String(file.meta || "").indexOf("已下达") >= 0;
		}

		function canEditSummary(task) {
			if (!task || !isDraft(task)) return false;
			if (shellRole === "director") return false;
			return true;
		}

		function requestTaskSession(taskId, startSession) {
			pendingInjectTaskId = taskId;
			if (awaitingSessionForTaskId === taskId) {
				pulse();
				return;
			}
			awaitingFromSessionId = liveSession.id || null;
			awaitingSessionForTaskId = taskId;
			pulse();
			if (typeof startSession === "function") startSession();
		}

		function claimAwaitingSession() {
			if (!awaitingSessionForTaskId) return;
			const snap = sessionListFn() || {};
			const sid = snap.current || liveSession.id;
			if (!isOfficialSessionId(sid)) return;
			if (sid === awaitingFromSessionId) return;
			const task = findTask(awaitingSessionForTaskId)
				|| findTask(pendingInjectTaskId)
				|| findTask(selectedId);
			if (!task) {
				return;
			}
			dropPlaceholderSessions(task);
			bindSession(task, sid, liveSession.title || liveSessionTitle() || task.title);
			linked = { sessionId: sid, taskId: task.id };
			pendingInjectTaskId = task.id;
			awaitingSessionForTaskId = null;
			awaitingFromSessionId = null;
		}

		// Boot snapshot of scripts/p-exec-base/mailbox/board.json. The mailbox
		// is the owner; this array is a live cache and is not written back.
		// Regenerated by mailbox-apply.py. Do not edit between the markers.
		// @@MAILBOX_TICKETS_BEGIN
		const TASKS = [];
		// @@MAILBOX_TICKETS_END
		if (typeof fetch === "function") {
			mailboxApi().catch(function () {});
			setInterval(function () {
				mailboxApi().catch(function () {});
				pullHungArtifacts();
			}, 8000);
		}

		// Boot snapshot of scripts/p-exec-base/people/roster.json. Control plane
		// is the owner; this array is a live cache and is not written back.
		// Passwords never appear here. Regenerated by people-apply.py.
		// @@PEOPLE_ROSTER_BEGIN
		// Filled from the server at sign-in (/company/people); empty until then.
		const PEOPLE = [];
		// @@PEOPLE_ROSTER_END

		(function seedSessionPointers() {
			for (let i = 0; i < TASKS.length; i++) {
				const t = TASKS[i];
				if (t.assignment == null) {
					t.assignment = t.id === "t7"
						? "整理三版直播话术，交一版可上场的。"
						: "按项目口径完成本期交付。";
				}
				if (!t.sessions) t.sessions = [];
				if (!t.sessionIds) {
					t.sessionIds = t.sessions.map(function (s) { return s.id; });
				}
				t.logPointer = null;
				t.trace = sessionTrace(t);
			}
		})();

		const extraFolders = [];

		function isUncategorized(task) {
			const id = taskProject(task).id;
			return !id || id === "inbox";
		}
		function uncategorizedTasks() {
			return TASKS.filter(function (t) { return isUncategorized(t) && !t.archived; });
		}

		function newDraftTask(project, opts) {
			const task = {
				id: "t" + Date.now(),
				title: "未命名报告",
				from: "我",
				dept: "内容部",
				project: project && project.id && project.id !== "inbox"
					? { id: project.id, title: project.title || project.id }
					: { id: "inbox", title: "无标题" },
				when: "刚才",
				state: "待提交",
				assignment: "",
				summary: "",
				files: [],
				sessions: [],
				sessionIds: [],
				logPointer: null,
				trace: "尚未挂窗口",
				archived: false,
				unread: false,
				toLogin: "",
				toRole: "",
				toLabel: ""
			};
			TASKS.unshift(task);
			// A card is created on the server only from the new-card form, with a
			// name and an assignee. Linking the current session waits for that.
			if (opts && opts.sessionId) {
				task.pendingSession = { id: opts.sessionId, title: (opts && opts.title) || liveSession.title || liveSessionTitle() };
			}
			selectTask(task.id);
		}

		function taskProject(task) {
			if (task && task.project && task.project.id) return task.project;
			return { id: "inbox", title: "无标题" };
		}
		function projectDir(task) {
			return "projects/" + taskProject(task).id + "/";
		}
		function allCategories() {
			const byId = {};
			const list = [];
			function add(cat) {
				if (!cat || !cat.id || byId[cat.id]) return;
				byId[cat.id] = { id: cat.id, title: cat.title || cat.id };
				list.push(byId[cat.id]);
			}
			for (let i = 0; i < extraFolders.length; i++) add(extraFolders[i]);
			for (let i = 0; i < TASKS.length; i++) add(taskProject(TASKS[i]));
			list.sort(function (a, b) { return a.title.localeCompare(b.title, "zh"); });
			return list.filter(function (cat) { return cat.id && cat.id !== "inbox"; });
		}
		function deleteCategory(catId) {
			if (!catId || catId === "inbox") return;
			for (let i = 0; i < TASKS.length; i++) {
				if (taskProject(TASKS[i]).id === catId) {
					TASKS[i].project = { id: "inbox", title: "无标题" };
				}
			}
			for (let i = extraFolders.length - 1; i >= 0; i--) {
				if (extraFolders[i].id === catId) extraFolders.splice(i, 1);
			}
			pulse();
		}
		function addCategory(title) {
			const name = String(title || "").trim();
			if (!name) return null;
			if (name === "未分类" || name === "无标题" || name === "未读") return null;
			for (let i = 0; i < extraFolders.length; i++) {
				if (extraFolders[i].title === name) return extraFolders[i];
			}
			const cats = allCategories();
			for (let i = 0; i < cats.length; i++) {
				if (cats[i].title === name) return cats[i];
			}
			const folder = { id: "cat-" + Date.now(), title: name };
			extraFolders.push(folder);
			pulse();
			return folder;
		}
		function tasksInCategory(catId) {
			return TASKS.filter(function (t) {
				return !t.archived && taskProject(t).id === catId;
			});
		}
		function isInbox(task) {
			return !task.archived;
		}
		function isDraft(task) {
			return task.state === "待提交";
		}
		function isAwaitingVerdict(task) {
			return task.state === "待审批" || task.state === "待批示";
		}
		function setTaskState(task, state) {
			task.state = state;
			if (state === "已通过" || state === "未通过" || state === "已放弃") {
				task.archived = true;
			}
			if (state === "待提交") {
				task.archived = false;
			}
			if (state === "待审批") {
				task.when = "刚才";
				task.files = task.files.map(function (f) {
					return {
						name: f.name,
						meta: f.meta.replace("未提交", "已发送"),
						kind: f.kind,
						blob: f.blob
					};
				});
			}
			if (state === "待提交") {
				task.files = task.files.map(function (f) {
					return {
						name: f.name,
						meta: f.meta.replace("已发送", "未提交").replace("已上交", "未提交"),
						kind: f.kind,
						blob: f.blob
					};
				});
			}
			pulse();
		}
		function findTask(id) {
			for (let i = 0; i < TASKS.length; i++) {
				if (TASKS[i].id === id) return TASKS[i];
			}
			return null;
		}
		function inboxTasks() {
			return TASKS.filter(isInbox);
		}
		function archiveTasks() {
			return TASKS.filter(function (task) { return !isInbox(task); });
		}
		function packQuestion(task, question) {
			const q = String(question || "");
			if (q.indexOf("【任务卡】") === 0 || q.indexOf("【交付报告】") === 0) return q;
			// One line, not the whole card: the agent reads the card with task_card
			// when it needs it, instead of carrying it in every message.
			return "【任务卡】" + task.id + "「" + task.title + "」（" + task.state + "）已关联本会话，需要详情时调用 task_card。\n\n【用户提问】\n" + q;
		}
		function visibleTaskList(query, orderBy, archivedOnly) {
			let list;
			if (archivedOnly) list = archiveTasks();
			else if (String(query || "").trim()) list = inboxTasks();
			else list = uncategorizedTasks();
			const q = String(query || "").trim().toLowerCase();
			if (q) {
				list = list.filter(function (t) {
					const project = taskProject(t);
					return (t.title + " " + t.from + " " + t.dept + " " + t.state + " " + project.title + " " + project.id).toLowerCase().indexOf(q) >= 0;
				});
			}
			list = list.slice();
			list.sort(function (a, b) {
				if (orderBy === "title") return a.title.localeCompare(b.title, "zh");
				if (orderBy === "from") return a.from.localeCompare(b.from, "zh");
				if (orderBy === "project") {
					const ga = taskProject(a).title.localeCompare(taskProject(b).title, "zh");
					if (ga !== 0) return ga;
					return a.title.localeCompare(b.title, "zh");
				}
				return 0;
			});
			return list;
		}
		function groupedTaskList(list) {
			const groups = [];
			const byId = {};
			for (let i = 0; i < list.length; i++) {
				const project = taskProject(list[i]);
				if (!byId[project.id]) {
					byId[project.id] = { id: project.id, title: project.title, tasks: [] };
					groups.push(byId[project.id]);
				}
				byId[project.id].tasks.push(list[i]);
			}
			return groups;
		}

		// Pending work is a red attention mark at the end of the title, not a
		// text pill. Passed / rejected items live in the archive and do not
		// keep a status chip on the title.
		function statusDot(state) {
			if (state === "待审批" || state === "待批示") {
				return React.createElement("span", {
					className: "cs-dot cs-dot-wait",
					"aria-label": state
				});
			}
			if (state === "已通过") {
				return React.createElement("span", {
					className: "cs-dot cs-dot-ok",
					"aria-label": state
				});
			}
			if (state === "未通过") {
				return React.createElement("span", {
					className: "cs-dot cs-dot-no",
					"aria-label": state
				});
			}
			return null;
		}


		// A takeover owes every descendant slot a home, but a throw inside one
		// shipped occupant must not take the whole sidebar down with it — we are
		// the only occupant now, so a crash here means the user has no sidebar.
		//
		// Takes a thunk rather than (renderSlot, name): the row gate proves a
		// descendant is really rendered by looking for a literal
		// renderSlot("<child>") call, and passing the name through a wrapper
		// argument would hide it from that check.
		function safeSlot(render) {
			try {
				return render();
			} catch (err) {
				return null;
			}
		}

		function TaskRowMenu(props) {
			const openHook = React.useState(false);
			const open = openHook[0];
			const setOpen = openHook[1];
			const archived = !!props.task.archived;
			const locked = !!props.task.archive_locked;
			return React.createElement(P.Menu, {
				open: open,
				onClose: function () { setOpen(false); },
				side: "right",
				align: "start",
				dense: true,
				portal: true,
				closeOnPointerLeave: true,
				items: [
					{
						id: "rename",
						label: "重命名",
						icon: React.createElement(P.IconEditOutline16, { size: 16 })
					},
					{
						id: "archive",
						label: archived ? (locked ? "上级已结案" : "移出归档") : "归档任务",
						icon: React.createElement(P.IconArchiveOutline20, { size: 16 })
					}
				],
				onSelect: function (id) {
					setOpen(false);
					if (id === "rename") props.onRename();
					if (id === "archive" && !(archived && locked)) props.onArchive();
				},
				anchor: React.createElement("button", {
					className: "cs-icon-btn",
					type: "button",
					"aria-label": "任务操作",
					onClick: function (event) {
						event.stopPropagation();
						setOpen(!open);
					}
				}, React.createElement(P.IconEllipsisOutline16, { size: 16 }))
			});
		}

		function ArchiveToggle(props) {
			const open = !!props.open;
			return React.createElement(P.Tooltip, {
				label: open ? "返回列表" : "归档",
				delayMs: 500
			},
				React.createElement("button", {
					className: "cs-icon-btn cs-archive-end" + (open ? " cs-icon-btn-on" : ""),
					type: "button",
					"aria-label": "归档",
					"aria-pressed": open,
					onClick: props.onToggle
				}, React.createElement(P.IconArchiveOutline20, { size: 16 }))
			);
		}

		function TaskViewMenu(props) {
			const openHook = React.useState(false);
			const open = openHook[0];
			const setOpen = openHook[1];
			return React.createElement(P.Menu, {
				open: open,
				onClose: function () { setOpen(false); },
				side: "right",
				align: "start",
				dense: true,
				portal: true,
				selectedIds: [props.groupBy, props.orderBy],
				items: [
					{ type: "label", id: "group-by", text: "分组方式" },
					{ id: "workspace", label: "按工作区" },
					{ id: "flat", label: "单列表" },
					{ type: "separator", id: "order-by-separator" },
					{ type: "label", id: "order-by", text: "排序方式" },
					{ id: "manual", label: "手动排序" },
					{ id: "updated", label: "最近更新" },
					{ type: "separator", id: "cat-separator" },
					{ id: "add-cat", label: "新建文件夹" }
				],
				onSelect: function (id) {
					if (id === "workspace" || id === "flat") props.onGroup(id);
					else if (id === "manual" || id === "updated") props.onOrder(id);
					else if (id === "add-cat") props.onAddCat();
					setOpen(false);
				},
				anchor: React.createElement(P.Tooltip, { label: "视图选项", side: "bottom", delayMs: 500 },
					React.createElement("button", {
						className: "cs-icon-btn",
						type: "button",
						"aria-label": "视图选项",
						onClick: function () { setOpen(!open); }
					}, React.createElement(P.IconPersonalizationOutline16, { size: 16 }))
				)
			});
		}

		function CategoryMenu(props) {
			const openHook = React.useState(false);
			const open = openHook[0];
			const setOpen = openHook[1];
			return React.createElement(P.Menu, {
				open: open,
				onClose: function () { setOpen(false); },
				side: "right",
				align: "start",
				dense: true,
				portal: true,
				closeOnPointerLeave: true,
				items: [
					{ id: "delete", label: "删除文件夹" }
				],
				onSelect: function (id) {
					setOpen(false);
					if (id === "delete") props.onDelete();
				},
				anchor: React.createElement("span", {
					className: "cs-folder-menu" + (open ? " cs-folder-menu-on" : "")
				},
					React.createElement("button", {
						className: "cs-icon-btn",
						type: "button",
						"aria-label": "文件夹操作",
						onClick: function (event) {
							event.stopPropagation();
							setOpen(!open);
						}
					}, React.createElement(P.IconEllipsisOutline16, { size: 16 }))
				)
			});
		}

		function HangOntoMenu(props) {
			const compact = !!props.compact;
			const bound = props.bound || null;
			const openHook = React.useState(false);
			const open = openHook[0];
			const setOpen = openHook[1];
			useShellPulse();
			const sid = props.sessionId || liveSession.id;
			const cards = TASKS.filter(function (t) {
				if (t.archived) return false;
				if (bound && t.id === bound.id) return false;
				return true;
			});
			const items = [];
			if (bound) {
				items.push({ id: "_open", label: "查看任务卡" });
				items.push({ id: "_unbind", label: "取消关联" });
			} else {
				items.push({ id: "_new", label: "新任务" });
			}
			if (cards.length) {
				items.push({ type: "separator", id: "sep-cards" });
				for (let i = 0; i < cards.length; i++) {
					items.push({
						id: cards[i].id,
						label: bound ? ("替换为 " + cards[i].title) : cards[i].title
					});
				}
			} else if (!bound) {
				items.push({ type: "separator", id: "sep-empty" });
				items.push({ id: "_empty", label: "没有可挂的任务" });
			}
			return React.createElement(P.Menu, {
				open: open,
				onClose: function () { setOpen(false); },
				side: "bottom",
				align: "start",
				dense: true,
				portal: true,
				items: items,
				onSelect: function (id) {
					setOpen(false);
					if (id === "_empty" || !sid) return;
					if (id === "_open") {
						if (bound) selectTask(bound.id);
						return;
					}
					if (id === "_unbind") {
						if (bound) unbindSession(bound, sid);
						return;
					}
					if (id === "_new") {
						sidebarTabWant = "tasks";
						newDraftTask({ id: "inbox", title: "无标题" }, {
							sessionId: sid,
							title: liveSession.title || liveSessionTitle()
						});
						return;
					}
					const task = findTask(id);
					if (!task) return;
					if (bound) unbindSession(bound, sid);
					hangLiveOnTask(task, sid);
					sidebarTabWant = "tasks";
					selectTask(task.id);
				},
				anchor: compact
					? React.createElement("button", {
						className: "cs-header-chip",
						type: "button",
						title: bound ? bound.title : "关联任务",
						"aria-label": bound ? ("已关联 " + bound.title) : "关联任务",
						disabled: !sid,
						onClick: function (event) {
							event.stopPropagation();
							if (sid) setOpen(!open);
						}
					}, bound ? bound.title : "关联任务")
					: React.createElement(P.Button, {
						variant: "outline",
						size: "sm",
						type: "button",
						disabled: !liveSession.id,
						onClick: function () { if (liveSession.id) setOpen(!open); }
					}, "挂到已有任务")
			});
		}

		function AssociateTaskControl(props) {
			useShellPulse();
			const sessionId = props.sessionId || liveSession.id;
			if (!sessionId) return null;
			let bound = null;
			for (let i = 0; i < TASKS.length; i++) {
				ensureSessions(TASKS[i]);
				if (TASKS[i].sessionIds.indexOf(sessionId) >= 0) {
					bound = TASKS[i];
					break;
				}
			}
			return React.createElement(HangOntoMenu, {
				compact: true,
				sessionId: sessionId,
				bound: bound
			});
		}

		// 0.2.x opens a new session through the uiWorkspace service (it picks the
		// workspace and shows the empty composer); ctx.workspaces is the data
		// service and its startSession did nothing visible here.
		function deskStartSession(ctx, workspaceId) {
			const nav = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : null;
			if (nav && typeof nav.startSession === "function") {
				nav.startSession(workspaceId);
				return;
			}
			if (ctx.workspaces && typeof ctx.workspaces.startSession === "function") ctx.workspaces.startSession(workspaceId);
		}
		const noSubscribe = function () { return function () {}; };
		const NO_PANELS = [];
		const noPanels = function () { return NO_PANELS; };
		const NewChatIcon = P.IconNewChatOutlineMedium || P.IconNewChatOutlineRegular || P.IconPlusOutline16;
		function CompanySidebar(props) {
			const collapsed = props.collapsed;
			const width = props.width;
			const renderSlot = props.renderSlot;
			const wide = !collapsed;

			const tabHook = React.useState("sessions");
			const tab = tabHook[0];
			const setTab = tabHook[1];
			const openCatsHook = React.useState({});
			const openCats = openCatsHook[0];
			const setOpenCats = openCatsHook[1];
			const addingHook = React.useState(false);
			const addingFolder = addingHook[0];
			const setAddingFolder = addingHook[1];
			const folderNameHook = React.useState("");
			const folderName = folderNameHook[0];
			const setFolderName = folderNameHook[1];
			const searchHook = React.useState(false);
			const searchOpen = searchHook[0];
			const setSearchOpen = searchHook[1];
			const queryHook = React.useState("");
			const query = queryHook[0];
			const setQuery = queryHook[1];
			const orderHook = React.useState("updated");
			const orderBy = orderHook[0];
			const setOrderBy = orderHook[1];
			const groupHook = React.useState("workspace");
			const groupBy = groupHook[0];
			const setGroupBy = groupHook[1];
			const renameHook = React.useState(null);
			const renameId = renameHook[0];
			const setRenameId = renameHook[1];
			const renameTextHook = React.useState("");
			const renameText = renameTextHook[0];
			const setRenameText = renameTextHook[1];
			const sessArchiveHook = React.useState(false);
			const sessArchive = sessArchiveHook[0];
			const setSessArchive = sessArchiveHook[1];
			const taskArchiveHook = React.useState(false);
			const taskArchive = taskArchiveHook[0];
			const setTaskArchive = taskArchiveHook[1];
			const selectedId = useSelectedId();
			useShellPulse();
			React.useEffect(function () {
				if (!sidebarTabWant) return;
				setTab(sidebarTabWant);
				sidebarTabWant = null;
			});
			const visibleTasks = visibleTaskList(query, orderBy, taskArchive);
			const categories = allCategories();
			const searching = !!String(query || "").trim();
			function toggleCat(id) {
				setOpenCats(function (prev) {
					const next = Object.assign({}, prev);
					if (next[id]) delete next[id];
					else next[id] = true;
					return next;
				});
			}
			function openCat(id) {
				setOpenCats(function (prev) {
					if (prev[id]) return prev;
					const next = Object.assign({}, prev);
					next[id] = true;
					return next;
				});
			}

			// Publish the live width so the third column docks against the real
			// edge of this column instead of a constant. `width` already is 56
			// when the frame collapses — do not invent a second number.
			React.useEffect(function () {
				document.documentElement.style.setProperty(SIDEBAR_VAR, (wide ? width : RAIL_W) + "px");
			}, [wide, width]);

			const toggleBtn = React.createElement(P.Tooltip, { label: wide ? "收起侧栏" : "展开侧栏", delayMs: 500 },
				React.createElement("button", {
					className: "cs-icon-btn",
					type: "button",
					"aria-label": wide ? "收起侧栏" : "展开侧栏",
					onClick: function () { props.toggleSidebar(); }
				}, React.createElement(P.IconPanelLeftOutline16, { size: 18 }))
			);
			const panels = React.useSyncExternalStore(props.panelStore ? props.panelStore.subscribe : noSubscribe, props.panelStore ? props.panelStore.getSnapshot : noPanels);
			const activePanel = React.useSyncExternalStore(
				props.panelInfo ? props.panelInfo.subscribe : noSubscribe,
				function () { return props.panelInfo ? props.panelInfo.getSnapshot().activePanelId : null; }
			);
			// Plugins can switch whole parts of the desk off, so only the admin gets
			// the entry, same as the models and version pages.
			const shownPanels = shellRole === "admin" ? panels : [];
			function openFreshSession() {
				if (props.selectPanel) props.selectPanel(null);
				selectTask(null);
				setSessArchive(false);
				setTaskArchive(false);
				setSearchOpen(false);
				setQuery("");
				setTab("sessions");
				if (collapsed) props.toggleSidebar();
				props.startSession();
			}
			const brandMark = React.createElement(P.Tooltip, { label: "新对话", delayMs: 500 },
				React.createElement("button", {
					className: "cs-side-brand",
					type: "button",
					"aria-label": "新对话",
					onClick: openFreshSession
				},
					safeSlot(function () {
						return renderSlot("sidebar.brand.mark", { wide: wide, size: wide ? 20 : 24 });
					}),
					wide
						? safeSlot(function () {
							return renderSlot("sidebar.brand.name", { wide: true });
						})
						: null
				)
			);

			function taskRow(t, extraClass) {
				return React.createElement("div", {
					key: t.id,
					className: "cs-row" + (selectedId === t.id ? " cs-row-on" : "") + (extraClass ? " " + extraClass : ""),
					onClick: function () { selectTask(t.id, { revealSession: true }); }
				},
					React.createElement("div", { className: "cs-row-t" },
						renameId === t.id
							? React.createElement("input", {
								className: "cs-search-input",
								value: renameText,
								autoFocus: true,
								onClick: function (event) { event.stopPropagation(); },
								onChange: function (event) { setRenameText(event.target.value); },
								onBlur: function () {
									const next = renameText.trim();
									if (next) persistTitle(t, next);
									setRenameId(null);
									pulse();
								},
								onKeyDown: function (event) {
									if (event.key === "Enter") event.currentTarget.blur();
									if (event.key === "Escape") {
										setRenameId(null);
										pulse();
									}
								}
							})
							: React.createElement("span", { className: "cs-row-t-name" }, t.title),
						statusDot(t.state),
						React.createElement("span", { className: "cs-row-menu" },
							React.createElement(TaskRowMenu, {
								task: t,
								onRename: function () {
									setRenameText(t.title);
									setRenameId(t.id);
								},
								onArchive: function () {
									if (t.archived && t.archive_locked) return;
									t.archived = !t.archived;
									if (selectedId === t.id) selectTask(null);
									else pulse();
									persistArchive(t, t.archived);
								}
							})
						)
					),
					React.createElement("div", { className: "cs-row-m" },
						/^t\d{10,}$/.test(String(t.id))
							? "新建中"
							: [
								t.state === "未通过" ? "被打回" : (t.state === "待提交" ? "进行中" : t.state),
								"负责 " + (displayName(personOf(t.to)) || t.to || "—"),
								cardTime(t.updated_at || t.created_at) || t.when || ""
							].filter(Boolean).join(" · ")
					)
				);
			}
			function commitFolder() {
				const folder = addCategory(folderName);
				setFolderName("");
				setAddingFolder(false);
				if (folder) openCat(folder.id);
			}
			let taskListBody;
			if (taskArchive) {
				taskListBody = visibleTasks.length
					? visibleTasks.map(function (t) { return taskRow(t); })
					: React.createElement("div", { className: "cs-empty" },
						searching ? "没有匹配的归档任务" : "暂无归档任务"
					);
			} else if (!searching && groupBy === "flat") {
				const live = inboxTasks();
				taskListBody = live.length
					? live.map(function (t) { return taskRow(t); })
					: React.createElement("div", { className: "cs-empty" },
						mailboxErr
							? ("工单未接通：" + mailboxErr)
							: (mailboxLive
								? "格子是空的。点 + 给自己下达；对话里说「做完了」不算验收。"
								: "暂无任务")
					);
			} else if (!searching) {
				taskListBody = [
					visibleTasks.length
						? React.createElement("div", { key: "loose" },
							visibleTasks.map(function (t) { return taskRow(t); })
						)
						: null,
					React.createElement("div", { key: "cats" },
						categories.map(function (cat) {
							const open = !!openCats[cat.id];
							const kids = tasksInCategory(cat.id);
							return React.createElement("div", { key: cat.id },
								React.createElement("div", { className: "cs-folder-row" },
									React.createElement("button", {
										type: "button",
										className: "cs-folder" + (open ? " cs-folder-open" : ""),
										"aria-expanded": open,
										onClick: function () { toggleCat(cat.id); }
									},
										React.createElement("span", { className: "cs-folder-name" }, cat.title)
									),
									React.createElement(CategoryMenu, {
										onDelete: function () {
											deleteCategory(cat.id);
											setOpenCats(function (prev) {
												if (!prev[cat.id]) return prev;
												const next = Object.assign({}, prev);
												delete next[cat.id];
												return next;
											});
										}
									})
								),
								open
									? (kids.length
										? kids.map(function (t) { return taskRow(t, "cs-row-nested"); })
										: React.createElement("div", { className: "cs-empty" }, "还没有任务"))
									: null
							);
						}),
						addingFolder
							? React.createElement("div", { key: "new-cat", style: { padding: "4px 10px" } },
								React.createElement("input", {
									className: "cs-search-input",
									value: folderName,
									placeholder: "文件夹名称",
									autoFocus: true,
									onChange: function (event) { setFolderName(event.target.value); },
									onKeyDown: function (event) {
										if (event.key === "Enter") commitFolder();
										if (event.key === "Escape") {
											setAddingFolder(false);
											setFolderName("");
										}
									},
									onBlur: function () {
										if (folderName.trim()) commitFolder();
										else setAddingFolder(false);
									}
								})
							)
							: null
					)
				];
			} else if (visibleTasks.length === 0) {
				taskListBody = React.createElement("div", { className: "cs-empty" }, "没有匹配的任务");
			} else {
				taskListBody = groupedTaskList(visibleTasks).map(function (group) {
					const title = String(group.title || "").trim();
					const hide = !title || title === "分类" || title === "任务卡" || title === "无标题";
					return React.createElement("div", { key: group.id },
						hide ? null : React.createElement("div", { className: "cs-group" }, title),
						group.tasks.map(function (t) { return taskRow(t); })
					);
				});
			}

			function archivedSessionRows() {
				const ws = workspaceListFn() || {};
				const ids = ws.archivedSessionIds || [];
				const snap = sessionListFn() || {};
				const byId = snap.byId || {};
				if (!ids.length) {
					return React.createElement("div", { className: "cs-empty" }, "暂无归档会话");
				}
				return ids.map(function (id) {
					const row = byId[id] || {};
					const title = row.displayTitle || row.title || String(id).slice(0, 12);
					const live = liveSession.id === id;
					return React.createElement("div", {
						key: id,
						className: "cs-row" + (live ? " cs-row-on" : ""),
						onClick: function () {
							try { openSessionFn(id); } catch (err) {}
						}
					},
						React.createElement("div", { className: "cs-row-t" },
							React.createElement("span", { className: "cs-row-t-name" }, title)
						),
						React.createElement("div", { className: "cs-row-m" }, id)
					);
				});
			}

			return React.createElement("div", {
				className: "cs-side" + (wide ? "" : " cs-side-rail"),
				"data-company-shell": "sidebar"
			},
				React.createElement(Style, null),

				React.createElement("div", { className: "cs-side-head" },
					wide ? brandMark : null,
					toggleBtn
				),

				React.createElement("div", { className: "cs-side-new" },
					React.createElement(P.Tooltip, { label: "新会话", delayMs: 500, disabled: wide },
						React.createElement("button", {
							type: "button",
							className: "cs-new",
							"aria-label": "新会话",
							onClick: openFreshSession
						},
							React.createElement(NewChatIcon, { size: wide ? 15 : 18 }),
							wide ? React.createElement("span", null, "新会话") : null
						)
					)
				),


				wide
					? React.createElement("div", { className: "cs-tabrow" },
						React.createElement("div", { className: "cs-tablist", role: "tablist" },
							[
								{ id: "sessions", label: "会话" },
								{ id: "tasks", label: "任务" }
							].map(function (item) {
								return React.createElement("button", {
									key: item.id,
									type: "button",
									role: "tab",
									"aria-selected": tab === item.id,
									className: "cs-tab" + (tab === item.id ? " cs-tab-on" : ""),
									onClick: function () {
										if (item.id === "tasks") {
											closeDetailsQuiet();
										}
										setTab(item.id);
									}
								}, item.label);
							})
						)
					)
					: null,

				shownPanels.length
					? React.createElement("nav", { className: "cs-side-nav", "aria-label": "面板" },
						shownPanels.map(function (panel) {
							const on = activePanel === panel.id;
							return React.createElement(P.Tooltip, { key: panel.id, label: panel.label, delayMs: 500, disabled: wide },
								React.createElement("button", {
									type: "button",
									className: "cs-nav-row" + (on ? " is-on" : ""),
									"aria-label": panel.label,
									"aria-current": on ? "page" : undefined,
									onClick: function () { props.selectPanel(on ? null : panel.id); }
								},
									React.createElement("span", { className: "cs-nav-glyph", "aria-hidden": "true" },
										safeSlot(function () {
											return renderSlot("sidebar.panellist", { size: wide ? 16 : 18, active: on }, { only: panel.id });
										})
									),
									wide ? React.createElement("span", null, panel.label) : null
								)
							);
						})
					)
					: null,

				wide
					? React.createElement("div", { className: "cs-region" },
					// Tab one is the shipped workspace browser, rendered through the
					// slot we re-declared. We did not rebuild the workspace tree.
					React.createElement("div", {
						className: "cs-pane cs-pane-sess" + (wide && tab !== "sessions" ? " cs-pane-off" : "")
					},
						wide
							? React.createElement("div", {
								className: sessArchive ? "cs-secthead cs-secthead-end" : "cs-sess-archive"
							},
								React.createElement(ArchiveToggle, {
									open: sessArchive,
									onToggle: function () { setSessArchive(!sessArchive); }
								})
							)
							: null,
						sessArchive
							? React.createElement("div", { className: "cs-list" }, archivedSessionRows())
							: safeSlot(function () {
								return renderSlot("sidebar.workspaces", {
									wide: wide,
									expandSidebar: function () { if (collapsed) props.toggleSidebar(); }
								});
							})
					),

					wide
						? React.createElement("div", {
							className: "cs-pane" + (tab !== "tasks" ? " cs-pane-off" : "")
						},
							React.createElement("div", { className: "cs-secthead" },
								searchOpen || taskArchive ? null : React.createElement(P.Tooltip, {
									label: "NEW",
									delayMs: 500
								},
									React.createElement("button", {
										className: "cs-icon-btn",
										type: "button",
										"aria-label": "NEW",
										onClick: function () {
											newDraftTask({ id: "inbox", title: "无标题" });
										}
									}, React.createElement(P.IconPlusOutline16, { size: 16 }))
								),
								React.createElement("div", {
									className: "cs-search" + (searchOpen ? " cs-search-open" : "")
								},
									React.createElement(P.Tooltip, {
										label: "搜索任务",
										delayMs: 500,
										disabled: searchOpen
									},
										React.createElement("button", {
											className: "cs-icon-btn",
											type: "button",
											"aria-label": "搜索任务",
											"aria-expanded": searchOpen,
											onClick: function () { setSearchOpen(true); }
										}, React.createElement(P.IconSearchOutline16, { size: searchOpen ? 11 : 16 }))
									),
									searchOpen
										? React.createElement("input", {
											className: "cs-search-input",
											type: "text",
											placeholder: "搜索任务…",
											value: query,
											autoFocus: true,
											onChange: function (event) { setQuery(event.target.value); },
											onKeyDown: function (event) {
												if (event.key !== "Escape") return;
												setQuery("");
												setSearchOpen(false);
											}
										})
										: null,
									searchOpen
										? React.createElement("button", {
											className: "cs-icon-btn",
											type: "button",
											"aria-label": "清除搜索",
											onClick: function () {
												setQuery("");
												setSearchOpen(false);
											}
										}, React.createElement(P.IconCloseFill14, { size: 12 }))
										: null
								),
								searchOpen || taskArchive ? null : React.createElement(TaskViewMenu, {
									groupBy: groupBy,
									orderBy: orderBy,
									onGroup: setGroupBy,
									onOrder: setOrderBy,
									onAddCat: function () { setAddingFolder(true); }
								}),
								React.createElement(ArchiveToggle, {
									open: taskArchive,
									onToggle: function () { setTaskArchive(!taskArchive); }
								})
							),
							React.createElement("div", { className: "cs-list" }, taskListBody)
						)
						: null
				)
				: null,

				React.createElement("div", { className: "cs-foot" },
					wide
						? safeSlot(function () {
							return renderSlot("sidebar.footer.action", { wide: wide });
						})
						: null,
					safeSlot(function () {
						return renderSlot("sidebar.settings", { wide: wide });
					})
				)
			);
		}

		function fileKind(file) {
			const type = String(file.type || "");
			const name = String(file.name || "").toLowerCase();
			if (type.indexOf("video/") === 0 || /\.(mp4|mov|webm|mkv|m4v)$/.test(name)) return "视频";
			if (type.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(name)) return "图片";
			return "文件";
		}
		function downloadFile(entry, taskId) {
			if (!entry) return;
			const save = function (blob) {
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = entry.name || "file";
				document.body.appendChild(link);
				link.click();
				link.remove();
				URL.revokeObjectURL(url);
			};
			if (entry.blob) {
				save(entry.blob);
				return;
			}
			const rel = String(entry.path || "").replace(/\\/g, "/");
			if (!rel || !taskId) return;
			loadTaskFileBlob(taskId, rel).then(save).catch(function (err) {
				mailboxErr = String(err && err.message || err);
				pulse();
			});
		}

		function uploadTaskFile(task, file) {
			if (!task || !file || !file.blob) return Promise.resolve(null);
			if (String(task.id).indexOf("tk-") !== 0) {
				file.meta = formatSize(file.blob.size || 0) + " · 先发给人再上传";
				return Promise.resolve(null);
			}
			file.meta = formatSize(file.blob.size || 0) + " · 上传中";
			return new Promise(function (resolve, reject) {
				const reader = new FileReader();
				reader.onerror = function () { reject(new Error("read-file")); };
				reader.onload = function () {
					const data = reader.result;
					let b64 = "";
					if (typeof data === "string") {
						const i = data.indexOf(",");
						b64 = i >= 0 ? data.slice(i + 1) : data;
					}
					mailboxApi({
						action: "upload",
						ticket: task.id,
						name: file.name,
						content: b64
					}).then(function (j) {
						file.meta = formatSize(file.blob.size || 0) + " · 已上传";
						const rows = (j && j.tickets) || [];
						for (let i = 0; i < rows.length; i++) {
							if (!rows[i] || rows[i].id !== task.id) continue;
							const found = (rows[i].files || []).filter(function (x) {
								return x && x.name === file.name && x.path;
							})[0];
							if (found) file.path = found.path;
							break;
						}
						resolve(j);
					}).catch(reject);
				};
				reader.readAsDataURL(file.blob);
			});
		}

		function harvestTaskNames(task) {
			const names = [];
			const rows = (task && task.files) || [];
			for (let i = 0; i < rows.length; i++) {
				const n = rows[i] && rows[i].name;
				if (n && n !== "assignment.md" && n !== "submit.md") names.push(n);
			}
			return names;
		}

		function submitTaskCard(task) {
			const blobs = ((task && task.files) || []).filter(function (f) { return f && f.blob; });
			let chain = Promise.resolve();
			for (let i = 0; i < blobs.length; i++) {
				chain = chain.then(function () { return uploadTaskFile(task, blobs[i]); });
			}
			return chain.then(function () {
				return mailboxApi({
					action: "submit",
					ticket: task.id,
					summary: task.summary || task.title,
					names: harvestTaskNames(task)
				});
			});
		}
		function formatSize(bytes) {
			if (bytes < 1024) return bytes + " B";
			if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
			return (bytes / (1024 * 1024)).toFixed(1) + " MB";
		}

		function b64ToBlob(b64, type) {
			const bin = atob(String(b64 || ""));
			const bytes = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return new Blob([bytes], { type: type || "application/octet-stream" });
		}

		function loadTaskFileBlob(taskId, rel) {
			return mailboxApi({
				action: "file",
				ticket: taskId,
				path: rel
			}).then(function (j) {
				if (!j || !j.content) throw new Error("file-empty");
				return b64ToBlob(j.content, j.type);
			});
		}

		function FileThumb(props) {
			const f = props.file;
			const taskId = props.taskId;
			const isPic = (f.kind === "图片") || /\.(jpe?g|png|webp|gif|bmp)$/i.test(String(f.name || ""));
			const srcHook = React.useState("");
			const src = srcHook[0];
			const setSrc = srcHook[1];
			const noteHook = React.useState(isPic && f.path && !f.blob ? "载入图片…" : "");
			const note = noteHook[0];
			const setNote = noteHook[1];
			React.useEffect(function () {
				if (!isPic) return undefined;
				if (f.blob) {
					const u = URL.createObjectURL(f.blob);
					setSrc(u);
					setNote("");
					return function () { URL.revokeObjectURL(u); };
				}
				const rel = String(f.path || "").replace(/\\/g, "/");
				if (!rel || !taskId) {
					setNote("");
					return undefined;
				}
				let dead = false;
				let made = "";
				setNote("载入图片…");
				loadTaskFileBlob(taskId, rel).then(function (blob) {
					if (dead) return;
					made = URL.createObjectURL(blob);
					setSrc(made);
					setNote("");
				}).catch(function (err) {
					if (dead) return;
					setNote("图片载入失败");
					mailboxErr = String(err && err.message || err);
				});
				return function () {
					dead = true;
					if (made) URL.revokeObjectURL(made);
				};
			}, [isPic, f.path, taskId, f.blob]);
			if (!isPic) return null;
			if (src) {
				return React.createElement("img", {
					className: "cs-file-thumb",
					src: src,
					alt: f.name,
					style: { width: "100%", maxHeight: "180px", objectFit: "cover", borderRadius: "6px", display: "block", marginBottom: "8px" }
				});
			}
			return note ? React.createElement("div", { className: "cs-row-m" }, note) : null;
		}

		function FileCard(props) {
			const f = props.file;
			const draft = props.draft;
			const onRemove = props.onRemove;
			return React.createElement("div", { className: "cs-card" },
				React.createElement(FileThumb, { file: f, taskId: props.taskId }),
				React.createElement("div", { className: "cs-cardrow cs-cardrow-file" },
					React.createElement("span", { className: "cs-file-name" }, f.name),
					React.createElement("div", { className: "cs-file-acts" },
						React.createElement("span", { className: "cs-kind" }, f.kind || "文件"),
						React.createElement(P.Button, {
							variant: "outline", size: "sm", type: "button",
							icon: React.createElement(P.IconDownloadOutline16, { size: 14 }),
							onClick: function (event) {
								event.stopPropagation();
								downloadFile(f, props.taskId);
							}
						}, "下载"),
						draft
							? React.createElement("button", {
								className: "cs-icon-btn",
								type: "button",
								"aria-label": "移除",
								onClick: onRemove
							}, React.createElement(P.IconCloseOutline16, { size: 14 }))
							: null
					)
				),
				f.meta ? React.createElement("div", { className: "cs-row-m" }, f.meta) : null
			);
		}

		function ComposerInjector(props) {
			useShellPulse();
			const inputActions = props.inputActions;
			const sessionId = props.sessionId;
			const input = props.input;
			const draftRef = React.useRef("");
			draftRef.current = input && input.draft ? input.draft : "";

			React.useEffect(function () {
				if (!sessionId) return;
				const title = liveSessionTitle();
				const changed = liveSession.id !== sessionId || liveSession.title !== title;
				liveSession = { id: sessionId, title: title };
				if (awaitingSessionForTaskId && sessionId !== awaitingFromSessionId) {
					claimAwaitingSession();
					pulse();
				} else if (changed) {
					pulse();
				}
			}, [sessionId]);

			React.useEffect(function () {
				if (!inputActions || !sessionId) return;
				const leftover = draftRef.current;
				if (leftover.indexOf("【交付报告】") === 0 || leftover.indexOf("【任务卡】") === 0) {
					inputActions.setDraft("");
				}
				if (wrappedSubmit && wrappedSubmit.has(inputActions)) return;
				if (wrappedSubmit) wrappedSubmit.add(inputActions);
				const origSubmit = inputActions.submit.bind(inputActions);
				const origSetDraft = inputActions.setDraft.bind(inputActions);
				inputActions.submit = function () {
					const question = draftRef.current;
					if (cardOpener && question.indexOf("开始处理任务卡 " + cardOpener.taskId) === 0) {
						const card = findTask(cardOpener.taskId);
						cardOpener = null;
						if (card && isOfficialSessionId(sessionId)) {
							bindSession(card, sessionId, card.title);
							linked = { sessionId: sessionId, taskId: card.id };
							pendingInjectTaskId = card.id;
							awaitingSessionForTaskId = null;
							awaitingFromSessionId = null;
						}
					}
					const task = findTask(pendingInjectTaskId || linked.taskId);
					if (task && taskOwnsSession(task, sessionId) && question.trim() && question.indexOf("【交付报告】") !== 0 && question.indexOf("【任务卡】") !== 0) {
						origSetDraft(packQuestion(task, question));
						linked = { sessionId: sessionId, taskId: task.id };
					}
					origSubmit();
				};
			}, [sessionId, inputActions]);

			React.useEffect(function () {
				const root = document.querySelector("[data-conversation-scroll]");
				if (!root) return undefined;
				const stripPrefix = function (text) {
					if (text.indexOf("【交付报告】") === 0 || text.indexOf("【任务卡】") === 0) {
						const mark = text.indexOf("【用户提问】");
						if (mark < 0) return null;
						return text.slice(mark + "【用户提问】".length).replace(/^\n+/, "");
					}
					return null;
				};
				const strip = function () {
					const nodes = root.querySelectorAll("p, li, div, span");
					for (let i = 0; i < nodes.length; i++) {
						const el = nodes[i];
						if (el.childElementCount > 0) continue;
						const next = stripPrefix(el.textContent || "");
						if (next != null) el.textContent = next;
					}
				};
				// The agent writes the report into the card itself (task_card update);
				// nothing is scraped from its answer any more.
				const collect = function () { strip(); };
				const mo = new MutationObserver(collect);
				mo.observe(root, { childList: true, subtree: true, characterData: true });
				collect();
				return function () { mo.disconnect(); };
			}, [sessionId]);

			return null;
		}

		// company-task-card-look-v2. The task card panel, top to bottom:
		// title + who + progress, 任务内容, 关联会话 (the sessions working on it),
		// 交付物 (task folder + files), 汇报, 审批, 动态, and one footer with the
		// next step for this person in this state.
		const CARD_STEPS = [
			{ id: "work", label: "进行中" },
			{ id: "review", label: "待审批" },
			{ id: "done", label: "已通过" }
		];
		function isLocalDraft(task) {
			return /^t\d{10,}$/.test(String(task && task.id || ""));
		}
		function stateBadge(state) {
			if (state === "已通过") return badge("已通过", "ok", true);
			if (state === "未通过") return badge("被打回", "err", true);
			if (state === "待审批" || state === "待批示") return badge("待审批", "warn", true);
			return badge("进行中", "brand", true);
		}
		function mayOf(task) {
			if (task && task.may) return task.may;
			const draft = isDraft(task) || task.state === "未通过";
			return {
				edit_assignment: canEditAssignment(task),
				edit_summary: canEditSummary(task),
				submit: canEditSummary(task) && draft,
				withdraw: isSubmitter(task) && (isAwaitingVerdict(task) || task.state === "未通过"),
				review: canReviewTask(task),
				files: draft,
				archive_all: false
			};
		}
		function cardTime(v) {
			const n = Number(v) || 0;
			if (!n) return typeof v === "string" ? v : "";
			const d = new Date(n);
			const now = new Date();
			const pad = function (x) { return String(x).padStart(2, "0"); };
			const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
			if (d.toDateString() === now.toDateString()) return "今天 " + hm;
			const y = new Date(now.getTime() - 86400000);
			if (d.toDateString() === y.toDateString()) return "昨天 " + hm;
			return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + hm;
		}
		function whoChip(login) {
			const p = personOf(login) || { login: login };
			return el("span", { className: "cs-tc-who" }, personAvatar(p), displayName(p) || login || "—");
		}
		// Save one text field of a card on the server. Older servers that do not
		// know "edit" keep the text in the local draft until the card is handed in.
		function saveCardField(task, field, value) {
			if (field === "summary") contentDrafts[task.id] = value;
			else assignmentDrafts[task.id] = value;
			task[field] = value;
			pulse();
			if (isLocalDraft(task) || typeof fetch !== "function") return Promise.resolve(false);
			const body = { action: "edit", ticket: task.id };
			body[field] = value;
			return mailboxApi(body).then(function () {
				if (field === "summary") delete contentDrafts[task.id];
				else delete assignmentDrafts[task.id];
				return true;
			}, function () { return false; });
		}
		function issuableTo() {
			const me = deskSelf();
			const login = mailboxLogin || (me && me.login) || "";
			return livePeople().filter(function (p) {
				if (p.login === login) return true;
				if (shellRole === "admin") return true;
				if (shellRole === "director") return me && p.dept === me.dept && p.role !== "admin";
				return false;
			});
		}

		function CardText(props) {
			const task = props.task;
			const field = props.field;
			const stored = String(task[field] || "");
			const hook = React.useState(stored);
			const savedHook = React.useState("");
			React.useEffect(function () { hook[1](stored); }, [task.id, stored]);
			if (!props.editable) {
				return el("div", { className: "cs-tc-read" + (stored ? "" : " is-empty") }, stored || props.emptyText || "（空）");
			}
			return el("div", null,
				el("textarea", {
					className: "cs-tc-text",
					rows: props.rows || 4,
					placeholder: props.placeholder || "",
					value: hook[0],
					onChange: function (e) { hook[1](e.target.value); savedHook[1](""); },
					onBlur: function () {
						const next = hook[0];
						if (next === stored) return;
						saveCardField(task, field, next).then(function (ok) { savedHook[1](ok ? "已保存" : "已暂存在本机"); });
					}
				}),
				el("div", { className: "cs-tc-hint" }, savedHook[0] ? el("span", { className: "cs-tc-saved" }, savedHook[0]) : (props.hint || null))
			);
		}

		function CardSection(props) {
			return el("section", { className: "cs-tc-sec" },
				el("div", { className: "cs-tc-sh" },
					el("span", { className: "cs-tc-st" }, props.title),
					props.aside ? el("span", { className: "cs-tc-sx" }, props.aside) : null
				),
				props.children
			);
		}

		function CardSteps(props) {
			const s = props.state;
			const at = s === "已通过" ? 2 : (s === "待审批" || s === "待批示" || s === "未通过") ? 1 : 0;
			const out = [];
			CARD_STEPS.forEach(function (step, i) {
				let cls = "cs-tc-step";
				let label = step.label;
				if (i < at || (i === at && s === "已通过")) cls += " is-done";
				else if (i === at) {
					if (s === "未通过") { cls += " is-bad"; label = "被打回"; }
					else cls += " is-now";
				}
				if (i > 0) out.push(el("span", { key: "l" + i, className: "cs-tc-line" + (i <= at ? " is-done" : "") }));
				out.push(el("span", { key: step.id, className: cls }, el("i"), label));
			});
			return el("div", { className: "cs-tc-steps", "aria-label": "进度" }, out);
		}

		// A session's name as the session list shows it now (sessions are renamed
		// after their first turn), falling back to the name stored on the card.
		function sessionTitleOf(sid, stored) {
			const snap = sessionListFn() || {};
			const row = (snap.byId || {})[sid] || null;
			const live = row && (row.displayTitle || row.title);
			if (live) return String(live);
			if (stored && String(stored).indexOf("会话 session-") !== 0) return String(stored);
			return "未命名会话";
		}
		function CardSessions(props) {
			const task = props.task;
			ensureSessions(task);
			const live = liveSession.id;
			const liveBound = !!(live && task.sessionIds.indexOf(live) >= 0);
			const done = task.state === "已通过";
			const rows = task.sessions.map(function (s) {
				const here = live && s.id === live;
				return el("div", {
					key: s.id,
					className: "cs-tc-item is-link",
					title: "打开这个会话",
					onClick: function () {
						pendingInjectTaskId = task.id;
						linked = { sessionId: s.id, taskId: task.id };
						if (isOfficialSessionId(s.id) && liveSession.id !== s.id) {
							try { openSessionFn(s.id); } catch (err) {}
						}
						pulse();
					}
				},
					el("span", { className: "cs-tc-ico" + (here ? " is-live" : "") }, "会"),
					el("div", { className: "cs-tc-item-main" },
						el("div", { className: "cs-tc-item-t" }, sessionTitleOf(s.id, s.title)),
						el("div", { className: "cs-tc-item-d" },
							[displayName(personOf(s.account)) || s.account, cardTime(s.at) || s.when, here ? "正在看" : ""].filter(Boolean).join(" · "))
					),
					btn("取消关联", {
						small: true,
						tone: "ghost",
						onClick: function (e) { e.stopPropagation(); unbindSession(task, s.id); }
					})
				);
			});
			return el(CardSection, { title: "关联会话", aside: rows.length ? rows.length + " 个" : null },
				rows.length
					? el("div", { className: "cs-tc-list" }, rows)
					: el("div", { className: "cs-tc-list" }, el("div", { className: "cs-tc-empty" }, "还没有会话在处理这张卡")),
				done ? null : el("div", { className: "cs-tc-row" },
					btn("新建会话处理", {
						small: true,
						tone: "primary",
						disabled: isLocalDraft(task),
						onClick: function () { startCardSession(task); }
					}),
					live && !liveBound ? btn("关联当前会话", {
						small: true,
						disabled: isLocalDraft(task),
						onClick: function () { hangLiveOnTask(task, live); }
					}) : null
				),
				el("div", { className: "cs-tc-hint" }, "关联的会话里，智能体能读这张卡、看其他关联会话的记录、把产出存进任务文件夹、替你写汇报。提交和审批只能由人来点。")
			);
		}

		function CardFiles(props) {
			const task = props.task;
			const may = mayOf(task);
			const inputRef = React.useRef(null);
			const copiedHook = React.useState(false);
			const shown = (task.files || []).map(function (f, index) { return { file: f, index: index }; })
				.filter(function (row) { return !isStubAssignmentFile(row.file); });
			const addFiles = function (list) {
				if (!list || !list.length) return;
				const added = [];
				for (let i = 0; i < list.length; i++) {
					const file = list[i];
					const kind = fileKind(file);
					added.push({ name: file.name, kind: kind, meta: formatSize(file.size) + " · 上传中", blob: file });
				}
				task.files = task.files.concat(added);
				pulse();
				let chain = Promise.resolve();
				added.forEach(function (row) { chain = chain.then(function () { return uploadTaskFile(task, row); }); });
				chain.then(function () { pulse(); }).catch(function (err) {
					mailboxErr = String(err && err.message || err);
					added.forEach(function (row) {
						if (String(row.meta || "").indexOf("上传中") >= 0) row.meta = formatSize((row.blob && row.blob.size) || 0) + " · 上传失败";
					});
					pulse();
				});
			};
			return el(CardSection, { title: "交付物", aside: shown.length ? shown.length + " 个文件" : null },
				task.folder ? el("div", { className: "cs-tc-folder", title: task.folder },
					el("span", null, "任务文件夹"),
					el("code", null, task.folder),
					btn(copiedHook[0] ? "已复制" : "复制", {
						small: true,
						tone: "ghost",
						onClick: function () {
							try {
								navigator.clipboard.writeText(task.folder);
								copiedHook[1](true);
								setTimeout(function () { copiedHook[1](false); }, 1500);
							} catch (err) {}
						}
					})
				) : null,
				shown.length
					? el("div", { className: "cs-tc-files" }, shown.map(function (row) {
						return el(FileCard, {
							key: (row.file.path || row.file.name) + "-" + row.index,
							file: row.file,
							taskId: task.id,
							draft: may.files && row.file.kind !== "任务文件夹",
							onRemove: function () {
								const gone = task.files[row.index];
								task.files = task.files.filter(function (_x, i) { return i !== row.index; });
								rememberFiles(task);
								persistDetach(task, gone);
								pulse();
							}
						});
					}))
					: el("div", { className: "cs-tc-list" }, el("div", { className: "cs-tc-empty" }, "还没有交付物")),
				may.files ? el("div", { className: "cs-tc-row" },
					el("input", {
						ref: inputRef,
						className: "cs-file-in",
						type: "file",
						multiple: true,
						onChange: function (e) { addFiles(e.target.files); e.target.value = ""; }
					}),
					btn("上传文件", { small: true, disabled: isLocalDraft(task), onClick: function () { if (inputRef.current) inputRef.current.click(); } })
				) : null,
				el("div", { className: "cs-tc-hint" }, "存进任务文件夹的文件会自动列在这里，不用手动上传。")
			);
		}

		function CardReport(props) {
			const task = props.task;
			const may = mayOf(task);
			ensureSessions(task);
			const canDraft = may.edit_summary && task.sessions.length > 0;
			return el(CardSection, { title: "汇报", aside: task.submitted_at ? "提交于 " + cardTime(task.submitted_at) : null },
				el(CardText, {
					task: task,
					field: "summary",
					editable: may.edit_summary,
					rows: 5,
					placeholder: "做了什么、结果在哪、还有什么要说明",
					emptyText: "还没写汇报",
					hint: may.edit_summary ? "离开输入框自动保存。" : null
				}),
				canDraft ? el("div", { className: "cs-tc-row" },
					btn("让智能体起草", {
						small: true,
						onClick: function () {
							const sid = (liveSession.id && task.sessionIds.indexOf(liveSession.id) >= 0) ? liveSession.id : task.sessionIds[0];
							pendingInjectTaskId = task.id;
							linked = { sessionId: sid, taskId: task.id };
							const ask = "请根据这张任务卡的要求和已经完成的工作起草汇报：做了什么、交付物在哪、还有什么要说明。写好后用 task_card 的 update 写进卡里。";
							const put = function () { insertDeskTextFn(ask, sid); };
							if (liveSession.id !== sid) {
								try { openSessionFn(sid); } catch (err) {}
								setTimeout(put, 900);
							} else put();
						}
					})
				) : null
			);
		}

		function CardReview(props) {
			const task = props.task;
			if (!task.verdict || isAwaitingVerdict(task)) return null;
			const ok = task.state === "已通过";
			return el(CardSection, { title: "审批" },
				el("div", { className: "cs-tc-stamp " + (ok ? "is-ok" : "is-bad") },
					el("b", null, (ok ? "已通过" : "被打回") + " · " + (displayName(personOf(task.approver)) || task.approver || "审批人") + (task.verdict_at ? " · " + cardTime(task.verdict_at) : "")),
					task.verdict
				)
			);
		}

		function CardEvents(props) {
			const rows = (props.task.events || []).slice(-8).reverse();
			if (!rows.length) return null;
			return el(CardSection, { title: "动态" },
				el("ul", { className: "cs-tc-events" }, rows.map(function (e, i) {
					return el("li", { key: i }, el("b", null, displayName(personOf(e.who)) || e.who), " " + e.what, el("span", null, cardTime(e.t)));
				}))
			);
		}

		function NewCardForm(props) {
			const task = props.task;
			const people = issuableTo();
			const me = mailboxLogin || ((deskSelf() || {}).login) || "";
			const titleHook = React.useState(task.title && task.title !== "未命名报告" ? task.title : "");
			const toHook = React.useState(task.toLogin || me);
			const textHook = React.useState(task.assignment || "");
			const busyHook = React.useState(false);
			const errHook = React.useState("");
			function create() {
				const title = titleHook[0].trim();
				if (!title) { errHook[1]("先写任务名称"); return; }
				busyHook[1](true);
				errHook[1]("");
				task.title = title;
				task.assignment = textHook[0].trim();
				mailboxApi({ action: "issue", to: toHook[0] || me, title: title, assignment: task.assignment || title }).then(function (j) {
					busyHook[1](false);
					const tid = j && j.ticket;
					if (!tid) return;
					const card = findTask(tid) || task;
					if (task.pendingSession) {
						bindSession(card, task.pendingSession.id, task.pendingSession.title);
						linked = { sessionId: task.pendingSession.id, taskId: tid };
						task.pendingSession = null;
					}
					selectTask(tid);
					pulse();
				}, function (err) {
					busyHook[1](false);
					errHook[1](peopleErr(err && err.message));
				});
			}
			return el("div", { className: "cs-tc-form" },
				el("label", { className: "cs-field" }, el("span", null, "任务名称"),
					el("input", { className: "cs-input", autoFocus: true, maxLength: 80, value: titleHook[0], placeholder: "例如 10 月新品口播脚本", onChange: function (e) { titleHook[1](e.target.value); } })),
				el("label", { className: "cs-field" }, el("span", null, "负责人"),
					selectBox(toHook[0], people.map(function (p) {
						return { value: p.login, label: (displayName(p) || p.login) + (p.login === me ? "（我自己）" : "") };
					}), function (v) { toHook[1](v); }, people.length <= 1)),
				el("label", { className: "cs-field" }, el("span", null, "任务内容"),
					el("textarea", { className: "cs-tc-text", rows: 6, value: textHook[0], placeholder: "要做什么、做到什么程度、交付什么、截止时间", onChange: function (e) { textHook[1](e.target.value); } })),
				el("div", { className: "cs-tc-actions" },
					el("p", { className: "cs-tc-note" }, task.pendingSession ? "创建后会关联当前会话。" : "创建后可以新建会话来处理它。"),
					btn("取消", { tone: "ghost", onClick: function () { dropLocalDraft(task); } }),
					btn(busyHook[0] ? "正在创建…" : (toHook[0] && toHook[0] !== me ? "下达任务" : "创建任务卡"), { tone: "primary", disabled: busyHook[0], onClick: create })
				),
				errHook[0] ? el("div", { className: "cs-tc-err" }, errHook[0]) : null
			);
		}
		function dropLocalDraft(task) {
			for (let i = 0; i < TASKS.length; i++) {
				if (TASKS[i] === task) { TASKS.splice(i, 1); break; }
			}
			selectTask(null);
			pulse();
		}

		function CardFoot(props) {
			const task = props.task;
			const may = mayOf(task);
			const reasonHook = React.useState(verdictDrafts[task.id] || "");
			const busyHook = React.useState(false);
			const errHook = React.useState("");
			React.useEffect(function () { reasonHook[1](verdictDrafts[task.id] || ""); errHook[1](""); }, [task.id]);
			function run(p) {
				busyHook[1](true);
				errHook[1]("");
				p.then(function () { busyHook[1](false); pulse(); }, function (err) {
					busyHook[1](false);
					errHook[1](peopleErr(err && err.message));
				});
			}
			const err = errHook[0] ? el("div", { className: "cs-tc-err" }, errHook[0]) : null;
			if (isAwaitingVerdict(task) && may.review) {
				const reason = reasonHook[0];
				return el("div", { className: "cs-tc-foot" },
					el("textarea", {
						className: "cs-tc-text",
						rows: 2,
						placeholder: "审批意见（打回时必填）",
						value: reason,
						onChange: function (e) { verdictDrafts[task.id] = e.target.value; reasonHook[1](e.target.value); }
					}),
					el("div", { className: "cs-tc-actions" },
						el("p", { className: "cs-tc-note" }, "通过后任务卡自动归档。"),
						btn("打回", { tone: "danger", disabled: busyHook[0] || !reason.trim(), onClick: function () {
							run(mailboxApi({ action: "verdict", ticket: task.id, passed: false, reason: reason.trim() }));
						} }),
						btn("通过", { tone: "primary", disabled: busyHook[0], onClick: function () {
							run(mailboxApi({ action: "verdict", ticket: task.id, passed: true, reason: reason.trim() }));
						} })
					),
					err
				);
			}
			if (isAwaitingVerdict(task)) {
				return el("div", { className: "cs-tc-foot" },
					el("div", { className: "cs-tc-actions" },
						el("p", { className: "cs-tc-note" }, "已提交，等待审批。"),
						may.withdraw ? btn("撤回修改", { disabled: busyHook[0], onClick: function () {
							run(mailboxApi({ action: "withdraw", ticket: task.id }));
						} }) : null
					),
					err
				);
			}
			if (may.submit) {
				const ready = String(task.summary || contentDrafts[task.id] || "").trim().length > 0;
				return el("div", { className: "cs-tc-foot" },
					el("div", { className: "cs-tc-actions" },
						el("p", { className: "cs-tc-note" }, ready
							? (task.state === "未通过" ? "按审批意见改好后再提交。" : "汇报和交付物会一起交给审批人。")
							: "先写好汇报再提交。"),
						btn(busyHook[0] ? "正在提交…" : "提交验收", { tone: "primary", disabled: busyHook[0] || !ready, onClick: function () {
							run(submitTaskCard(task));
						} })
					),
					err
				);
			}
			if (task.state === "已通过") return null;
			return el("div", { className: "cs-tc-foot" },
				el("div", { className: "cs-tc-actions" },
					el("p", { className: "cs-tc-note" }, "由 " + (displayName(personOf(task.to)) || task.to || "负责人") + " 处理中。")
				)
			);
		}

		function CardPanel(props) {
			const task = props.task;
			useShellPulse();
			const may = mayOf(task);
			const local = isLocalDraft(task);
			const titleEditable = !local && may.edit_assignment;
			const titleHook = React.useState(task.title || "");
			React.useEffect(function () { titleHook[1](task.title || ""); }, [task.id, task.title]);
			return el("div", { className: "cs-tc" },
				el("div", { className: "cs-tc-head" },
					el("div", { className: "cs-tc-top" },
						local
							? el("div", { className: "cs-tc-title", style: { cursor: "default" } }, "新建任务卡")
							: el("input", {
								className: "cs-tc-title",
								readOnly: !titleEditable,
								value: titleHook[0],
								"aria-label": "任务名称",
								onChange: function (e) { titleHook[1](e.target.value); },
								onBlur: function () {
									const next = titleHook[0].trim();
									if (!next || next === task.title) { titleHook[1](task.title || ""); return; }
									task.title = next;
									persistTitle(task, next);
									pulse();
								},
								onKeyDown: function (e) { if (e.key === "Enter") e.currentTarget.blur(); }
							}),
						el(P.Tooltip, { label: "关闭", delayMs: 500 },
							el("button", { className: "cs-icon-btn", type: "button", "aria-label": "关闭", onClick: function () { selectTask(null); } },
								el(P.IconCloseOutline16, { size: 14 })))
					),
					local ? null : el("div", { className: "cs-tc-meta" },
						stateBadge(task.state),
						task.from && task.from !== task.to
							? el("span", { className: "cs-tc-who" }, whoChip(task.from), el("span", { className: "cs-tc-arrow" }, "→"), whoChip(task.to))
							: whoChip(task.to || task.from),
						el("span", null, cardTime(task.created_at) || task.when || "")
					),
					local ? null : el(CardSteps, { state: task.state })
				),
				el("div", { className: "cs-tc-body" },
					local
						? el(NewCardForm, { task: task })
						: [
							el(CardSection, { key: "a", title: "任务内容" },
								el(CardText, { task: task, field: "assignment", editable: may.edit_assignment, rows: 4, placeholder: "要做什么、做到什么程度", emptyText: "没有写任务内容" })),
							el(CardSessions, { key: "s", task: task }),
							el(CardFiles, { key: "f", task: task }),
							el(CardReport, { key: "r", task: task }),
							el(CardReview, { key: "v", task: task }),
							el(CardEvents, { key: "e", task: task })
						]
				),
				local ? null : el(CardFoot, { task: task })
			);
		}

		function TaskInspector() {
			const id = useSelectedId();
			useShellPulse();
			const tabHook = React.useState("overview");
			const tab = tabHook[0];
			const setTab = tabHook[1];
			React.useEffect(function () {
				setTab("overview");
			}, [id]);
			const widthHook = React.useState(inspectorWidth);
			const width = widthHook[0];
			const setWidth = widthHook[1];
			const dragHook = React.useState(false);
			const dragging = dragHook[0];
			const setDragging = dragHook[1];
			const drag = React.useRef(null);

			// Make room in the conversation column for exactly as wide as we are.
			React.useEffect(function () {
				syncTaskComposer(id !== null);
				return function () { syncTaskComposer(false); };
			}, [id]);

			React.useEffect(function () {
				if (id === null) {
					undock();
					return;
				}
				dockAt(width, !dragging);
			}, [id, width, dragging]);

			// Give the room back if this row is unloaded (HMR, plugin disable).
			React.useEffect(function () {
				return function () { undock(); };
			}, []);

			React.useEffect(function () {
				const onMove = function (event) {
					if (drag.current === null) return;
					inspectorWidth = clampWidth(drag.current.startWidth + (event.clientX - drag.current.startX));
					setWidth(inspectorWidth);
				};
				const onUp = function () {
					if (drag.current === null) return;
					drag.current = null;
					setDragging(false);
				};
				document.addEventListener("pointermove", onMove);
				document.addEventListener("pointerup", onUp);
				return function () {
					document.removeEventListener("pointermove", onMove);
					document.removeEventListener("pointerup", onUp);
				};
			}, []);

			React.useEffect(function () {
				const pass = document.querySelector("[data-company-shell=overlay-pass]");
				const host = pass && pass.parentElement;
				let saved = null;
				if (host instanceof HTMLElement) {
					saved = {
						value: host.style.getPropertyValue("pointer-events"),
						priority: host.style.getPropertyPriority("pointer-events")
					};
					host.style.setProperty("pointer-events", "none");
				}
				return function () {
					if (host instanceof HTMLElement && saved) {
						if (saved.value === "") host.style.removeProperty("pointer-events");
						else host.style.setProperty("pointer-events", saved.value, saved.priority);
					}
				};
			}, [id]);

			if (id === null) {
				return React.createElement("div", { "data-company-shell": "overlay-pass" });
			}
			let task = null;
			for (let i = 0; i < TASKS.length; i++) {
				if (TASKS[i].id === id) task = TASKS[i];
			}
			if (task === null) {
				return React.createElement("div", { "data-company-shell": "overlay-pass" });
			}

			return React.createElement("div", {
				"data-company-shell": "overlay-pass",
				style: { position: "fixed", inset: 0, zIndex: 5, pointerEvents: "none" }
			},
			React.createElement("div", {
				className: "cs-insp" + (dragging ? " cs-insp-drag" : ""),
				style: { width: width + "px" },
				"data-company-shell": "inspector"
			},
				React.createElement(Style, null),

				React.createElement("div", {
					className: "cs-insp-grip",
					title: "拖动改变宽度",
					onPointerDown: function (event) {
						drag.current = { startX: event.clientX, startWidth: width };
						setDragging(true);
						event.preventDefault();
					}
				}),

				React.createElement(CardPanel, { task: task })
			)
			);
		}

		// The site's brand occupies the three official brand seats (sidebar mark, sidebar
		// name, hero mark). An image is painted as a CSS mask so the ink follows
		// --dsw-alias-label-primary (the same dark gray the rest of the chrome uses); with no
		// image the name is set in that colour instead.
		function BrandMark(props) {
			const compact = props.wide === false;
			const src = compact ? SITE_BRAND_MARK : SITE_BRAND_WORDMARK;
			const h = compact ? (props.size || 24) : (props.size >= 30 ? 36 : (props.size || 20));
			if (!src) {
				return React.createElement("span", {
					className: props.className,
					// Not brand-mark / brand-wordmark: those paint a background through an image mask.
					"data-company-shell": "brand-text",
					role: "img",
					"aria-label": SITE_BRAND_LABEL,
					style: {
						display: "inline-flex",
						alignItems: "center",
						height: h + "px",
						fontSize: Math.round(h * (compact ? 0.42 : 0.62)) + "px",
						fontWeight: 700,
						letterSpacing: compact ? "0" : "0.02em",
						color: "var(--dsw-alias-label-primary)",
						whiteSpace: "nowrap"
					}
				}, compact ? "TDH" : SITE_BRAND_LABEL);
			}
			const w = compact ? h : Math.round(h * (SITE_BRAND_RATIO || 1));
			return React.createElement("span", {
				className: props.className,
				"data-company-shell": compact ? "brand-mark" : "brand-wordmark",
				role: "img",
				"aria-label": SITE_BRAND_LABEL,
				style: {
					width: w + "px",
					height: h + "px",
					WebkitMaskImage: "url(" + src + ")",
					maskImage: "url(" + src + ")",
					WebkitMaskRepeat: "no-repeat",
					maskRepeat: "no-repeat",
					WebkitMaskPosition: "center",
					maskPosition: "center",
					WebkitMaskSize: "contain",
					maskSize: "contain"
				}
			});
		}

		function kernelStamp(ms) {
			if (!ms) return "还没查过";
			try {
				return new Date(ms).toLocaleString("zh-CN", { hour12: false });
			} catch (err) {
				return String(ms);
			}
		}

		// company-settings-look-v2 building blocks. See LOOK_CSS.
		function el(tag, props) {
			return React.createElement.apply(React, [tag, props || null].concat(Array.prototype.slice.call(arguments, 2)));
		}
		function setPage(title, desc) {
			return el.apply(null, ["div", { className: "cs-set", "data-mark": "company-settings-look-v2" },
				el("h2", { className: "cs-set-title" }, title),
				desc ? el("p", { className: "cs-set-desc" }, desc) : null
			].concat(Array.prototype.slice.call(arguments, 2)));
		}
		function setGroup(key, label, aside, body) {
			return el("section", { className: "cs-set-group", key: key },
				label || aside ? el("div", { className: "cs-set-gh" },
					el("span", { className: "cs-set-gl" }, label || ""),
					aside ? el("span", { className: "cs-set-gx" }, aside) : null
				) : null,
				el("div", { className: "cs-set-card" }, body)
			);
		}
		function setRow(key, o) {
			return el("div", { className: "cs-set-row" + (o.className ? " " + o.className : ""), key: key },
				o.lead || null,
				el("div", { className: "cs-set-main" },
					el("div", { className: "cs-set-rt" }, el("span", null, o.title), o.badges || null),
					o.desc ? el("div", { className: "cs-set-rd" }, o.desc) : null
				),
				o.side ? el("div", { className: "cs-set-side" }, o.side) : null
			);
		}
		function setEmpty(key, text) {
			return el("div", { className: "cs-set-empty", key: key }, text);
		}
		function setNote(text, tone) {
			if (!text) return null;
			return el("p", { className: "cs-set-note" + (tone ? " cs-set-note-" + tone : "") }, text);
		}
		function badge(text, tone, dot) {
			return el("span", { className: "cs-badge" + (tone ? " cs-badge-" + tone : "") }, dot ? el("i") : null, text);
		}
		function avatar(name, online, big, pic) {
			const props = { className: "cs-avatar" + (big ? " cs-avatar-lg" : ""), "aria-hidden": "true" };
			if (online !== undefined) props["data-online"] = online ? "1" : "0";
			if (pic) return el("span", props, el("img", { className: "cs-avatar-img", src: pic, alt: "" }));
			return el("span", props, String(name || "?").trim().charAt(0) || "?");
		}
		function personAvatar(p, online, big) {
			return avatar(displayName(p), online, big, p && p.avatar);
		}
		// Shrink a picked picture to a 128px square in the desk, so only a few
		// kilobytes go to the server and every desk shows the same picture.
		function shrinkAvatar(file) {
			return new Promise(function (resolve, reject) {
				if (!file || !/^image\//.test(file.type || "")) { reject(new Error("avatar-bad")); return; }
				const url = URL.createObjectURL(file);
				const img = new Image();
				img.onload = function () {
					const side = 128;
					const canvas = document.createElement("canvas");
					canvas.width = side;
					canvas.height = side;
					const g = canvas.getContext("2d");
					const crop = Math.min(img.naturalWidth, img.naturalHeight);
					const sx = (img.naturalWidth - crop) / 2;
					const sy = (img.naturalHeight - crop) / 2;
					g.drawImage(img, sx, sy, crop, crop, 0, 0, side, side);
					URL.revokeObjectURL(url);
					let out = canvas.toDataURL("image/webp", 0.86);
					if (out.indexOf("data:image/webp") !== 0) out = canvas.toDataURL("image/jpeg", 0.86);
					resolve(out);
				};
				img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("avatar-bad")); };
				img.src = url;
			});
		}
		function btn(label, o) {
			o = o || {};
			return el("button", {
				type: o.submit ? "submit" : "button",
				key: o.key,
				className: "cs-btn" + (o.tone ? " cs-btn-" + o.tone : "") + (o.small ? " cs-btn-sm" : ""),
				disabled: !!o.disabled,
				onClick: o.onClick
			}, label);
		}
		function selectBox(value, options, onChange, disabled) {
			return el("span", { className: "cs-select-wrap" },
				el("select", {
					className: "cs-select",
					value: value,
					disabled: !!disabled,
					onChange: function (e) { onChange(e.target.value); }
				}, options.map(function (o) {
					return el("option", { key: o.value, value: o.value }, o.label);
				}))
			);
		}
		// Two-step confirm in the page itself. The desk has no system confirm
		// dialog, so window.confirm cannot be relied on for anything destructive.
		function useArm() {
			const hook = React.useState("");
			React.useEffect(function () {
				if (!hook[0]) return;
				const timer = setTimeout(function () { hook[1](""); }, 8000);
				return function () { clearTimeout(timer); };
			}, [hook[0]]);
			return hook;
		}
		const TICK_SVG = el("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
			el("path", { d: "M3.5 8.5 6.5 11.5 12.5 4.5", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }));
		const BOLT_SVG = el("svg", { width: 11, height: 11, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": "true" },
			el("path", { d: "M9.2 1.5 3.5 9h3.8l-.9 5.5L12.5 7H8.6l.6-5.5Z" }));
		function quotaPercent(q) {
			if (!q || !q.loaded || q.err) return null;
			if (q.remainingPercent != null) return Math.max(0, Math.min(100, Number(q.remainingPercent)));
			if (q.usedPercent != null) return Math.max(0, Math.min(100, 100 - Number(q.usedPercent)));
			return null;
		}
		function quotaSub(q) {
			if (!q || !q.loaded) return "正在读取…";
			if (q.err) return "额度接口没接通";
			if (q.kind === "key" && quotaPercent(q) == null) return "走 API key，没有订阅额度";
			if (quotaPercent(q) == null) return "订阅没有返回额度数据";
			const kind = q.kind === "weekly" ? "本周" : (q.kind === "monthly" ? "本月" : "本期");
			const when = quotaWhen(q.resetsAt);
			return (q.plan ? String(q.plan) + " · " : "") + kind + (when ? " · " + when + " 刷新" : "");
		}
		function meter(pct) {
			if (pct == null) return null;
			const tone = pct < 10 ? " cs-meter-err" : (pct < 30 ? " cs-meter-warn" : "");
			return el("div", { className: "cs-meter" + tone }, el("i", { style: { width: pct + "%" } }));
		}
		function useQuota() {
			const qHook = React.useState({ loaded: false, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: "" });
			React.useEffect(function () {
				fetchQuota().then(function (out) {
					const j = out.j || {};
					qHook[1]({
						loaded: true,
						usedPercent: out.ok ? j.usedPercent : null,
						remainingPercent: out.ok ? j.remainingPercent : null,
						plan: (out.ok && j.plan) || "",
						kind: (out.ok && j.kind) || "",
						resetsAt: (out.ok && j.resetsAt) || "",
						err: out.ok ? "" : ((j.error && j.error.message) || j.error || ("http-" + out.status))
					});
				});
			}, []);
			return qHook[0];
		}
		function contextText(n) {
			n = Number(n) || 0;
			if (!n) return "";
			if (n >= 1000000) return (Math.round(n / 100000) / 10) + "M";
			return Math.round(n / 1000) + "K";
		}
		function effortText(e) {
			if (e === "none" || e === "off") return "不推理";
			if (e === "xhigh") return "XHigh";
			return String(e || "").charAt(0).toUpperCase() + String(e || "").slice(1);
		}
		function plugWhy(raw) {
			const t = String(raw || "");
			if (t.indexOf("SELFTEST_FAIL=") === 0) {
				const parts = t.slice(14).split(",").map(function (k) {
					return ({ config: "配置校验", boot: "启动", page: "页面", plugins: "插件激活", shell: "公司外壳", "prefix-missing": "内核文件", "home-missing": "桌面配置" })[k] || k;
				});
				return "试启动失败：" + parts.join("、");
			}
			if (t === "no-output") return "试插进程没有跑起来";
			if (t.indexOf("runner-missing") >= 0) return "服务器缺少 ps-runner.mjs";
			if (t.indexOf("npm-install-failed") >= 0) return "下载安装失败";
			if (t.indexOf("kernel-patch-failed") >= 0) return "公司补丁打不上";
			if (t.indexOf("selftest-failed") >= 0) return "试启动失败";
			return t;
		}
		function upgradeWhy(code, j) {
			const c = String(code || "");
			if (c === "version-mismatch") return "没换上：内核目录里的版本不对（" + ((j && j.got) || "读不到") + "）。";
			if (c === "prefix-missing") return "没换上：这个版本还没装好，先点升级让它试插。";
			if (c === "not-on-npm") return "没换上：npm 上找不到这个版本。";
			if (c === "already-current") return "已经是这个版本了。";
			if (c === "runner-missing" || c === "cutover-script-missing") return "没换上：服务器缺少切换脚本，需要更新。";
			return "没换上：" + (c || "未知原因");
		}
		function lastCutoverNote(cut) {
			if (!cut || !cut.version || !cut.startedAt) return null;
			if (Date.now() - cut.startedAt > 3 * 86400000) return null;
			if (cut.done) return setNote("上次切换到 " + cut.version + " 成功（切换前后都用这台的配置试启动过）。");
			if (cut.reverted) return setNote("上次切换到 " + cut.version + " 没通过试启动，已自动换回 " + (cut.from || "原版本") + (cut.why ? "（" + plugWhy(cut.why) + "）" : "") + "。", "warn");
			return setNote("上次切换到 " + cut.version + " 没有完成，看 kernel-cutover.log。", "err");
		}
		function KernelWatchSection() {
			useShellPulse();
			const snapHook = React.useState(null);
			const errHook = React.useState("");
			const busyHook = React.useState(false);
			const armHook = useArm();
			function pull(force) {
				const opt = force
					? { method: "POST", headers: { "content-type": "application/json" }, body: "{\"action\":\"refresh\"}" }
					: { method: "GET" };
				return fetch("/company/kernel-watch", opt).then(function (res) {
					return res.json().then(function (j) {
						return { ok: res.ok, status: res.status, j: j || {} };
					}, function () { return { ok: false, status: res.status, j: {} }; });
				}, function () { return { ok: false, status: 0, j: {} }; }).then(function (hit) {
					if (!hit.ok || !hit.j || hit.j.ok === false) {
						errHook[1](hit.status === 403 ? "只有管理员能查网页内核。" : "内核口没接通。关掉 TDHarness 再打开一次。");
						return;
					}
					snapHook[1](hit.j);
					pulse();
				});
			}
			React.useEffect(function () {
				let stop = false;
				function tick() {
					if (stop) return;
					pull(false);
				}
				tick();
				const timer = setInterval(tick, 4000);
				return function () {
					stop = true;
					clearInterval(timer);
				};
			}, []);
			function post(body) {
				return fetch("/company/kernel-watch", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				}).then(function (res) {
					return res.json().then(function (j) { return { ok: res.ok, j: j || {} }; }, function () { return { ok: false, j: {} }; });
				}, function () { return { ok: false, j: {} }; });
			}
			function upgrade(target) {
				if (busyHook[0] || !target) return;
				busyHook[1](true);
				errHook[1]("");
				function started(j) {
					return j && (j.phase || j.next || (j.plug && j.plug.running));
				}
				function finish(hit) {
					busyHook[1](false);
					if (!hit.ok || !hit.j || hit.j.ok === false) {
						errHook[1]((hit.j && hit.j.error) ? String(hit.j.error) : "升级没启动。");
						pulse();
						return;
					}
					// The plug note below follows progress; a fixed "installing" line
					// here outlived the attempt it described.
					errHook[1]("");
					pull(true);
				}
				post({ action: "upgrade", version: target }).then(function (hit) {
					// Only an older server that does not know "upgrade" gets the
					// plug-only fallback; any other refusal is shown as it is, so a
					// failed switch no longer looks like a passed plug-in.
					const unknown = !hit.ok && hit.j && /unknown|action/i.test(String(hit.j.error || "")) && !hit.j.phase;
					if (!unknown) {
						if (hit.ok && hit.j && started(hit.j)) { finish(hit); return; }
						busyHook[1](false);
						errHook[1](upgradeWhy(hit.j && hit.j.error, hit.j));
						pull(true);
						return;
					}
					return post({ action: "plug", version: target }).then(finish);
				});
			}
			function cutover(version) {
				if (!version || busyHook[0]) return;
				busyHook[1](true);
				errHook[1]("");
				post({ action: "cutover", version: version }).then(function (hit) {
					busyHook[1](false);
					if (!hit.ok || !hit.j || !hit.j.ok) {
						const code = hit.j && hit.j.error;
						errHook[1](code === "selftest-failed-reverted"
							? "这个版本用这台的配置试启动没通过，已经自动换回原来的版本，桌面不受影响。"
							: ((hit.j && (hit.j.error || hit.j.log)) ? String(hit.j.error || hit.j.log) : "没换上。"));
						pulse();
						return;
					}
					errHook[1](hit.j.next || ("已换成 " + version));
					if (hit.j.phase !== "switching") pull(true);
				});
			}
			function publish() {
				if (busyHook[0]) return;
				busyHook[1](true);
				errHook[1]("");
				post({ action: "publish" }).then(function (hit) {
					busyHook[1](false);
					if (!hit.ok || !hit.j || hit.j.ok === false) {
						errHook[1]((hit.j && hit.j.error) ? String(hit.j.error) : "发版没启动。关掉 TDHarness 再打开一次。");
						pulse();
						return;
					}
					errHook[1](hit.j.next || "正在发版");
					pull(true);
				});
			}
			const snap = snapHook[0] || {};
			const stored = (snap.stored && snap.stored.length) ? snap.stored : (snap.prefixes || []).map(function (row) {
				return { version: row.version, dir: row.dir, sha: "—", size: "—", onNpm: true, local: true };
			});
			const found = (snap.found && snap.found.length) ? snap.found : (snap.githubTag ? [{
				version: String(snap.githubTag).replace(/^dsh-v/, ""),
				tag: snap.githubTag,
				onNpm: true
			}] : []);
			const have = {};
			const updatable = [];
			stored.forEach(function (row) {
				have[row.version] = 1;
				updatable.push({ version: row.version, size: row.size || "", local: true, tag: "dsh-v" + row.version });
			});
			found.forEach(function (row) {
				if (have[row.version]) return;
				updatable.push({ version: row.version, size: "", local: false, tag: row.tag || ("dsh-v" + row.version) });
			});
			const plug = snap.plug;
			const busy = busyHook[0] || !!(plug && plug.running);
			const running = snap.live || snap.pin || "";
			// alpha / beta are previews: listed, never offered as the one-click target.
			function isPreview(v) { return /-(alpha|beta)/i.test(String(v || "")); }
			function minorOf(v) { const m = /^(\d+)\.(\d+)\./.exec(String(v || "")); return m ? m[1] + "." + m[2] : ""; }
			const stable = found.filter(function (r) { return !isPreview(r.version); });
			const newest = (stable[0] && stable[0].version) || (snap.behindNpm && !isPreview(snap.npm) ? snap.npm : "");
			// The company plugins are built for one kernel line (0.2.x now). Going
			// back across lines would start a kernel they do not fit, so that
			// rollback is not offered.
			const rollbackOk = !!(snap.rollback && minorOf(snap.rollback) === minorOf(running));
			function verKey(v) {
				const m = /^(\d+)\.(\d+)\.(\d+)(?:-([A-Za-z]+)\.?(\d+)?)?/.exec(String(v || ""));
				if (!m) return [0, 0, 0, 0, 0];
				const rank = { alpha: 1, beta: 2, rc: 3 };
				return [+m[1], +m[2], +m[3], m[4] ? (rank[m[4]] || 0) : 9, m[5] ? +m[5] : 0];
			}
			function olderThan(a, b) {
				const pa = verKey(a);
				const pb = verKey(b);
				for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i];
				return false;
			}
			const armed = armHook[0];
			function twoStep(key, run) {
				if (armed === key) {
					armHook[1]("");
					run();
				} else {
					armHook[1](key);
				}
			}
			let armText = "";
			if (armed === "rollback") armText = "再点一次「确认回滚」：换回 " + snap.rollback + "，关掉 TDHarness 再打开才生效。";
			else if (armed === "publish") armText = "再点一次「确认发版」：Win 和 Mac 安装包换上 8443，员工下次打开才更新。本机要先测过。";
			else if (armed.indexOf("up:") === 0 && olderThan(armed.slice(3), running)) armText = "再点一次「确认退回」：这台换回 " + armed.slice(3) + "，关掉 TDHarness 再打开才生效。";
			else if (armed.indexOf("up:") === 0) armText = (isPreview(armed.slice(3)) ? armed.slice(3) + " 是预览版，公司插件没在上面验证过。" : "") + "再点一次「确认升级」：这台换成 " + armed.slice(3) + "，还没装过的会先装，关掉再打开才生效。";

			const rows = updatable.length ? updatable.map(function (row) {
				const isRunning = row.version === running;
				const isPin = row.version === snap.pin && !isRunning;
				const key = "up:" + row.version;
				return setRow(row.version, {
					title: row.version,
					badges: [
						isRunning ? el("span", { key: "run" }, badge("运行中", "ok", true)) : null,
						isPin ? el("span", { key: "pin" }, badge("登记版本", "warn")) : null,
						isPreview(row.version) ? el("span", { key: "pre" }, badge("预览版")) : null
					],
					desc: el("span", null,
						el("span", { className: "cs-mono" }, row.tag),
						"  ·  ",
						row.local ? (row.size && row.size !== "—" ? row.size : "已下载") : "未下载"
					),
					side: isRunning ? null : (olderThan(row.version, running)
						? (minorOf(row.version) === minorOf(running)
							? btn(armed === key ? "确认退回" : "退回此版", {
								small: true,
								tone: armed === key ? "danger-solid" : "",
								disabled: busy,
								onClick: function () { twoStep(key, function () { cutover(row.version); }); }
							})
							: el("span", { className: "cs-muted", style: { fontSize: "12px" } }, "旧版本，公司插件不兼容"))
						: btn(armed === key ? "确认升级" : "升级", {
							small: true,
							tone: armed === key ? "primary" : "",
							disabled: busy,
							onClick: function () { twoStep(key, function () { upgrade(row.version); }); }
						}))
				});
			}) : setEmpty("none", "还没有检查到可用版本，点「检查更新」。");

			return setPage("版本",
				snap.lan
					? "这台局域网服务器上的 DSH 内核。升级只换这台和本机 8443 下载包，关掉 TDHarness 再打开才生效。"
					: "从 GitHub Release 发现新版本，试打公司补丁，通过才入库。员工机要等发版才会换。",
				setGroup("now", "当前", null, [
					setRow("live", {
						title: "正在运行",
						desc: snap.pin && snap.pin !== running ? "版本登记里写的是 " + snap.pin + "，和正在运行的不同，升级和回滚会按错的版本算。" : null,
						side: el("span", { className: "cs-mono cs-strong" }, running || "—")
					}),
					rollbackOk ? setRow("rollback", {
						title: "回滚",
						desc: "换回上一版 " + snap.rollback,
						side: btn(armed === "rollback" ? "确认回滚" : "回滚", {
							small: true,
							tone: armed === "rollback" ? "danger-solid" : "danger",
							disabled: busy,
							onClick: function () { twoStep("rollback", function () { cutover(snap.rollback); }); }
						})
					}) : null
				]),
				setGroup("list", "可用版本", "上次检查 " + kernelStamp(snap.checkedAt), rows),
				el("div", { className: "cs-set-actions" },
					btn("检查更新", { disabled: busyHook[0], onClick: function () { pull(true); } }),
					newest && newest !== running ? btn(armed === "up:" + newest ? "确认升级到 " + newest : "升级到 " + newest, {
						tone: "primary",
						disabled: busy,
						onClick: function () { twoStep("up:" + newest, function () { upgrade(newest); }); }
					}) : null,
					snap.lan ? null : btn(armed === "publish" ? "确认发版" : "发版", {
						tone: armed === "publish" ? "primary" : "",
						disabled: busyHook[0] || !!(snap.publish && snap.publish.running),
						onClick: function () { twoStep("publish", publish); }
					})
				),
				setNote(armText, "warn"),
				lastCutoverNote(snap.cutover),
				plug ? setNote(plug.running
					? ("正在试插 " + plug.version + "：安装、打补丁、试启动…")
					: ("上次试插 " + plug.version + (plug.ok ? " 已通过。" : " 没通过，没有换上" + (plug.why ? "（" + plugWhy(plug.why) + "）" : "") + "。")), plug.ok || plug.running ? "" : "err") : null,
				snap.publish ? setNote(snap.publish.running ? "正在发版…" : (snap.publish.ok ? "发版已上 8443。员工下次打开才会换。" : ("发版停住。" + (snap.publish.tail || ""))), snap.publish.ok || snap.publish.running ? "" : "err") : null,
				setNote(errHook[0])
			);
		}

		function AccountSection() {
			useShellPulse();
			const noteHook = React.useState("");
			const busyHook = React.useState(false);
			const doneHook = React.useState(false);
			const editHook = React.useState(null);
			const armHook = useArm();
			const fileRef = React.useRef(null);
			React.useEffect(function () {
				peopleApi(null).catch(function () {});
			}, []);
			function logout() {
				if (busyHook[0] || doneHook[0]) return;
				busyHook[1](true);
				noteHook[1]("");
				fetch("/company/logout", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: "{}"
				}).then(function (res) {
					return res.json().then(function (j) { return { ok: res.ok, j: j }; }, function () {
						return { ok: false, j: {} };
					});
				}).then(function (hit) {
					busyHook[1](false);
					if (!hit.ok || !hit.j || !hit.j.ok) {
						noteHook[1]("退出失败。请完全退出 TDHarness 再打开一次，然后再试。");
						return;
					}
					mailboxLogin = "";
					doneHook[1](true);
					noteHook[1]("已退出，正在回到登录…");
					pulse();
				}, function () {
					busyHook[1](false);
					noteHook[1]("退出失败。请完全退出 TDHarness 再打开一次，然后再试。");
				});
			}
			function saveSelf(body, okNote) {
				if (busyHook[0]) return Promise.resolve(false);
				busyHook[1](true);
				noteHook[1]("");
				return peopleApi(Object.assign({ action: "self" }, body)).then(function () {
					busyHook[1](false);
					noteHook[1](okNote);
					return true;
				}, function (err) {
					busyHook[1](false);
					noteHook[1](peopleErr(err && err.message));
					return false;
				});
			}
			function pickFile(e) {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				shrinkAvatar(file).then(function (pic) {
					saveSelf({ avatar: pic }, "头像已更新，同事那边下次刷新就能看到。");
				}, function () {
					noteHook[1](peopleErr("avatar-bad"));
				});
			}
			const me = mailboxLogin;
			const self = personOf(me);
			const name = self && self.name ? self.name : "";
			const pic = self && self.avatar ? self.avatar : "";
			const editing = editHook[0] !== null;
			const armed = armHook[0] === "logout";
			if (!me) {
				return setPage("账号", null, setGroup("me", null, null, [
					setRow("me", { className: "cs-set-row-tall", lead: avatar("?", undefined, true), title: "未登录", desc: "当前没有登录令牌" })
				]), setNote(noteHook[0]));
			}
			return setPage("账号", null,
				setGroup("me", null, null, [
					el("div", { className: "cs-set-row cs-set-row-tall", key: "me" },
						el("button", {
							type: "button",
							className: "cs-avatar-edit",
							title: "更换头像",
							disabled: busyHook[0],
							onClick: function () { if (fileRef.current) fileRef.current.click(); }
						},
							avatar(name || me, undefined, true, pic),
							el("span", { className: "cs-avatar-cam" }, "更换")
						),
						el("input", { ref: fileRef, type: "file", accept: "image/png,image/jpeg,image/webp", style: { display: "none" }, onChange: pickFile }),
						el("div", { className: "cs-set-main" },
							editing
								? el("form", {
									className: "cs-name-edit",
									onSubmit: function (ev) {
										ev.preventDefault();
										saveSelf({ name: editHook[0] }, "显示名已保存。").then(function (ok) { if (ok) editHook[1](null); });
									}
								},
									el("input", {
										className: "cs-input",
										autoFocus: true,
										maxLength: 20,
										value: editHook[0],
										placeholder: "例如 张三",
										onChange: function (e) { editHook[1](e.target.value); },
										onKeyDown: function (e) { if (e.key === "Escape") editHook[1](null); }
									}),
									btn("保存", { submit: true, small: true, tone: "primary", disabled: busyHook[0] }),
									btn("取消", { small: true, tone: "ghost", onClick: function () { editHook[1](null); } })
								)
								: el("div", { className: "cs-set-rt" },
									el("span", null, name || me),
									badge(peopleRoleText(shellRole), shellRole === "admin" ? "brand" : ""),
									btn("改名", { small: true, tone: "ghost", onClick: function () { editHook[1](name); } })
								),
							el("div", { className: "cs-set-rd" }, "登录名 " + me + "  ·  部门 " + deptName(self && self.dept))
						)
					),
					pic ? setRow("pic", {
						title: "头像",
						desc: "会显示在同事、人员页和侧边栏。",
						side: btn("移除头像", { small: true, tone: "ghost", disabled: busyHook[0], onClick: function () { saveSelf({ avatar: "" }, "头像已移除。"); } })
					}) : null,
					setRow("logout", {
						title: "退出登录",
						desc: "本机账号会立刻清掉，窗口回到登录。",
						side: doneHook[0] ? null : btn(armed ? "确认退出" : "退出登录", {
							small: true,
							tone: armed ? "danger-solid" : "danger",
							disabled: busyHook[0],
							onClick: function () {
								if (armed) {
									armHook[1]("");
									logout();
								} else {
									armHook[1]("logout");
								}
							}
						})
					})
				]),
				setNote(armed ? "再点一次「确认退出」。" : "", "warn"),
				setNote(noteHook[0]),
				setNote("显示名可以用中文；登录名用来登录，不能改。")
			);
		}

		function fetchQuota() {
			return fetch("/company/grok-quota", {
				credentials: "same-origin",
				headers: { "Accept": "application/json" }
			}).then(function (res) {
				return res.json().then(function (j) {
					return { ok: !!(res.ok && j && j.ok !== false), j: j || {}, status: res.status };
				}, function () { return { ok: false, j: {}, status: res.status }; });
			}, function () { return { ok: false, j: {}, status: 0 }; });
		}

		function fetchChannels() {
			return fetch("/company/channels", {
				credentials: "same-origin",
				headers: { "Accept": "application/json" }
			}).then(function (res) {
				return res.json().then(function (j) {
					return { ok: !!(res.ok && j && j.ok !== false), j: j || {}, status: res.status };
				}, function () { return { ok: false, j: {}, status: res.status }; });
			}, function () { return { ok: false, j: {}, status: 0 }; });
		}

		function postChannels(body) {
			return fetch("/company/channels", {
				method: "POST",
				credentials: "same-origin",
				headers: { "Accept": "application/json", "Content-Type": "application/json" },
				body: JSON.stringify(body)
			}).then(function (res) {
				return res.json().then(function (j) {
					return { ok: !!(res.ok && j && j.ok !== false), j: j || {}, status: res.status };
				}, function () { return { ok: false, j: {}, status: res.status }; });
			}, function () { return { ok: false, j: {}, status: 0 }; });
		}

		function channelsErr(out) {
			const j = (out && out.j) || {};
			if (j.hint) return String(j.hint);
			if (j.error && j.error.message) return String(j.error.message);
			if (typeof j.error === "string") return j.error;
			return "http-" + ((out && out.status) || 0);
		}

		function quotaWhen(iso) {
			const n = Date.parse(iso || "");
			if (!n) return "";
			try {
				return new Date(n).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
			} catch (err) {
				return "";
			}
		}

		function quotaLine(q) {
			if (!q || !q.loaded) return "正在读额度…";
			if (q.err) return "额度口未接通：" + String(q.err);
			if (q.kind === "key" && q.usedPercent == null && q.remainingPercent == null) {
				return "当前走 API key，没有订阅剩余额度";
			}
			const used = q.usedPercent == null ? "—" : (Number(q.usedPercent).toFixed(0) + "%");
			const left = q.remainingPercent == null ? "—" : (Number(q.remainingPercent).toFixed(0) + "%");
			const kind = q.kind === "weekly" ? "本周" : (q.kind === "monthly" ? "本月" : "本期");
			const when = quotaWhen(q.resetsAt);
			const plan = q.plan ? (String(q.plan) + " · ") : "";
			return plan + kind + "还剩 " + left + "，已用 " + used + (when ? ("，" + when + " 刷新") : "");
		}

		const KEY_PRESETS = {
			custom: { id: "" },
			openai: { id: "gpt" },
			anthropic: { id: "opus" },
			kimi: { id: "kimi" },
			glm: { id: "glm" }
		};

		function QuotaBanner() {
			const qHook = React.useState({ loaded: false, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: "" });
			React.useEffect(function () {
				fetchQuota().then(function (out) {
					const j = out.j || {};
					if (!out.ok) {
						qHook[1]({ loaded: true, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: (j.error && j.error.message) || j.error || ("http-" + out.status) });
						return;
					}
					qHook[1]({
						loaded: true,
						usedPercent: j.usedPercent,
						remainingPercent: j.remainingPercent,
						plan: j.plan || "",
						kind: j.kind || "",
						resetsAt: j.resetsAt || "",
						err: ""
					});
				});
			}, []);
			return React.createElement("p", {
				className: "cs-sub-quota",
				"data-mark": "company-sub-quota-v1"
			}, "订阅剩余额度 " + quotaLine(qHook[0]));
		}

		var PROXY_ROWS = [
			{ id: "grok", label: "Grok", mark: "grok" },
			{ id: "gpt", label: "GPT", mark: "openai" },
			{ id: "claude", label: "Claude", mark: "claude" }
		];
		// Vendor marks from @lobehub/icons-static-svg 1.95.1 (MIT, LobeHub). The
		// marks are their owners' trademarks and are used here only to name the
		// vendor of each subscription.
		const VENDOR_MARKS = {
			grok: { d: "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815", rule: "evenodd" },
			openai: { d: "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z", rule: "evenodd" },
			claude: { d: "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z", fill: "#D97757" }
		};
		function vendorLogo(id) {
			const m = VENDOR_MARKS[id];
			return el("span", { className: "cs-vendor-logo cs-vendor-logo-" + id, "aria-hidden": "true" },
				m ? el("svg", { width: 18, height: 18, viewBox: "0 0 24 24" },
					el("path", { d: m.d, fill: m.fill || "currentColor", fillRule: m.rule || "nonzero" })) : null);
		}

		function ProxyFold() {
			const q = useQuota();
			const openHook = React.useState("grok");
			const modeHook = React.useState({ grok: "model", gpt: "sub", claude: "sub" });
			const stateHook = React.useState({});
			const noteHook = React.useState("");
			const catHook = React.useState({ grok: [], api: [] });
			const pickHook = React.useState({ grok: {}, api: {} });
			const applyNote = React.useState("");
			const loadedHook = React.useState({});
			function loadSubs() {
				fetchChannels().then(function (out) {
					const j = out.j || {};
					const next = {};
					(j.subscriptions || []).forEach(function (s) {
						if (!s || !s.id) return;
						const id = s.id === "chatgpt" ? "gpt" : s.id;
						next[id] = { bound: s.bound === true, model: s.model || "", hint: s.hint || "" };
					});
					stateHook[1](next);
				});
			}
			React.useEffect(function () {
				loadSubs();
				loadLive("grok");
			}, []);
			function setMode(id, mode) {
				const cur = modeHook[0];
				const next = {};
				for (const k in cur) next[k] = cur[k];
				next[id] = mode;
				modeHook[1](next);
				noteHook[1]("");
				if (mode === "model") loadLive(id);
			}
			function loadLive(id) {
				if (id !== "grok") {
					noteHook[1]("这个订阅还没接通，识别不到可调用模型。");
					return;
				}
				postChannels({ action: "list-models", vendor: "grok" }).then(function (out) {
					const j = out.j || {};
					loadedHook[1](function (prev) { return Object.assign({}, prev, { grok: true }); });
					if (!out.ok) { noteHook[1](channelsErr(out)); return; }
					const cat = {};
					for (const k in catHook[0]) cat[k] = catHook[0][k];
					cat.grok = Array.isArray(j.models) ? j.models : [];
					catHook[1](cat);
					// Tick what this desk already lists, so the page shows the current
					// choice instead of an empty form that looks like nothing was saved.
					postChannels({ action: "picked-models", vendor: "grok" }).then(function (got) {
						const picked = got.ok && got.j && Array.isArray(got.j.models) ? got.j.models : [];
						if (!picked.length) return;
						const bag = {};
						picked.forEach(function (m) {
							const known = cat.grok.find(function (c) { return c.id === m.id; });
							if (!known) return;
							const efforts = {};
							(m.efforts || []).forEach(function (e) { efforts[e] = true; });
							bag[m.id] = { on: true, fast: !!known.fastOn, efforts: efforts, fastEffort: "" };
						});
						putBag("grok", bag);
					});
				});
			}
			function bagOf(vendor) {
				return pickHook[0][vendor] || {};
			}
			function putBag(vendor, bag) {
				pickHook[1](function (prev) {
					const pick = {};
					for (const k in prev) pick[k] = prev[k];
					pick[vendor] = bag;
					return pick;
				});
			}
			function editRow(vendor, id, fn) {
				const bag = {};
				const cur = bagOf(vendor);
				for (const k in cur) bag[k] = cur[k];
				const row = bag[id] || { on: true, fast: false, efforts: {}, fastEffort: "" };
				bag[id] = fn({ on: row.on, fast: row.fast, efforts: Object.assign({}, row.efforts || {}), fastEffort: row.fastEffort || "" });
				putBag(vendor, bag);
				applyNote[1]("");
			}
			function toggleModel(vendor, model, on) {
				editRow(vendor, model.id, function () {
					const efforts = {};
					if (on) (model.efforts || []).forEach(function (e) { efforts[e] = true; });
					return { on: on, fast: on && !!model.fastOn, efforts: efforts, fastEffort: "" };
				});
			}
			function toggleEffort(vendor, id, effort, on) {
				editRow(vendor, id, function (row) {
					row.on = true;
					row.efforts[effort] = on;
					return row;
				});
			}
			function toggleFast(vendor, id, on) {
				editRow(vendor, id, function (row) {
					row.on = true;
					row.fast = on;
					return row;
				});
			}
			function pickedCount(vendor) {
				const bag = bagOf(vendor);
				return Object.keys(bag).filter(function (id) { return bag[id] && bag[id].on; }).length;
			}
			function applyVendor(vendor) {
				const models = [];
				const bag = bagOf(vendor);
				Object.keys(bag).forEach(function (id) {
					const row = bag[id];
					if (!row || !row.on) return;
					const efforts = [];
					Object.keys(row.efforts || {}).forEach(function (e) { if (row.efforts[e]) efforts.push(e); });
					const known = (catHook[0][vendor] || []).find(function (c) { return c.id === id; });
					models.push({ id: id, efforts: efforts, fast: !!row.fast, image: !!(known && known.image), context: (known && known.context) || 0 });
				});
				if (!models.length) { applyNote[1]("先勾选要放进对话框的模型。"); return; }
				applyNote[1]("正在写入…");
				postChannels({ action: "apply-models", vendor: vendor, models: models }).then(function (out) {
					if (!out.ok) { applyNote[1](channelsErr(out)); return; }
					const fastNote = out.j && out.j.fast > 0 ? "其中 " + out.j.fast + " 个走加速通道。" : (out.j && out.j.fast < 0 ? "加速没记上，服务器网关需要更新。" : "");
					applyNote[1]((out.j && out.j.live
						? "已应用 " + models.length + " 个，对话框里现在就能选。"
						: "已写入 " + models.length + " 个。关掉再打开，对话框里就是勾上的。") + fastNote);
				});
			}
			function catalogRows(vendor, models) {
				const bag = bagOf(vendor);
				if (!models || !models.length) {
					return el("div", { className: "cs-vendor-msg" },
						vendor === "grok" && !loadedHook[0].grok ? "正在向订阅要模型列表…" : "这个订阅还没接通，没有可识别的模型。");
				}
				return el("div", { className: "cs-mlist" }, models.map(function (model) {
					const row = bag[model.id] || {};
					const on = row.on === true;
					const ctxText = contextText(model.context);
					return el("div", { className: "cs-mrow" + (on ? "" : " cs-mrow-off"), key: model.id },
						el("button", {
							type: "button",
							role: "checkbox",
							"aria-checked": on,
							"aria-label": model.id,
							className: "cs-tick" + (on ? " is-on" : ""),
							onClick: function () { toggleModel(vendor, model, !on); }
						}, TICK_SVG),
						el("div", { className: "cs-mrow-name" },
							el("span", null, model.id),
							model.image ? badge("识图") : null,
							ctxText ? badge(ctxText + " 上下文") : null
						),
						on ? el("div", { className: "cs-mrow-tiers" },
							model.fast ? el("button", {
								type: "button",
								className: "cs-chip cs-chip-fast" + (row.fast ? " is-on" : ""),
								"aria-pressed": !!row.fast,
								title: "走 xAI 加速通道（priority），出字更快",
								onClick: function () { toggleFast(vendor, model.id, !row.fast); }
							}, BOLT_SVG, "加速") : (model.fastModel ? badge("加速模型", "warn") : null),
							(model.efforts || []).map(function (effort) {
								const lit = !!(row.efforts && row.efforts[effort]);
								return el("button", {
									type: "button",
									key: effort,
									className: "cs-chip" + (lit ? " is-on" : ""),
									"aria-pressed": lit,
									onClick: function () { toggleEffort(vendor, model.id, effort, !lit); }
								}, effortText(effort));
							})
						) : null
					);
				}));
			}
			const cards = PROXY_ROWS.map(function (row) {
				const open = openHook[0] === row.id;
				const mode = modeHook[0][row.id] || "sub";
				const st = stateHook[0][row.id] || {};
				const count = row.id === "grok" ? pickedCount("grok") : 0;
				const body = !open ? null : el("div", { className: "cs-vendor-body" },
					el("div", { className: "cs-vendor-bar" },
						el("div", { className: "cs-seg", role: "tablist" },
							el("button", { type: "button", className: mode === "sub" ? "is-on" : "", onClick: function () { setMode(row.id, "sub"); } }, "登录订阅"),
							el("button", { type: "button", className: mode === "model" ? "is-on" : "", onClick: function () { setMode(row.id, "model"); } }, "选择模型")
						),
						mode === "model" && row.id === "grok" ? el("span", { className: "cs-set-gx" }, "已选 " + count + " 个") : null
					),
					mode === "sub"
						? el("div", { className: "cs-vendor-msg" }, st.bound
							? "订阅已登录，由服务器网关代管登录态，过期会自动续。"
							: "订阅登录要跳到对方账号页，这台还没有这个登录插件。")
						: catalogRows(row.id, catHook[0][row.id] || []),
					mode === "model" && row.id === "grok" ? el("div", { className: "cs-set-foot" },
						el("p", { className: "cs-set-note" }, applyNote[0] || "勾选的模型和档位会出现在对话框的模型菜单里。"),
						btn("应用到对话框", { tone: "primary", onClick: function () { applyVendor("grok"); } })
					) : null
				);
				return el("div", { className: "cs-vendor" + (open ? " is-open" : ""), key: row.id },
					el("button", {
						type: "button",
						className: "cs-vendor-head",
						"aria-expanded": open,
						onClick: function () { openHook[1](open ? "" : row.id); }
					},
						vendorLogo(row.mark),
						el("span", { className: "cs-set-main" },
							el("span", { className: "cs-set-rt" }, el("span", null, row.label)),
							el("span", { className: "cs-set-rd", style: { display: "block" } }, st.bound ? "订阅已登录" + (count ? " · 对话框里 " + count + " 个模型" : "") : "未登录")
						),
						st.bound ? badge("已连接", "ok", true) : badge("未连接"),
						el("span", { className: "cs-vendor-chev", "aria-hidden": "true" })
					),
					body
				);
			});
			const pct = quotaPercent(q);
			return el("div", { className: "cs-set", "data-mark": "company-proxy-fold-v1" },
				el("div", { className: "cs-quota" },
					el("div", { className: "cs-quota-main" },
						el("div", { className: "cs-quota-k" }, "Grok 订阅剩余额度"),
						el("div", { className: "cs-quota-v" }, pct == null ? "—" : Math.round(pct) + "%", el("small", null, quotaSub(q))),
						meter(pct)
					)
				),
				el("section", { className: "cs-set-group" },
					el("div", { className: "cs-set-gh" }, el("span", { className: "cs-set-gl" }, "订阅反代")),
					cards,
					setNote(noteHook[0])
				)
			);
		}

		function ModelsLook() {
			const qHook = React.useState({ loaded: false, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: "" });
			const chHook = React.useState({ loaded: false, rows: [] });
			React.useEffect(function () {
				fetchQuota().then(function (out) {
					const j = out.j || {};
					qHook[1]({
						loaded: true,
						usedPercent: out.ok ? j.usedPercent : null,
						remainingPercent: out.ok ? j.remainingPercent : null,
						plan: (out.ok && j.plan) || "",
						kind: (out.ok && j.kind) || "",
						resetsAt: (out.ok && j.resetsAt) || "",
						err: out.ok ? "" : ((j.error && j.error.message) || j.error || ("http-" + out.status))
					});
				});
				fetchChannels().then(function (out) {
					const j = out.j || {};
					const rows = [];
					const seen = {};
					function push(id, label) {
						const key = String(id || label || "");
						if (!key || seen[key]) return;
						seen[key] = 1;
						rows.push({ id: key, label: label || key });
					}
					(j.subscriptions || []).forEach(function (s) { push(s.id, s.label || s.id); });
					(j.models || []).forEach(function (m) { push(m.id, m.label || m.id); });
					if (!rows.length) {
						push("deepseek", "DeepSeek");
						push("grok", "Grok");
					}
					chHook[1]({ loaded: true, rows: rows });
				});
			}, []);
			return React.createElement("div", { className: "cs-people", "data-mark": "company-models-look-v1" },
				React.createElement("p", { className: "cs-sub-quota" }, "订阅剩余额度 " + quotaLine(qHook[0])),
				React.createElement("h2", null, "模型"),
				React.createElement("p", null, "外观对齐官方列表。模型经公司反代出去，这里不填 API key。"),
				chHook[0].rows.map(function (row) {
					return React.createElement("div", { className: "cs-model-card", key: row.id },
						React.createElement("span", { className: "cs-model-dot" }),
						React.createElement("span", { className: "cs-model-name" }, row.label),
						React.createElement("span", { className: "cs-model-note" }, "公司反代")
					);
				})
			);
		}

		function SubSection() {
			useShellPulse();
			const stHook = React.useState({ loaded: false, enabled: true, grokBound: false, err: "" });
			const qHook = React.useState({ loaded: false, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: "" });
			const chHook = React.useState({ loaded: false, subscriptions: [], models: [], err: "" });
			const formHook = React.useState("");
			const subVendorHook = React.useState("grok");
			const presetHook = React.useState("openai");
			const idHook = React.useState("");
			const upHook = React.useState("");
			const modelsHook = React.useState("");
			const keyHook = React.useState("");
			const noteHook = React.useState("");
			const busyHook = React.useState(false);
			function applyPreset(name) {
				const p = KEY_PRESETS[name] || KEY_PRESETS.custom;
				presetHook[1](name);
				idHook[1](p.id);
				if (name !== "custom") {
					upHook[1]("");
					modelsHook[1]("");
				}
			}
			function loadQuota() {
				qHook[1]({ loaded: false, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: "" });
				fetchQuota().then(function (out) {
					const j = out.j || {};
					if (!out.ok) {
						qHook[1]({ loaded: true, usedPercent: null, remainingPercent: null, plan: "", kind: "", resetsAt: "", err: (j.error && j.error.message) || j.error || ("http-" + out.status) });
						pulse();
						return;
					}
					qHook[1]({
						loaded: true,
						usedPercent: j.usedPercent,
						remainingPercent: j.remainingPercent,
						plan: j.plan || "",
						kind: j.kind || "",
						resetsAt: j.resetsAt || "",
						err: ""
					});
					pulse();
				});
			}
			function loadChannels() {
				fetchChannels().then(function (out) {
					const j = out.j || {};
					if (!out.ok) {
						chHook[1]({ loaded: true, subscriptions: [], models: [], err: channelsErr(out) });
						return;
					}
					chHook[1]({
						loaded: true,
						subscriptions: Array.isArray(j.subscriptions) ? j.subscriptions : [],
						models: Array.isArray(j.models) ? j.models : [],
						err: ""
					});
				});
			}
			React.useEffect(function () {
				if (shellRole !== "admin") return;
				fetch("/company/grok-fast", {
					credentials: "same-origin",
					headers: { "Accept": "application/json" }
				}).then(function (res) {
					return res.json().then(function (j) {
						if (!res.ok || !j || j.ok === false) {
							stHook[1]({ loaded: true, enabled: true, grokBound: false, err: (j && (j.error && j.error.message || j.error)) || ("http-" + res.status) });
							return;
						}
						stHook[1]({
							loaded: true,
							enabled: j.enabled !== false,
							grokBound: j.grokBound === true,
							err: ""
						});
					}, function () {
						stHook[1]({ loaded: true, enabled: true, grokBound: false, err: "http-" + res.status });
					});
				}, function () {
					stHook[1]({ loaded: true, enabled: true, grokBound: false, err: "control-down" });
				});
				loadQuota();
				loadChannels();
			}, [shellRole]);
			if (shellRole !== "admin") return null;
			const st = stHook[0];
			const ch = chHook[0];
			const formMode = formHook[0];
			const bound = st.grokBound ? "办公机 OAuth 在线" : "办公机 OAuth 未读到";
			const fast = st.loaded ? (st.enabled ? "Grok Fast 开" : "Grok Fast 关") : "正在读状态…";
			function runJoin(body, okNote) {
				if (busyHook[0]) return;
				busyHook[1](true);
				noteHook[1]("");
				postChannels(body).then(function (out) {
					busyHook[1](false);
					if (!out.ok) {
						noteHook[1](channelsErr(out));
						return;
					}
					keyHook[1]("");
					noteHook[1](okNote);
					loadChannels();
				});
			}
			const joinRow = React.createElement("div", { className: "cs-join-row", "data-mark": "company-join-channels-v1" },
				React.createElement("button", {
					type: "button",
					className: formMode === "sub" ? "is-on" : "",
					disabled: busyHook[0],
					onClick: function () { formHook[1](formMode === "sub" ? "" : "sub"); noteHook[1](""); }
				}, "加入订阅"),
				React.createElement("button", {
					type: "button",
					className: formMode === "key" ? "is-on" : "",
					disabled: busyHook[0],
					onClick: function () { formHook[1](formMode === "key" ? "" : "key"); noteHook[1](""); }
				}, "加入模型")
			);
			const subForm = formMode !== "sub" ? null : React.createElement("form", {
				onSubmit: function (ev) {
					ev.preventDefault();
					const vendor = String(subVendorHook[0] || "grok");
					runJoin({ action: "add-sub", vendor: vendor }, vendor === "grok" ? "已核对 Grok 订阅" : "已记下");
				}
			},
				React.createElement("label", null, "订阅厂家",
					React.createElement("select", {
						value: subVendorHook[0],
						disabled: busyHook[0],
						onChange: function (e) { subVendorHook[1](e.target.value); }
					},
						React.createElement("option", { value: "grok" }, "Grok（办公机 OAuth）"),
						React.createElement("option", { value: "chatgpt" }, "ChatGPT"),
						React.createElement("option", { value: "claude" }, "Claude")
					)
				),
				React.createElement("p", null, "Grok 正本只在办公 Win。ChatGPT / Claude 账号订阅这轮还没接通，请改用加入模型填 API key。钥匙不下发到这台。"),
				React.createElement("button", { type: "submit", disabled: busyHook[0] }, "确认加入")
			);
			const keyForm = formMode !== "key" ? null : React.createElement("form", {
				onSubmit: function (ev) {
					ev.preventDefault();
					const preset = String(presetHook[0] || "custom");
					const body = {
						action: "add-key",
						preset: preset,
						key: String(keyHook[0] || "")
					};
					if (preset === "custom") {
						body.id = String(idHook[0] || "").trim().toLowerCase();
						body.up = String(upHook[0] || "").trim();
						body.models = String(modelsHook[0] || "").trim();
					} else if (String(modelsHook[0] || "").trim()) {
						body.models = String(modelsHook[0] || "").trim();
					}
					runJoin(body, "已加入模型通道");
				}
			},
				React.createElement("label", null, "预设",
					React.createElement("select", {
						value: presetHook[0],
						disabled: busyHook[0],
						onChange: function (e) { applyPreset(e.target.value); }
					},
						React.createElement("option", { value: "openai" }, "OpenAI / GPT"),
						React.createElement("option", { value: "anthropic" }, "Anthropic / Claude"),
						React.createElement("option", { value: "kimi" }, "Kimi"),
						React.createElement("option", { value: "glm" }, "智谱 GLM"),
						React.createElement("option", { value: "custom" }, "自定义")
					)
				),
				presetHook[0] === "custom" ? React.createElement("label", null, "通道 id",
					React.createElement("input", {
						value: idHook[0],
						disabled: busyHook[0],
						onChange: function (e) { idHook[1](e.target.value); },
						placeholder: "kimi"
					})
				) : null,
				presetHook[0] === "custom" ? React.createElement("label", null, "上游 URL",
					React.createElement("input", {
						value: upHook[0],
						disabled: busyHook[0],
						onChange: function (e) { upHook[1](e.target.value); }
					})
				) : null,
				React.createElement("label", null, "模型名（逗号分隔，可空）",
					React.createElement("input", {
						value: modelsHook[0],
						disabled: busyHook[0],
						onChange: function (e) { modelsHook[1](e.target.value); }
					})
				),
				React.createElement("label", null, "API key（只写 Win，界面不回显）",
					React.createElement("input", {
						type: "password",
						value: keyHook[0],
						disabled: busyHook[0],
						onChange: function (e) { keyHook[1](e.target.value); },
						autoComplete: "off"
					})
				),
				React.createElement("p", null, "员工机仍只打公司网关。key 留在办公 Win。"),
				React.createElement("button", { type: "submit", disabled: busyHook[0] }, "确认加入")
			);
			const channelModels = {
				grok: "grok-4.7, grok-4.6",
				deepseek: "deepseek-v4-pro, deepseek-v4-flash, deepseek-flash"
			};
			function modelCell(id, listed) {
				if (listed && listed.length) return listed.join(", ");
				return channelModels[id] || "—";
			}
			function quotaCell(id) {
				if (id !== "grok") return "无单独额度";
				const q = qHook[0];
				if (!q || !q.loaded) return "正在读…";
				if (q.err) return "未接通";
				const left = q.remainingPercent == null ? "—" : (Number(q.remainingPercent).toFixed(0) + "%");
				const used = q.usedPercent == null ? "—" : (Number(q.usedPercent).toFixed(0) + "%");
				return "剩 " + left + " · 已用 " + used;
			}
			const subRows = (ch.subscriptions || []).map(function (s) {
				return React.createElement("tr", { key: "sub-" + s.id },
					React.createElement("td", null, s.label || s.id),
					React.createElement("td", null, "订阅"),
					React.createElement("td", null, s.bound ? "已接" : "未接"),
					React.createElement("td", null, modelCell(s.id, s.models)),
					React.createElement("td", null, quotaCell(s.id))
				);
			});
			const modelRows = (ch.models || []).map(function (m) {
				const extra = m.id !== "gpt" && m.id !== "opus" && m.id !== "deepseek";
				return React.createElement("tr", { key: "m-" + m.id },
					React.createElement("td", null, m.label || m.id),
					React.createElement("td", null, "key"),
					React.createElement("td", null, m.bound ? "已接" : "未接", extra && m.bound ? React.createElement("button", {
						type: "button",
						className: "cs-kernel-btn",
						disabled: busyHook[0],
						style: { marginLeft: "8px" },
						onClick: function () {
							if (!window.confirm("断开通道 " + m.id + " ？钥匙从办公机去掉。")) return;
							runJoin({ action: "drop-key", id: m.id }, "已断开 " + m.id);
						}
					}, "断开") : null),
					React.createElement("td", null, modelCell(m.id, m.models)),
					React.createElement("td", null, quotaCell(m.id))
				);
			});
			return React.createElement("div", { className: "cs-people" },
				React.createElement("h2", null, "模型"),
				React.createElement("p", null, "Grok 订阅正本只在办公 Win。本机不走 grok.com OAuth，也不装官方订阅插件。钥匙不下发。"),
				React.createElement("p", null, quotaLine(qHook[0])),
				React.createElement("button", {
					type: "button",
					className: "cs-kernel-btn",
					onClick: function () { loadQuota(); }
				}, "刷新额度"),
				React.createElement("p", null, bound + "。 " + fast + "。开关在「快速推理」。"),
				joinRow,
				subForm,
				keyForm,
				noteHook[0] ? React.createElement("p", { className: "cs-people-note" }, noteHook[0]) : null,
				st.err ? React.createElement("p", { className: "cs-people-note" }, "状态口未接通：" + String(st.err)) : null,
				ch.err ? React.createElement("p", { className: "cs-people-note" }, "通道口未接通：" + String(ch.err)) : null,
				React.createElement("div", { className: "cs-sub-wrap" },
					React.createElement("table", { className: "cs-sub-table" },
						React.createElement("thead", null,
							React.createElement("tr", null,
								React.createElement("th", null, "通道"),
								React.createElement("th", null, "种类"),
								React.createElement("th", null, "状态"),
								React.createElement("th", null, "模型"),
								React.createElement("th", null, "额度")
							)
						),
						React.createElement("tbody", null,
							subRows.concat(modelRows).length
								? subRows.concat(modelRows)
								: React.createElement("tr", null, React.createElement("td", { colSpan: 5 }, ch.loaded ? "还没有通道回包" : "正在读通道…"))
						)
					)
				)
			);
		}

		function fmtLoginAt(unix) {
			const n = Number(unix) || 0;
			if (n < 1) return "从未";
			try {
				return new Date(n * 1000).toLocaleString("zh-CN", { hour12: false });
			} catch (err) {
				return String(n);
			}
		}

		function tokText(n) {
			n = Number(n) || 0;
			if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
			if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M";
			if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
			return String(n);
		}
		function FloorSection() {
			useShellPulse();
			const q = useQuota();
			React.useEffect(function () {
				mailboxApi().catch(function () {});
			}, []);
			const rows = floorRows.slice().sort(function (a, b) {
				if (!!b.online !== !!a.online) return a.online ? -1 : 1;
				return (Number(b.tokens_7d) || 0) - (Number(a.tokens_7d) || 0);
			});
			const models = (spendSnap && spendSnap.by_model) || [];
			const total = spendSnap && spendSnap.total ? spendSnap.total : { calls: 0, input: 0, output: 0, cached: 0 };
			const totalTokens = spendSnap && typeof spendSnap.total_tokens === "number" ? spendSnap.total_tokens : 0;
			const days = spendSnap && spendSnap.days ? spendSnap.days : 7;
			const online = rows.filter(function (r) { return r.online; }).length;
			const pct = quotaPercent(q);
			const hit = total.input ? Math.round((total.cached || 0) * 100 / total.input) : 0;
			return setPage("同事", "谁在线、最近用了多少 token。用量来自服务器网关，经网关的模型调用都算在内。",
				el("div", { className: "cs-stats" },
					el("div", { className: "cs-stat" },
						el("div", { className: "cs-stat-k" }, "订阅剩余"),
						el("div", { className: "cs-stat-v" }, pct == null ? "—" : Math.round(pct), pct == null ? null : el("small", null, "%")),
						meter(pct),
						el("div", { className: "cs-stat-s" }, quotaSub(q))
					),
					el("div", { className: "cs-stat" },
						el("div", { className: "cs-stat-k" }, "在线"),
						el("div", { className: "cs-stat-v" }, online, el("small", null, "/ " + rows.length)),
						el("div", { className: "cs-stat-s" }, rows.length ? "按在线、用量排序" : "还没有花名册")
					),
					el("div", { className: "cs-stat" },
						el("div", { className: "cs-stat-k" }, "近 " + days + " 天 token"),
						el("div", { className: "cs-stat-v" }, tokText(totalTokens)),
						el("div", { className: "cs-stat-s" }, (total.calls || 0) + " 次调用" + (total.input ? " · 缓存命中 " + hit + "%" : ""))
					)
				),
				setGroup("people", "成员", rows.length ? rows.length + " 人" : null, rows.length ? rows.map(function (r) {
					const who = personOf(r.login) || r;
					return setRow(r.login, {
						lead: avatar(displayName(who), !!r.online, false, who.avatar),
						title: displayName(who),
						badges: el("span", { key: "role" }, badge(peopleRoleText(r.role), r.role === "admin" ? "brand" : "")),
						desc: (r.online ? "在线" : "离线") + "  ·  " + deptName(who.dept || r.dept) + "  ·  最后登录 " + (fmtLoginAt(r.last_login_unix) || "—"),
						side: el("span", { className: "cs-num cs-strong", title: (r.calls_7d || 0) + " 次调用" }, tokText(r.tokens_7d) + " tok")
					});
				}) : setEmpty("none", "还没有花名册回包")),
				setGroup("models", "按模型", "近 " + days + " 天", models.length ? models.map(function (m) {
					const mh = m.input ? Math.round((m.cached || 0) * 100 / m.input) : 0;
					return setRow(m.key, {
						title: m.key,
						desc: (m.calls || 0) + " 次  ·  输入 " + tokText(m.input) + "  ·  输出 " + tokText(m.output) + (m.input ? "  ·  缓存命中 " + mh + "%" : ""),
						side: el("span", { className: "cs-num cs-strong" }, tokText(m.tokens) + " tok")
					});
				}) : setEmpty("none", "近 " + days + " 天还没有经过网关的调用"))
			);
		}


		function PeopleSection() {
			useShellPulse();
			const loginHook = React.useState("");
			const passHook = React.useState("");
			const roleHook = React.useState("employee");
			const deptHook = React.useState("");
			const nameHook = React.useState("");
			const newDeptHook = React.useState("");
			const renameHook = React.useState(null);
			const noteHook = React.useState("");
			const busyHook = React.useState(false);
			const pendingHook = React.useState(null);
			const rowsHook = React.useState(PEOPLE.filter(function (p) { return p && p.login; }));
			React.useEffect(function () {
				peopleApi(null).then(function () {
					rowsHook[1](PEOPLE.filter(function (p) { return p && p.login; }));
				}, function (err) {
					noteHook[1](peopleErr(err && err.message));
				});
			}, []);
			if (!canManagePeople()) return null;
			function refreshRows() {
				rowsHook[1](PEOPLE.filter(function (p) { return p && p.login; }));
			}
			function runAction(body, okNote) {
				if (busyHook[0]) return;
				busyHook[1](true);
				noteHook[1]("");
				pendingHook[1](null);
				peopleApi(body).then(function (j) {
					refreshRows();
					busyHook[1](false);
					if (body && body.action === "gw-revoke" && j && typeof j.revoked === "number") {
						noteHook[1](okNote + "（" + j.revoked + " 把）");
					} else {
						noteHook[1](okNote);
					}
				}, function (err) {
					busyHook[1](false);
					noteHook[1](peopleErr(err && err.message));
				});
			}
			function pendingOf(login) {
				const p = pendingHook[0];
				return p && p.login === login ? p.kind : "";
			}
			function deptChoices(current) {
				const list = DEPTS.map(function (d) { return { value: d.id, label: d.name }; });
				if (current && !DEPTS.some(function (d) { return d.id === current; })) list.unshift({ value: current, label: current });
				return list;
			}
			const newDept = deptHook[0] || (DEPTS[0] && DEPTS[0].id) || "";
			function roleChoices() {
				const list = [{ value: "employee", label: "员工" }, { value: "director", label: "总监" }];
				if (shellRole === "admin") list.push({ value: "admin", label: "管理员" });
				return list;
			}
			function groupedRows() {
				const groups = {};
				rowsHook[0].forEach(function (p) {
					const d = p.dept || "";
					if (!groups[d]) groups[d] = [];
					groups[d].push(p);
				});
				const order = DEPTS.map(function (d) { return d.id; });
				return Object.keys(groups).sort(function (a, b) {
					const ia = order.indexOf(a);
					const ib = order.indexOf(b);
					return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
				}).map(function (dept) {
					return { dept: dept, people: groups[dept] };
				});
			}
			function headcount(id) {
				return rowsHook[0].filter(function (p) { return p.dept === id; }).length;
			}
			function personRows(p) {
				const off = p.status === "disabled";
				// The people service marks its seed admin; "boss" is the seed on older servers.
				const seed = p.seed === true || p.login === "boss";
				const pending = pendingOf(p.login);
				const busy = busyHook[0];
				const out = [setRow(p.login, {
					className: off ? "cs-set-row-off" : "",
					lead: personAvatar(p),
					title: displayName(p),
					badges: [
						off ? el("span", { key: "st" }, badge("已停用", "err")) : null,
						seed ? el("span", { key: "seed" }, badge("种子管理员", "brand")) : null
					],
					desc: "登录名 " + p.login + (seed ? "  ·  " + peopleRoleText(p.role) + "  ·  " + deptName(p.dept) : ""),
					side: [
						seed ? null : el("span", { key: "role" }, selectBox(p.role || "employee", roleChoices(), function (v) {
							runAction({ action: "set", login: p.login, role: v }, p.login + " → " + peopleRoleText(v));
						}, busy)),
						seed ? null : el("span", { key: "dept" }, selectBox(p.dept || "", deptChoices(p.dept), function (v) {
							runAction({ action: "set", login: p.login, dept: v }, displayName(p) + " → " + deptName(v));
						}, busy)),
						seed ? null : btn(off ? "恢复" : "停用", {
							key: "toggle",
							small: true,
							tone: off ? "" : "danger",
							disabled: busy,
							onClick: function () { pendingHook[1]({ kind: off ? "enable" : "disable", login: p.login }); }
						}),
						seed ? null : btn("吊销令牌", {
							key: "revoke",
							small: true,
							tone: "ghost",
							disabled: busy,
							onClick: function () { pendingHook[1]({ kind: "revoke", login: p.login }); }
						})
					]
				})];
				if (pending) {
					let text = "";
					let go = "";
					let body = null;
					let okNote = "";
					if (pending === "disable") {
						text = "停用后 " + p.login + " 不能登录，模型令牌立刻作废。";
						go = "确定停用";
						body = { action: "disable", login: p.login };
						okNote = "已停用 " + p.login;
					} else if (pending === "enable") {
						text = "恢复后 " + p.login + " 可以再登录。";
						go = "确定恢复";
						body = { action: "enable", login: p.login };
						okNote = "已恢复 " + p.login;
					} else {
						text = p.login + " 当前的模型令牌立刻失效，下次登录会领新的。";
						go = "确定吊销";
						body = { action: "gw-revoke", login: p.login };
						okNote = "已吊销 " + p.login + " 的网关令牌";
					}
					out.push(el("div", { className: "cs-confirm", key: p.login + "-confirm" },
						el("span", null, text),
						btn("取消", { small: true, tone: "ghost", disabled: busy, onClick: function () { pendingHook[1](null); } }),
						btn(go, { small: true, tone: pending === "enable" ? "primary" : "danger-solid", disabled: busy, onClick: function () { runAction(body, okNote); } })
					));
				}
				return out;
			}
			function submit(ev) {
				ev.preventDefault();
				const login = String(loginHook[0] || "").trim().toLowerCase();
				const password = String(passHook[0] || "");
				if (!login || password.length < 8) {
					noteHook[1]("登录名和至少 8 位的初始密码都要填。");
					return;
				}
				runAction({
					action: "add",
					login: login,
					role: roleHook[0] || "employee",
					dept: newDept,
					name: String(nameHook[0] || "").trim(),
					password: password
				}, "已发放 " + login);
				passHook[1]("");
				nameHook[1]("");
			}
			return setPage("人员", "发放账号，管理部门，调整角色。停用会同时吊销这个人的模型令牌。",
				groupedRows().map(function (g) {
					return setGroup(g.dept || "none", "部门 · " + deptName(g.dept), g.people.length + " 人",
						g.people.reduce(function (acc, p) { return acc.concat(personRows(p)); }, []));
				}),
				setGroup("depts", "部门管理", DEPTS.length + " 个部门", DEPTS.map(function (d) {
					const n = headcount(d.id);
					const renaming = renameHook[0] && renameHook[0].id === d.id;
					if (renaming) {
						return el("form", {
							className: "cs-set-row",
							key: d.id,
							onSubmit: function (ev) {
								ev.preventDefault();
								runAction({ action: "dept-rename", id: d.id, name: renameHook[0].name }, "部门已改名为 " + renameHook[0].name);
								renameHook[1](null);
							}
						},
							el("input", {
								className: "cs-input",
								autoFocus: true,
								maxLength: 20,
								value: renameHook[0].name,
								onChange: function (e) { renameHook[1]({ id: d.id, name: e.target.value }); },
								onKeyDown: function (e) { if (e.key === "Escape") renameHook[1](null); }
							}),
							btn("保存", { submit: true, small: true, tone: "primary", disabled: busyHook[0] }),
							btn("取消", { small: true, tone: "ghost", onClick: function () { renameHook[1](null); } })
						);
					}
					return setRow(d.id, {
						title: d.name,
						desc: n ? n + " 人" : "还没有人",
						side: [
							btn("改名", { key: "rename", small: true, tone: "ghost", disabled: busyHook[0], onClick: function () { renameHook[1]({ id: d.id, name: d.name }); } }),
							btn("删除", {
								key: "remove",
								small: true,
								tone: "danger",
								disabled: busyHook[0] || n > 0 || DEPTS.length <= 1,
								onClick: function () { runAction({ action: "dept-remove", id: d.id }, "已删除部门 " + d.name); }
							})
						]
					});
				}).concat([
					el("form", {
						className: "cs-set-row",
						key: "add",
						onSubmit: function (ev) {
							ev.preventDefault();
							const name = String(newDeptHook[0] || "").trim();
							if (!name) { noteHook[1](peopleErr("dept-name-empty")); return; }
							runAction({ action: "dept-add", name: name }, "已新建部门 " + name);
							newDeptHook[1]("");
						}
					},
						el("input", {
							className: "cs-input",
							maxLength: 20,
							value: newDeptHook[0],
							placeholder: "新部门名称，例如 直播运营",
							onChange: function (e) { newDeptHook[1](e.target.value); }
						}),
						btn("新建部门", { submit: true, small: true, disabled: busyHook[0] })
					)
				])),
				el("section", { className: "cs-set-group" },
					el("div", { className: "cs-set-gh" }, el("span", { className: "cs-set-gl" }, "发放新账号")),
					el("form", { className: "cs-set-card", onSubmit: submit },
						el("div", { className: "cs-form" },
							el("label", { className: "cs-field" }, el("span", null, "显示名（可用中文）"),
								el("input", {
									className: "cs-input",
									value: nameHook[0],
									maxLength: 20,
									autoComplete: "off",
									placeholder: "例如 张三",
									onChange: function (e) { nameHook[1](e.target.value); }
								})),
							el("label", { className: "cs-field" }, el("span", null, "登录名（小写字母或数字）"),
								el("input", {
									className: "cs-input",
									value: loginHook[0],
									autoComplete: "off",
									placeholder: "例如 zhangsan",
									onChange: function (e) { loginHook[1](e.target.value); }
								})),
							el("label", { className: "cs-field" }, el("span", null, "初始密码"),
								el("input", {
									className: "cs-input",
									type: "password",
									value: passHook[0],
									autoComplete: "new-password",
									placeholder: "至少 8 位",
									onChange: function (e) { passHook[1](e.target.value); }
								})),
							el("label", { className: "cs-field" }, el("span", null, "角色"),
								selectBox(roleHook[0], roleChoices(), function (v) { roleHook[1](v); })),
							el("label", { className: "cs-field" }, el("span", null, "部门"),
								selectBox(newDept, deptChoices(), function (v) { deptHook[1](v); }))
						),
						el("div", { className: "cs-set-foot" },
							el("p", { className: "cs-set-note" }, "密码只存进 Caddy，这里不保留。"),
							btn("发放账号", { submit: true, tone: "primary", disabled: busyHook[0] })
						)
					)
				),
				setNote(noteHook[0]),
				setNote("种子管理员不能停用或降权，但可以吊销令牌。总监不能设管理员。登录名发放后不能改，显示名可以随时改。")
			);
		}

		function BrandName() {
			return null;
		}

		const DESK_OFFICIAL_IMG = /\.(png|jpe?g|gif|webp)$/;
		const DESK_SKIP_EXT = /\.(exe|dll|scr|bat|cmd|com|msi|dmg|pkg|app)$/;

		function deskFileIsOfficialImage(file) {
			const type = String(file && file.type || "").toLowerCase();
			const name = String(file && file.name || "").toLowerCase();
			if (type === "image/png" || type === "image/jpeg" || type === "image/webp" || type === "image/gif") return true;
			return DESK_OFFICIAL_IMG.test(name);
		}

		function deskLooksLikeFiles(dt) {
			if (!dt) return false;
			const types = dt.types ? Array.prototype.slice.call(dt.types) : [];
			for (let i = 0; i < types.length; i++) {
				const t = String(types[i] || "").toLowerCase();
				if (t === "files" || t.indexOf("file") >= 0 || t === "text/uri-list") return true;
			}
			if (dt.items && dt.items.length) {
				for (let i = 0; i < dt.items.length; i++) {
					if (dt.items[i].kind === "file") return true;
				}
			}
			return !!(dt.files && dt.files.length);
		}

		function deskEventFiles(dt) {
			const out = [];
			const seen = {};
			const add = function (file) {
				if (!file) return;
				const key = String(file.name || "") + ":" + String(file.size || 0);
				if (seen[key]) return;
				seen[key] = 1;
				out.push(file);
			};
			if (dt && dt.files) {
				for (let i = 0; i < dt.files.length; i++) add(dt.files[i]);
			}
			if (dt && dt.items) {
				for (let i = 0; i < dt.items.length; i++) {
					if (dt.items[i].kind === "file" && typeof dt.items[i].getAsFile === "function") {
						add(dt.items[i].getAsFile());
					}
				}
			}
			return out;
		}

		function deskSafeName(name) {
			const base = String(name || "file").replace(/\\/g, "/").split("/").pop() || "file";
			return base.replace(/[^\w.\u4e00-\u9fff-]+/g, "_").slice(0, 180) || "file";
		}

		function deskFileMention(rel) {
			const path = String(rel || "");
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return "";
			if (/\s/u.test(path)) return '@"' + path + '"';
			return "@" + path;
		}

		function deskComposerBox() {
			return document.querySelector("[data-composer-card] textarea")
				|| document.querySelector("[data-composer-seat] textarea")
				|| document.querySelector("textarea[data-phase]");
		}

		// 0.2.x composer is a rich-text editor, not a textarea. Typing through the
		// browser's own insert command is the one path such an editor accepts as
		// real input; setting its text from outside is ignored or undone.
		function deskInsertRich(chunk) {
			const box = document.querySelector("[data-composer-card] [data-composer-input]")
				|| document.querySelector("[data-composer-input]");
			if (!box || box.getAttribute("contenteditable") !== "true") return false;
			try {
				box.focus();
				const sel = window.getSelection();
				const range = document.createRange();
				range.selectNodeContents(box);
				range.collapse(false);
				sel.removeAllRanges();
				sel.addRange(range);
				const cur = String(box.textContent || "");
				const text = (cur && !/\s$/.test(cur) ? " " : "") + chunk + " ";
				return document.execCommand("insertText", false, text) === true;
			} catch (err) {
				return false;
			}
		}

		function deskInsertComposer(chunk, sessionId) {
			if (insertDeskTextFn(chunk, sessionId)) return true;
			if (deskInsertRich(chunk)) return true;
			const ta = deskComposerBox();
			if (!ta || ta.disabled || ta.readOnly) return false;
			const cur = String(ta.value || "");
			const next = cur && !/\s$/.test(cur) ? (cur + " " + chunk) : (cur + chunk);
			const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
			if (desc && desc.set) desc.set.call(ta, next);
			else ta.value = next;
			ta.dispatchEvent(new Event("input", { bubbles: true }));
			return true;
		}

		function deskSessionScope(forcedId) {
			const snap = typeof sessionListFn === "function" ? (sessionListFn() || {}) : {};
			// Never fall back to "the first session in the list": that put files
			// into whichever session happened to sort first.
			const id = forcedId || composerSessionId || snap.current || "";
			if (!id) return null;
			const row = (snap.byId || {})[id] || {};
			let cwd = row.cwd || "";
			if (!cwd && typeof workspaceListFn === "function") {
				const ws = workspaceListFn() || {};
				const wid = ws.current || (ws.ids && ws.ids[0]) || "";
				const wrow = (ws.byId || {})[wid] || {};
				cwd = wrow.path || wrow.cwd || "";
			}
			return { sessionId: id, cwd: cwd };
		}

		function deskInboxDir(cwd) {
			const root = String(cwd || "").replace(/[\\/]+$/, "");
			if (!root) return "";
			const sep = root.indexOf("\\") >= 0 && root.indexOf("/") < 0 ? "\\" : "/";
			return root + sep + "inbox";
		}

		function deskUploadInbox(file, scope, forcedName) {
			const name = forcedName || deskSafeName(file.name);
			const dir = deskInboxDir(scope.cwd);
			if (!dir) return Promise.resolve({ ok: false, name: name, err: "no-cwd" });
			const params = new URLSearchParams({
				sessionId: scope.sessionId,
				dir: dir,
				relativePath: name
			});
			params.set("cwd", scope.cwd);
			return fetch("/sidebar/upload?" + params.toString(), {
				method: "POST",
				headers: { "content-type": "application/octet-stream" },
				body: file,
				credentials: "same-origin"
			}).then(function (res) {
				return res.json().then(function (j) {
					const err = j && j.error && j.error.message ? String(j.error.message) : "";
					return { ok: !!(res.ok && j && j.ok && j.value), name: name, err: err };
				}, function () { return { ok: false, name: name, err: "bad-json" }; });
			}, function () { return { ok: false, name: name, err: "network" }; });
		}

		function deskUniqueName(name, used) {
			let n = deskSafeName(name);
			if (!used[n]) { used[n] = 1; return n; }
			const dot = n.lastIndexOf(".");
			const stem = dot > 0 ? n.slice(0, dot) : n;
			const ext = dot > 0 ? n.slice(dot) : "";
			let i = 2;
			let out = stem + "-" + i + ext;
			while (used[out]) { i += 1; out = stem + "-" + i + ext; }
			used[out] = 1;
			return out;
		}

		// company-native-attachments-v1. 0.2.x has its own attachments: a picture
		// shows as a thumbnail, any other file as a card with its name and type,
		// and the agent is handed the stored file. Give dropped or picked files to
		// that same intake, so they look and behave like the built-in "+ 文件".
		function deskAttachNative(files) {
			const inputs = document.querySelectorAll('input[type="file"]');
			let native = null;
			for (let i = 0; i < inputs.length; i++) {
				if (!inputs[i].closest(".cs-desk-file")) { native = inputs[i]; break; }
			}
			if (!native || typeof DataTransfer !== "function") return false;
			try {
				const dt = new DataTransfer();
				for (let i = 0; i < files.length; i++) dt.items.add(files[i]);
				native.files = dt.files;
				native.dispatchEvent(new Event("change", { bubbles: true }));
				return true;
			} catch (err) {
				return false;
			}
		}

		function landDeskFiles(fileList, sessionId) {
			const files = Array.prototype.slice.call(fileList || []).filter(function (file) {
				const name = String(file && file.name || "").toLowerCase();
				return file && file.size >= 0 && !DESK_SKIP_EXT.test(name);
			});
			if (!files.length) return Promise.resolve(0);
			if (deskAttachNative(files)) return Promise.resolve(files.length);
			const scope = deskSessionScope(sessionId);
			if (!scope) {
				window.alert("文件没写进工作区。先开一个会话再选一次。");
				return Promise.resolve(0);
			}
			if (!deskInboxDir(scope.cwd)) {
				window.alert("当前会话没有工作区路径。新开一个会话再拖。");
				return Promise.resolve(0);
			}
			const used = {};
			const jobs = files.map(function (file) {
				const name = deskUniqueName(file.name, used);
				return deskUploadInbox(file, scope, name).then(function (land) {
					if (land && land.ok) return deskFileMention("inbox/" + land.name);
					return "";
				});
			});
			return Promise.all(jobs).then(function (parts) {
				const body = parts.filter(Boolean).join(" ");
				if (!body) {
					window.alert("文件没写进工作区。点输入框旁的「文件」再选一次。");
					return 0;
				}
				if (!deskInsertComposer(body, scope.sessionId)) {
					window.alert("文件已放入 inbox/，点一下对话输入框。");
				}
				return parts.filter(Boolean).length;
			});
		}

		function deskSplitDropped(dt) {
			const files = deskEventFiles(dt).filter(function (file) {
				const name = String(file && file.name || "").toLowerCase();
				return file && file.size >= 0 && !DESK_SKIP_EXT.test(name);
			});
			const images = [];
			const extra = [];
			for (let i = 0; i < files.length; i++) {
				if (deskFileIsOfficialImage(files[i])) images.push(files[i]);
				else extra.push(files[i]);
			}
			return { images: images, extra: extra, files: files };
		}

		function deskFilesFromEntry(entry, prefix) {
			if (!entry) return Promise.resolve([]);
			if (entry.isFile) {
				return new Promise(function (resolve) {
					entry.file(function (file) { resolve(file ? [file] : []); }, function () { resolve([]); });
				});
			}
			if (!entry.isDirectory || typeof entry.createReader !== "function") return Promise.resolve([]);
			const reader = entry.createReader();
			const kids = [];
			const drain = function () {
				return new Promise(function (resolve) {
					reader.readEntries(function (batch) { resolve(batch || []); }, function () { resolve([]); });
				}).then(function (batch) {
					if (!batch.length) return kids;
					for (let i = 0; i < batch.length; i++) kids.push(batch[i]);
					return drain();
				});
			};
			return drain().then(function (list) {
				return Promise.all(list.map(function (child) {
					return deskFilesFromEntry(child, prefix + (entry.name || "") + "/");
				})).then(function (parts) {
					const out = [];
					for (let i = 0; i < parts.length; i++) {
						for (let j = 0; j < parts[i].length; j++) out.push(parts[i][j]);
					}
					return out;
				});
			});
		}

		function deskLandFromDrop(dt) {
			const entries = [];
			if (dt && dt.items) {
				for (let i = 0; i < dt.items.length; i++) {
					const item = dt.items[i];
					if (!item || item.kind !== "file") continue;
					if (typeof item.webkitGetAsEntry === "function") {
						const entry = item.webkitGetAsEntry();
						if (entry) entries.push(entry);
					}
				}
			}
			const fallback = deskEventFiles(dt);
			const ready = entries.length
				? Promise.all(entries.map(function (entry) { return deskFilesFromEntry(entry, ""); })).then(function (parts) {
					const out = [];
					for (let i = 0; i < parts.length; i++) {
						for (let j = 0; j < parts[i].length; j++) out.push(parts[i][j]);
					}
					return out.length ? out : fallback;
				})
				: Promise.resolve(fallback);
			return ready.then(function (files) {
				if (!files || !files.length) {
					window.alert("没拿到文件。请点输入框旁的「文件」选择。");
					return 0;
				}
				return landDeskFiles(files);
			});
		}

		function ensureDeskDropLayer() {
			if (typeof document === "undefined" || !document.body) return null;
			let el = document.getElementById("cs-desk-drop");
			if (el) return el;
			el = document.createElement("div");
			el.id = "cs-desk-drop";
			el.className = "cs-desk-drop";
			el.setAttribute("aria-hidden", "true");
			const card = document.createElement("div");
			card.className = "cs-desk-drop-card";
			const title = document.createElement("div");
			title.className = "cs-desk-drop-title";
			title.textContent = "放到此处即可添加文件";
			const desc = document.createElement("div");
			desc.className = "cs-desk-drop-desc";
			desc.textContent = "可多选，表格、文档、图片都可以";
			card.appendChild(title);
			card.appendChild(desc);
			el.appendChild(card);
			document.body.appendChild(el);
			return el;
		}

		function showDeskDropLayer(on) {
			const el = ensureDeskDropLayer();
			if (!el) return;
			if (on) el.classList.add("cs-desk-drop-on");
			else el.classList.remove("cs-desk-drop-on");
		}

		function dismissOfficialImageDrop() {
			if (typeof document !== "undefined" && document.querySelectorAll) {
				const masks = document.querySelectorAll(".BInVoG_mask");
				for (let i = 0; i < masks.length; i++) {
					masks[i].style.setProperty("display", "none", "important");
				}
			}
		}

		function installDeskFileDrop() {
			if (typeof document === "undefined") return;
			if (window.__companyDeskDrop >= 10) {
				ensureDeskDropLayer();
				return;
			}
			window.__companyDeskDrop = 10;
			const cap = true;
			const arm = function (event) {
				if (!deskLooksLikeFiles(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
				showDeskDropLayer(true);
			};
			document.addEventListener("dragenter", arm, cap);
			document.addEventListener("dragover", arm, cap);
			document.addEventListener("dragleave", function (event) {
				if (!deskLooksLikeFiles(event.dataTransfer)) return;
				event.stopPropagation();
				const left = event.clientX <= 0 || event.clientY <= 0
					|| event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
				if (left) showDeskDropLayer(false);
			}, cap);
			document.addEventListener("drop", function (event) {
				if (!deskLooksLikeFiles(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				showDeskDropLayer(false);
				dismissOfficialImageDrop();
				deskLandFromDrop(event.dataTransfer);
			}, cap);
			if (window && typeof window.addEventListener === "function") {
				window.addEventListener("keydown", function (event) {
					if (event.key === "Escape") showDeskDropLayer(false);
				});
				window.addEventListener("dragend", function () { showDeskDropLayer(false); });
				window.addEventListener("mouseup", function () { showDeskDropLayer(false); });
			}
			ensureDeskDropLayer();
		}

		function DeskFileButton(props) {
			const sessionId = props && props.sessionId;
			composerSessionId = sessionId ? String(sessionId) : "";
			const inputRef = React.useRef(null);
			const busyHook = React.useState(false);
			return React.createElement("span", { className: "cs-desk-file", title: "添加文件，可多选" },
				React.createElement("button", {
					type: "button",
					className: "cs-desk-file-btn",
					disabled: busyHook[0],
					onClick: function () {
						if (inputRef.current) inputRef.current.click();
					}
				}, "文件"),
				React.createElement("input", {
					ref: inputRef,
					type: "file",
					multiple: true,
					style: { display: "none" },
					onChange: function (e) {
						const files = e.target.files;
						e.target.value = "";
						busyHook[1](true);
						landDeskFiles(files, sessionId).then(function () { busyHook[1](false); }, function () { busyHook[1](false); });
					}
				})
			);
		}

		function apply(ctx) {
			shellRole = readDeskRole();
			fetchLoginRole();
			closeDetailsFn = function () {
				if (ctx.layout && typeof ctx.layout.closeDetails === "function") {
					ctx.layout.closeDetails();
				}
			};
			startSessionFn = function (workspaceId) {
				deskStartSession(ctx, workspaceId);
			};
			openSessionFn = function (sessionId) {
				if (sessionId) ctx.sessions.open(sessionId);
			};
			clearSessionFn = function () {
				ctx.sessions.clear();
			};
			sessionListFn = function () {
				return ctx.sessions.list.getSnapshot();
			};
			insertDeskTextFn = function (chunk, sessionId, replace) {
				try {
					const snap = ctx.sessions.list.getSnapshot() || {};
					const id = sessionId || composerSessionId || snap.current || "";
					if (!id) return false;
					const actx = ctx.sessions.scope(id);
					const conversation = typeof actx.get === "function" ? actx.get("conversation") : null;
					if (!conversation || !conversation.input) return false;
					const input = conversation.input.for(actx);
					const state = input.state.getSnapshot();
					const draft = String(state.draft || "");
					// The trailing space ends the @-token, so the file picker that the
					// "@" opens closes again instead of sitting over the composer.
					// replace: the chunk becomes the whole draft (an opening line must
					// not pile onto one left from an earlier try).
					const text = replace ? chunk : (draft && !/\s$/.test(draft) ? " " : "") + chunk + " ";
					actx.emit("slash/input-insert-text", {
						text: text,
						span: {
							start: replace ? 0 : draft.length,
							end: draft.length,
							draftRev: state.draftRev || 0
						}
					});
					return true;
				} catch (err) {
					return false;
				}
			};
			installDeskFileDrop();
			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "company-desk-files",
					order: 0,
					inject: function (sessionId) {
						return { sessionId: sessionId };
					}
				}, DeskFileButton);
			});
			workspaceListFn = function () {
				try {
					if (!ctx.workspaces || !ctx.workspaces.list) return null;
					return ctx.workspaces.list.getSnapshot();
				} catch (err) {
					return null;
				}
			};
			try {
				const remote = typeof ctx.get === "function" ? ctx.get("remote.artifact") : undefined;
				if (remote && typeof remote.listArtifacts === "function") {
					listArtifactsFn = function (q) { return remote.listArtifacts(q || {}); };
				}
			} catch (err) {}
			pullHungArtifacts();
			if (ctx.sessions.list && typeof ctx.sessions.list.subscribe === "function") {
				ctx.sessions.list.subscribe(function () {
					claimAwaitingSession();
					pulse();
				});
			}
			if (ctx.workspaces.list && typeof ctx.workspaces.list.subscribe === "function") {
				ctx.workspaces.list.subscribe(function () { pulse(); });
			}

			// Global panels (the official plugin manager registers "plugins" here).
			// The shipped sidebar row used to list them; ours does now, above the
			// workspaces, the same way.
			const PANEL_NAMES = { plugins: "插件", schedules: "定时任务" };
			const panelSubs = new Set();
			let panelRows = [];
			function syncPanels() {
				let next = [];
				try {
					next = ctx.slots.entriesOfSlot("sidebar.panellist").map(function (entry) {
						const o = (entry && entry.options) || {};
						let label = o.label;
						try { if (typeof label === "function") label = label(); } catch (err) { label = ""; }
						return { id: o.id, order: o.order || 0, label: PANEL_NAMES[o.id] || String(label || o.id || "") };
					}).filter(function (r) { return !!r.id; }).sort(function (a, b) { return a.order - b.order; });
				} catch (err) {
					next = [];
				}
				const same = next.length === panelRows.length && next.every(function (r, i) {
					return r.id === panelRows[i].id && r.label === panelRows[i].label;
				});
				if (same) return;
				panelRows = next;
				panelSubs.forEach(function (fn) { fn(); });
			}
			const panelStore = {
				subscribe: function (fn) {
					panelSubs.add(fn);
					return function () { panelSubs.delete(fn); };
				},
				getSnapshot: function () { return panelRows; }
			};
			try { ctx.slots.subscribe("sidebar.panellist", syncPanels); } catch (err) {}

			ctx.slots.inject("sidebar", function () {
				return ctx.slots.register({
					name: "sidebar",
					id: "company-sidebar",
					// Owning the area means re-declaring what the shipped row used to
					// declare. All five surveyed children keep their homes, so every
					// shipped occupant (workspace tree, settings, brand, footer) still
					// has somewhere to land.
					children: {
						"sidebar.panellist": { kind: "list", scope: "root" },
						"sidebar.workspaces": { kind: "single", scope: "root" },
						"sidebar.settings": { kind: "single", scope: "root" },
						"sidebar.footer.action": { kind: "list", scope: "root" },
						"sidebar.brand.mark": { kind: "single", scope: "root" },
						"sidebar.brand.name": { kind: "single", scope: "root" }
					},
					inject: function () {
						return {
							startSession: function (workspaceId) {
								deskStartSession(ctx, workspaceId);
							},
							toggleSidebar: function () {
								ctx.layout.toggleSidebar();
							},
							selectPanel: function (id) {
								try { ctx.layout.selectPanel(id); } catch (err) {}
							},
							panelStore: panelStore,
							panelInfo: ctx.layout.panelInfo
						};
					}
				}, CompanySidebar);
			});
			syncPanels();

			ctx.slots.inject("shell.overlay", function () {
				return ctx.slots.register({
					name: "shell.overlay",
					id: "company-task-inspector",
					order: 20
				}, TaskInspector);
			});

			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "company-account",
					order: 15,
					label: "账号"
				}, AccountSection);
			});
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "company-people",
					order: 20,
					label: "人员"
				}, PeopleSection);
			});
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "company-floor",
					order: 18,
					label: "同事"
				}, FloorSection);
			});
			ctx.slots.inject("settings.models.header", function () {
				return ctx.slots.register({
					name: "settings.models.header",
					id: "company-proxy-fold",
					order: 0
				}, ProxyFold);
			});
			ctx.slots.inject("settings.section", function () {
				return ctx.slots.register({
					name: "settings.section",
					id: "company-kernel-watch",
					order: 58,
					label: "版本"
				}, KernelWatchSection);
			});

			ctx.slots.inject("sidebar.brand.mark", function () {
				return ctx.slots.register({
					name: "sidebar.brand.mark",
					id: "company-brand-mark"
				}, BrandMark);
			});
			ctx.slots.inject("sidebar.brand.name", function () {
				return ctx.slots.register({
					name: "sidebar.brand.name",
					id: "company-brand-name"
				}, BrandName);
			});
			ctx.slots.inject("conversation.hero.brand.mark", function () {
				return ctx.slots.register({
					name: "conversation.hero.brand.mark",
					id: "company-hero-mark"
				}, BrandMark);
			});
			ctx.slots.inject("conversation.input.left", function () {
				return ctx.slots.register({
					name: "conversation.input.left",
					id: "company-task-inject",
					order: 0
				}, ComposerInjector);
			});
			ctx.slots.inject("conversation.session.header.actions", function () {
				return ctx.slots.register({
					name: "conversation.session.header.actions",
					id: "company-task-assoc",
					order: 0,
					label: "关联任务"
				}, AssociateTaskControl);
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
