# 更新说明 / Changelog

版本号是发布日期（`年.月.日`，同一天再发加 `.2`、`.3`）。每次合进 main 都要：改 `VERSION`、在这里最上面加一节、首页 README 的版本行同步。CI 的 `release-notes` 检查会卡住漏改的合并请求；合进 main 后自动打 `v<版本>` 标签并发 Release。

The version is the release date. Every merge to `main` bumps `VERSION`, adds a section at the top of this file and updates the version line in `README.md`; CI enforces it and publishes a tagged release.

## 2026.10.08

客户现场交付中暴露的问题，全部在一键安装里修掉（`setup-server.ps1` 安装时对 LFS 模板包打补丁，补丁和工具在 `server/site-patches/`，400 MB 的模板包不用重传）。

**换网不再失效**
- 站点地址默认改用本机 mDNS 名 `<计算机名>.local`，不再写死 IP。原来服务器换网或 DHCP 换了地址，所有已装客户端、Caddy 证书、安装包同时失效。跨网段/VLAN 仍可 `-HostName <IP>` 指定。
- Caddy 同时接受主机名和 IP 访问；同一端口收到明文 http 自动跳 https（员工只输 `host:8443` 时浏览器报 "client sent an HTTP request to an HTTPS server"）。
- 网关 8450 改为 IPv4/IPv6 双栈监听：按 `.local` 解析常先拿到 IPv6 链路本地地址，原来只听 `0.0.0.0`，桌面端先超时再重试。
- 新增 `server/retarget-site.ps1`：改计算机名后一条命令把站点、两个客户端包、exe、签名全部改指新名字。

**员工电脑首次登录**
- 共享盘账户 `dshshare`：安装脚本用 `net.exe` 建账户失败时把错误吞了，远程员工全部 `company-disk-not-mounted`。现在安装时核实并兜底重建，登录接口每次登录也自检（不存在就建、禁用就启用、密码对齐）。
- 「添加人员」只写花名册不建个人目录，新员工登录 `company-workspace-missing`。现在添加时建，登录时再补。
- 登录账号不区分大小写（账号只允许小写，员工常输大写）。
- 团队工作区（共享盘根）新建会话报 `session/workspace-attach-failed`：`desk-lease.js` 用 JS 版 `fs.realpathSync`，对 UNC 共享根多带一个尾斜杠，和内核 `fs.promises.realpath` 严格比对不上。改用 `realpathSync.native`。
- 安装后桌面不再出现 4 个图标：安装器只在用户桌面建一个 `.lnk`（失败才退回 `.url`），客户端启动时清掉旧安装留下的副本。

**安全与完整性**
- 本机 17803 的 `/company/*` 路由补上和官方 `/api` 同一套来源校验（Host 必须回环、拒跨站、Origin 必须同源）。原来任意网页都能让浏览器打这些接口，包括改花名册。
- 一键更新验签：每个站点安装时生成 Ed25519 密钥（私钥只在服务器），`version.json` 带 sha256 并签名；客户端 `pack-verify.js` 验签、核哈希，不对就不装。旧装机没有公钥时放行一次并装上公钥。
- 产品树重新封条：包内文件改过后重算 `BUILD.json`，`tree-check` 回到 `TREE_OK=1`；启动时改为后台跑、只记录（全量约 3 万文件，服务器实测 144 秒），更新装完再跑一次。
- 客户端不再把遗留的 `TDHarness.exe.new` 换上：模板包里残留的那份是旧编译，地址是占位符，一启动就崩。安装和改址都会剔除它，换入前也检查占位符。

**模型与生图**
- 设置页显示 Grok 订阅额度百分比：网关 `/grok-quota` 查 `cli-chat-proxy.grok.com/v1/billing`，缓存 60 秒。
- 网关补上 `/images`、`/videos`（`gw-media.js`），`company-grok-media` 插件原来调过去必定失败。
- 生成的图片直接显示在对话里（存进附件库，`finalizeContent` 返回图片块），原来只回一行路径。
- 所有客户端新会话默认 `grok-4.7` + High（overlay 每次启动同步、最后一层生效，会话里仍可手动切换）。

**客户现场发布**
- 新增 `server/publish-site-update.ps1 [-BumpMark]`：打补丁、重编 exe 和安装器、重新封条、签名一步完成；`-BumpMark` 换版本标记，已装客户端下次启动提示更新。

## 2026.10.07.6

**客户端更新流程（Windows / Mac）**
- 检查新版不再卡住：原来只要有新版，检查程序会先把安装目录 2 万多个文件核对一遍（最长 3 分钟），而且这段时间窗口在界面线程上等，Windows 显示「没有回应」。现在检查只比对版本标记，一般几十毫秒；Windows 窗口把检查和更新都放到后台，原来那个 15 秒超时实际不起作用的问题也一并修好。
- 更新有进度：登录框下方实时显示「正在下载新版 123 / 405 MB（30%）」「正在安装新版 12000 / 41185 个文件（29%）」，不再只弹一个「正在下载并安装」就没了下文。Mac 窗口同样显示下载和安装进度。
- 更新真正装全：更新脚本原来只覆盖内核、插件等几个目录，`windows-mcp/`、`peekaboo/`、`skills/`、`opencli/`（以及 Windows 的 `ffmpeg/`）从不随更新下发；现在都在更新范围内。
- Windows 窗口程序真正换新：正在运行的 `TDHarness.exe` 覆盖不了，原来只能存成 `TDHarness.exe.new` 且没人换上。现在更新时先把运行中的程序改名挪开再放新的；检查程序也会把遗留的 `.new` 换上。
- 自动补装：已装的客户端如果缺少自己清单里列着的组件，检查程序会提示「需要补装一次」。从旧版升上来的电脑多走一轮就能补齐。
- 在客户机临时目录实测：405 MB 下载加 41185 个文件安装共 61 秒，进度每半秒一条；运行中的 `TDHarness.exe` 被换成新文件，进程不中断。Mac 下 416 MB 37 秒。

## 2026.10.07.5

**客户端（Mac）**
- 自带桌面软件操作：Peekaboo 4.9.0 放在 `peekaboo/`。它是苹果公证过的单个程序，Apple 芯片和 Intel 通用，MCP 外壳直接用客户端自带的 Node，不用另装 Python。和 macOS-MCP 实测对比后选它：macOS-MCP 没权限就拒绝启动，权限还挂在会随升级变化的 Python 上。
- `peekaboo/mcp-filter.cjs`：内核和 Peekaboo 都没有工具白名单，加一层转发把 `agent`、`analyze`（要另配 AI 服务商）和 `browser`（网页交给 OpenCLI）藏起来，硬调也会被挡回。开 `--allow-foreground`，剪映这类自绘界面要点前台。
- 新技能 `company-desktop`（Mac 版）：第一次先查权限，按 Peekaboo 给出的应用名带员工开「辅助功能」「屏幕录制」；其余规矩和 Windows 版一致。
- Mac 包不再带 Windows 的配置行。

## 2026.10.07.4

**客户端（Windows）**
- 自带桌面软件操作：Windows-MCP 0.8.7 连同它自己的 Python 3.14 放在 `windows-mcp/`，员工电脑什么都不用装。AI 能读窗口、点、打字、滚动、拖动、按快捷键；不开注册表和 PowerShell 工具，关掉匿名统计。路径按客户端安装位置自动算，装在哪都能找到；Mac 上这一条自动关闭。
- 新技能 `company-desktop`：每步动作前后都看一眼、点错就撤销；导出、覆盖、删除、发送先问员工；剪映是自绘界面，剪辑走草稿，界面只做剪映独有的在线功能、检查和导出，附剪映快捷键。
- 修正：overlay 里新增插件必须写成 `- insert:`，直接写顶层条目会被内核当成「改已有条目」静默跳过。

## 2026.10.07.3

**CI**
- Windows 检查不再因为 Chocolatey 源抽风而失败：ripgrep 改从 npm 装微软打包的版本（`@vscode/ripgrep`），装不上才退回 choco，装完核对 `rg --version`，失败就在安装这一步报错，不再拖到后面的搜索检查。

## 2026.10.07.2

**服务器**
- 知识库检索（4182）改成只认登录令牌：请求必须带员工登录时拿到的网关令牌（`Authorization: Bearer` 或 `X-Company-Gw-Token`），令牌被吊销、人被停用就立刻查不了；`X-Auth-Request-User` 这类填名字的请求头一律不信。每次检索记一行「谁、查了几条」到 `D:\dsh\logs\knowledge-search.log`，不记问题原文。暂不按部门区分谁能看什么。
- 装机生成的 Caddy 配置不再把客户端带来的 `X-Auth-Request-User` 转给知识库。
- 新增 `scripts/prove-knowledge.js`（CI 两个系统都跑）：无令牌、伪造名字、编造令牌、已吊销、已停用都必须 401。

**客户端（Mac）**
- Mac 安装包重做：内核 0.2.1-alpha.1、插件、技能、OpenCLI 1.8.8 与 Windows 包同一份；原生模块换成 Mac 版，Apple 芯片和 Intel 都能跑（两种架构各自通过内核自检，163 个插件全部启动）。
- 修正：插件在 Mac 上找不到自带的 OpenCLI（按 Windows 的 node 位置推安装目录）。
- 修正：经中继（Tailscale DERP）远程首次登录时，工作区目录写到了本机、会话却存在工位，侧栏只剩「默认工作区」。
- 登录框不再显示内部账号名，默认填 `tdh`。
- Mac 包不带 ffmpeg；要让 AI 看视频，先 `brew install ffmpeg`。

**文档**
- 首页截图换成 0.2.1 界面（演示数据）；中文项目讲解页补上十月新增功能。
- 版本号比较改成按数字逐段比（`.10` 排在 `.9` 后面）。

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
- Mac 安装包未更新（见 2026.10.07.2）。

**文档**
- 首页、服务器安装说明、产品说明补上以上内容；新增本更新说明和版本号。

## 2026.09.29 及以前

见 git 历史（`git log`）。
