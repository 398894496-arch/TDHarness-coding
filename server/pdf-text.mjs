// The text of one PDF, for the knowledge search (kb-index.js runs this as a child process,
// so a broken or huge file cannot take the search down with it).
//   node pdf-text.mjs <file.pdf>
// stdout: the text, one "## 第 N 页" heading per page, a line break where pdf.js ends a line
// or the baseline moves. Exit 0 with empty output: the PDF has no text layer (a scan).
// Exit 2: unreadable (damaged, password-protected). Uses the vendored pdf.js in ./vendor/pdfjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.join(here, "vendor", "pdfjs");
const MAX_PAGES = 1000;

// pdf.js prints its warnings with console.log, to stdout, where they would become indexed
// text (the first one, at load, is that it has no canvas: text extraction draws nothing).
// The text goes out through process.stdout.write only.
console.log = () => {};
console.warn = () => {};
console.info = () => {};
const pdfjs = await import(pathToFileURL(path.join(lib, "pdf.mjs")).href);
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(lib, "pdf.worker.mjs")).href;

const file = process.argv[2];
let doc;
try {
	doc = await pdfjs.getDocument({
		data: new Uint8Array(fs.readFileSync(file)),
		cMapUrl: path.join(lib, "cmaps") + path.sep,
		cMapPacked: true,
		isEvalSupported: false,
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: 0,
	}).promise;
} catch (e) {
	process.stderr.write("pdf-unreadable " + String((e && e.name) || e) + "\n");
	process.exit(2);
}

const out = [];
let chars = 0;
for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
	const page = await doc.getPage(n);
	const tc = await page.getTextContent();
	let line = "";
	const lines = [];
	let y = null;
	for (const it of tc.items) {
		if (typeof it.str !== "string") continue;
		const ty = it.transform ? it.transform[5] : y;
		if (y !== null && ty !== null && Math.abs(ty - y) > 2 && line.trim()) { lines.push(line); line = ""; }
		line += it.str;
		y = ty;
		if (it.hasEOL) { lines.push(line); line = ""; }
	}
	if (line.trim()) lines.push(line);
	// Many Chinese fonts map some characters to Kangxi radicals (⼆ U+2F06 for 二): fold them.
	const text = lines.map((l) => l.replace(/\s+$/, "").replace(/[\u2e80-\u2fdf]/g, (c) => c.normalize("NFKC")))
		.filter((l) => l.trim()).join("\n");
	page.cleanup();
	if (!text) continue;
	out.push("## 第 " + n + " 页\n" + text);
	chars += text.length;
	if (chars > (2 << 20)) break;
}
await doc.destroy();
process.stdout.write(out.join("\n\n"));
