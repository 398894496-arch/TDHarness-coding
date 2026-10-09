"""生成的图片、视频在对话里直接显示，并能一键下载（幂等）。

1. dsh-better-sidebar/lib/index.js：会话内相对路径（如 artifacts/x.mp4）按会话工作目录解析。
   原来原样传给 requireAbsolute，下载路由回 400「is not an absolute path」，WebView2 把这段
   JSON 存成失败的 file.json。
2. dsh-better-sidebar/lib/client.js：侧边栏文件预览工具栏加常驻「下载到本机」按钮。
3. company-grok-media/lib/index.js：generate_image / generate_video 返回绝对路径。
4. 内核 dsh-client-ui-deliverables/lib/client.js：AI 交付（present）的文件卡片，图片在对话里
   显示缩略图（点开在侧边栏看大图），视频显示播放器，每张卡片加「下载」按钮；字节走
   dsh-better-sidebar 的 /sidebar/file 路由（两个客户端包都带）。
"""
import sys
from pathlib import Path

MARK_RESOLVE = "company-sidebar-relative-path-v1"
MARK_BUTTON = "company-sidebar-download-button-v1"
MARK_MEDIA = "company-media-absolute-paths-v1"
MARK_CARD = "company-presented-inline-media-v1"


def edit_text(text: str, marker: str, old: str, new: str) -> tuple[str, str]:
    if marker in text:
        return text, "already"
    if text.count(old) != 1:
        raise SystemExit("anchor-missing:" + marker)
    return text.replace(old, new, 1), "patched"


def patch_sidebar_index(t: str) -> tuple[str, str]:
    return edit_text(t, MARK_RESOLVE,
        "function resolveSessionPath(cwd, target, platform = process.platform) {\n",
        "function resolveSessionPath(cwd, target, platform = process.platform) {\n"
        "\t// " + MARK_RESOLVE + ": a session-relative path resolves under the session cwd.\n"
        "\tif (typeof cwd === \"string\" && cwd !== \"\" && typeof target === \"string\" && target !== \"\" && !isAbsolute(target)) return join(cwd, target);\n")


def patch_sidebar_client(t: str) -> tuple[str, str]:
    old_btn = (
        "\t\t\t\t\t\ttoolbar !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n"
        "\t\t\t\t\t\t\ttype: \"button\",\n"
        "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
        "\t\t\t\t\t\t\t\"aria-label\": t(\"refresh\"),\n"
    )
    new_btn = (
        "\t\t\t\t\t\t// " + MARK_BUTTON + ": download any open file (images and videos too).\n"
        "\t\t\t\t\t\t!showEmpty && !isDir && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"a\", {\n"
        "\t\t\t\t\t\t\tclassName: sidebar_module_css_default.iconButton,\n"
        "\t\t\t\t\t\t\thref: downloadUrl(scope, path),\n"
        "\t\t\t\t\t\t\tdownload: true,\n"
        "\t\t\t\t\t\t\t\"aria-label\": \"下载到本机\",\n"
        "\t\t\t\t\t\t\ttitle: \"下载到本机\",\n"
        "\t\t\t\t\t\t\tchildren: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 14 })\n"
        "\t\t\t\t\t\t}),\n"
        + old_btn
    )
    return edit_text(t, MARK_BUTTON, old_btn, new_btn)


def patch_grok_media(t: str) -> tuple[str, str]:
    t, how = edit_text(t, MARK_MEDIA,
        "    writeFileSync(join(process.cwd(), rel), raw);\n    paths.push(rel.replace(/\\\\/g, \"/\"));\n",
        "    // " + MARK_MEDIA + ": hand back the absolute path, the same one preview,\n"
        "    // download and show-in-folder use, whatever workspace the session is in.\n"
        "    const abs = join(process.cwd(), rel);\n"
        "    writeFileSync(abs, raw);\n"
        "    paths.push(abs);\n")
    t = t.replace("Writes PNG/JPEG under artifacts/ and returns those workspace-relative paths.",
                  "Writes PNG/JPEG under artifacts/ and returns their absolute paths; present them so the person can preview and download.")
    t = t.replace("Writes MP4 under artifacts/. Optional image_path",
                  "Writes MP4 under artifacts/ and returns its absolute path; present it so the person can preview and download. Optional image_path")
    return t, how


CARD_HELPERS = """		// company-presented-inline-media-v1: inline image/video and a download link
		// for presented files, served by dsh-better-sidebar's /sidebar/file route.
		const COMPANY_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp"]);
		const COMPANY_VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);
		function companyMediaKind(path) {
			const ext = String(path).split(/[\\\\/]/).pop().split(".").pop().toLowerCase();
			return COMPANY_IMAGE_EXT.has(ext) ? "image" : COMPANY_VIDEO_EXT.has(ext) ? "video" : null;
		}
		function companyFileRoute(sessionId, cwd, path, download) {
			const params = new URLSearchParams({ sessionId: String(sessionId || ""), path });
			if (cwd) params.set("cwd", cwd);
			if (download) params.set("download", "1");
			return "/sidebar/file?" + params.toString();
		}
		function CompanyPresentedMedia({ sessionId, cwd, path, onPreview }) {
			const kind = companyMediaKind(path);
			if (kind === null) return null;
			const src = companyFileRoute(sessionId, cwd, path, false);
			const box = { display: "block", maxWidth: "100%", maxHeight: 360, borderRadius: 8, marginTop: 6, background: "#000" };
			if (kind === "image") return (0, react_jsx_runtime.jsx)("img", {
				src,
				alt: path,
				title: "点开查看大图",
				loading: "lazy",
				style: { ...box, background: "transparent", cursor: "zoom-in" },
				onClick: onPreview
			});
			return (0, react_jsx_runtime.jsx)("video", {
				src,
				controls: true,
				preload: "metadata",
				playsInline: true,
				style: box
			});
		}
		function CompanyDownloadLink({ sessionId, cwd, path }) {
			return (0, react_jsx_runtime.jsx)("a", {
				href: companyFileRoute(sessionId, cwd, path, true),
				download: true,
				title: "下载到本机",
				"aria-label": "下载到本机",
				"data-company-download": true,
				onClick: (event) => { event.stopPropagation(); },
				style: { position: "relative", zIndex: 2, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, marginRight: 4, borderRadius: 6, border: "1px solid var(--color-border-default, rgba(0,0,0,.15))", color: "inherit" },
				children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDownloadOutlineRegular, { size: 16 })
			});
		}
"""


def patch_presented_card(t: str) -> tuple[str, str]:
    if MARK_CARD in t:
        return t, "already"
    steps = [
        ("\t\tfunction PresentedFileCard({ file, cwd, phase, host, onPreview, actions, t }) {\n",
         CARD_HELPERS + "\t\tfunction PresentedFileCard({ file, cwd, phase, host, onPreview, actions, t, sessionId }) {\n"
         "\t\t\tconst companyPath = resolveWorkspacePath(cwd, file.path);\n"),
        ("\t\t\t\t\t\t}), (0, react_jsx_runtime.jsx)(\"div\", {\n"
         "\t\t\t\t\t\t\tclassName: Deliverables_module_css_default.actions,\n"
         "\t\t\t\t\t\t\tchildren: actions\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t}\n",
         "\t\t\t\t\t\t}), (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\t\t\t\tclassName: Deliverables_module_css_default.actions,\n"
         "\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(CompanyDownloadLink, { sessionId, cwd, path: companyPath }), actions]\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t}\n"),
        ("\t\t\treturn (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\tclassName: Deliverables_module_css_default.file,\n"
         "\t\t\t\t\"data-presented-file\": true,\n",
         "\t\t\tconst companyCard = (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\tclassName: Deliverables_module_css_default.file,\n"
         "\t\t\t\t\"data-presented-file\": true,\n"),
        ("\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(CompanyDownloadLink, { sessionId, cwd, path: companyPath }), actions]\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t}\n",
         "\t\t\t\t\t\t\tchildren: [(0, react_jsx_runtime.jsx)(CompanyDownloadLink, { sessionId, cwd, path: companyPath }), actions]\n"
         "\t\t\t\t\t\t})]\n"
         "\t\t\t\t\t})\n"
         "\t\t\t\t]\n"
         "\t\t\t});\n"
         "\t\t\tif (companyMediaKind(companyPath) === null) return companyCard;\n"
         "\t\t\treturn (0, react_jsx_runtime.jsxs)(\"div\", {\n"
         "\t\t\t\t\"data-company-presented-media\": true,\n"
         "\t\t\t\tstyle: { display: \"flex\", flexDirection: \"column\", minWidth: 0 },\n"
         "\t\t\t\tchildren: [companyCard, (0, react_jsx_runtime.jsx)(CompanyPresentedMedia, { sessionId, cwd, path: companyPath, onPreview })]\n"
         "\t\t\t});\n"
         "\t\t}\n"),
        ("\t\t\t\t\t\tchildren: presented.map((file) => (0, react_jsx_runtime.jsx)(PresentedFileCard, {\n"
         "\t\t\t\t\t\t\tfile,\n"
         "\t\t\t\t\t\t\tcwd,\n",
         "\t\t\t\t\t\tchildren: presented.map((file) => (0, react_jsx_runtime.jsx)(PresentedFileCard, {\n"
         "\t\t\t\t\t\t\tfile,\n"
         "\t\t\t\t\t\t\tcwd,\n"
         "\t\t\t\t\t\t\tsessionId,\n"),
    ]
    for old, new in steps:
        if t.count(old) != 1:
            raise SystemExit("card-anchor-missing:" + old[:60].replace("\n", "|"))
        t = t.replace(old, new, 1)
    return t, "patched"


# rel 后缀 -> 补丁函数（rel 是相对 CompanyDesk/ 的路径）
TARGETS = (
    ("dsh-better-sidebar/lib/index.js", patch_sidebar_index),
    ("dsh-better-sidebar/lib/client.js", patch_sidebar_client),
    ("company-grok-media/lib/index.js", patch_grok_media),
    ("@deepseek-ai/dsh-client-ui-deliverables/lib/client.js", patch_presented_card),
)


def for_member(rel: str):
    for suffix, fn in TARGETS:
        if rel.endswith(suffix):
            return fn
    return None


if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a)
        fn = for_member(p.as_posix())
        if fn is None:
            print(a, "no-target")
            continue
        raw = p.read_text(encoding="utf-8")
        crlf = "\r\n" in raw
        t, how = fn(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
