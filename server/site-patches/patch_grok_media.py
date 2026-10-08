"""company-grok-media：生成的图直接显示在对话里（存进 DSH 附件库 + finalizeContent 换成"路径 + 图片块"）。幂等。"""
import sys
from pathlib import Path

HELPER = r'''
// 生成的图直接显示在对话里：图片存进 DSH 附件库，finalizeContent 把结果换成"路径文字 + 图片块"，
// 和 MCP 插件给图的方式一样。当前模型没声明图片输入时不附图（图片块会进模型上下文），只给路径。
const imageShows = new WeakMap();

async function stageImageContent(ctx, exec, files, value) {
  try {
    const get = (k) => (typeof ctx.get === "function" ? ctx.get(k) : undefined);
    const attachments = get("attachments");
    const llm = get("llm");
    if (!exec || !attachments || typeof attachments.saveImages !== "function" || !llm) return;
    const agent = exec.agent;
    const header = agent && agent.session && typeof agent.session.requestHeader === "function" ? agent.session.requestHeader() : undefined;
    const routed = header && header.config;
    const provider = (routed && routed.provider) || (agent && agent.options && agent.options.provider);
    const model = (routed && routed.model) || (agent && agent.options && agent.options.model);
    if (!provider || !model) return;
    const info = await llm.resolveModelInfo(provider, model, exec.signal);
    if (!info || !Array.isArray(info.inputModalities) || !info.inputModalities.includes("image")) return;
    const imgs = (Array.isArray(files) ? files : [])
      .filter((f) => f && f.b64 && /^image\/(png|jpeg|webp|gif)$/.test(String(f.mime || "")))
      .map((f) => ({ data: Buffer.from(String(f.b64), "base64"), mediaType: String(f.mime) }));
    if (!imgs.length) return;
    const refs = await attachments.saveImages(imgs);
    const content = [{ type: "text", text: (value.paths || []).join("\n") }];
    for (const ref of refs || []) content.push({ type: "image", attachment: ref });
    imageShows.set(exec, content);
  } catch (e) {
    // 附图失败不影响出图：文件已经落盘，路径照常返回。
  }
}
'''

def patch(t: str) -> tuple[str, str]:
    if "function stageImageContent(" in t:
        return t, "already"
    def once(src, old, new, what):
        if src.count(old) != 1:
            raise SystemExit("anchor-%s count=%d" % (what, src.count(old)))
        return src.replace(old, new, 1)
    t = once(t, "\nfunction apply(ctx, config) {\n", "\n" + HELPER.lstrip("\n") + "\nfunction apply(ctx, config) {\n", "apply")
    t = once(t, "    timeoutMs: 180000,\n",
             "    timeoutMs: 180000,\n"
             "    finalizeContent(exec, result) {\n"
             "      const content = imageShows.get(exec);\n"
             "      if (content === undefined) return undefined;\n"
             "      imageShows.delete(exec);\n"
             "      if (result && result.isError) return undefined;\n"
             "      return content;\n"
             "    },\n", "timeout")
    t = once(t, "    async execute(args) {\n      const body = {\n        prompt: String(args.prompt || \"\"),\n        n: args.n,",
             "    async execute(args, exec) {\n      const body = {\n        prompt: String(args.prompt || \"\"),\n        n: args.n,", "exec-sig")
    old_ret = """      const out = await postMedia(door, "/images", body, 170000);
      return {
        paths: writeFiles(out.files, safeStem(args.name, "grok-image") + "-" + stamp()),
        model: out.model || "grok-imagine-image-2.0"
      };
"""
    new_ret = """      const out = await postMedia(door, "/images", body, 170000);
      const value = {
        paths: writeFiles(out.files, safeStem(args.name, "grok-image") + "-" + stamp()),
        model: out.model || "grok-imagine-image-2.0"
      };
      await stageImageContent(ctx, exec, out.files, value);
      return value;
"""
    t = once(t, old_ret, new_ret, "ret")
    return t, "patched"

if __name__ == "__main__":
    for a in sys.argv[1:]:
        p = Path(a); raw = p.read_text(encoding="utf-8"); crlf = "\r\n" in raw
        t, how = patch(raw.replace("\r\n", "\n"))
        if how == "patched":
            p.write_text(t.replace("\n", "\r\n") if crlf else t, encoding="utf-8")
        print(a, how)
