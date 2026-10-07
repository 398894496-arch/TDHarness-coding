# 更新说明 / Changelog

版本号是发布日期（`年.月.日`，同一天再发加 `.2`、`.3`）。每次合进 main 都要：改 `VERSION`、在这里最上面加一节、首页 README 的版本行同步。CI 的 `release-notes` 检查会卡住漏改的合并请求；合进 main 后自动打 `v<版本>` 标签并发 Release。

The version is the release date. Every merge to `main` bumps `VERSION`, adds a section at the top of this file and updates the version line in `README.md`; CI enforces it and publishes a tagged release.

## 2026.10.07

**服务器**
- 知识库每日蒸馏：新增 `server/brain/`，任务 `TDH-Brain-Daily` 每天 00:15 读当天对话，写证据层、每人每天一页蒸馏、收集纠错；首次运行按人员名单建好知识库目录。修正了只读到会话第一段（多帧压缩）、新内核会话文件名、模型思考被当成回答等问题。
- 联网搜索走网关 `/search` `/fetch`：中文先国内引擎（必应中国、360）加 Exa，GitHub、B 站、YouTube 有专门通道；`深搜 ` 开头走 Grok 带出处检索，后台继续查，同一问题再问一次取结果。
- 网关：按人记 token 用量；xAI 登录态自动续期。
- 人员服务：任务卡存服务器；改角色、改部门；种子管理员不可停用。
- 内核热插拔：切换前自检、失败自动退回；自检新增 `--hold` 手动试用模式。
- 口播剪辑工具（可选）：`server/koubo/`，录音进、剪映草稿出；区分出镜人和镜头外声音、防抖、自绘字幕和版式、剪映曲库配乐；`install.ps1` 安装。

**客户端（Windows）**
- 安装包换成内核 0.2.1-alpha.1、当前插件和外壳、自带 ffmpeg 和 OpenCLI 1.8.8（含 Chrome 扩展）；第一次做浏览器操作时由 AI 引导装扩展。
- 长对话自动压缩（模型窗口的 80%，以及厂商报超长时），已在 Grok 50 万真实上限下验证。
- Mac 安装包未更新。

**文档**
- 首页、服务器安装说明、产品说明补上以上内容；新增本更新说明和版本号。

## 2026.09.29 及以前

见 git 历史（`git log`）。
