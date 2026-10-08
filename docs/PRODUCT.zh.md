# 寻找共建者

项目讲解（单独一页，按对外说明书）：[BRIEF.zh.md](BRIEF.zh.md)。本页仍是认领缺口，不替代英文 [BUGS.md](../BUGS.md)。

这是英文仓的**中文增页**，不替代 [README](../README.md) / [BUGS.md](../BUGS.md) / [CONTRIBUTING.md](../CONTRIBUTING.md)。工单标题、补丁标记、CI 绿线仍以英文原文为准。

功能长什么样（带截图）：[BRIEF.zh.md](BRIEF.zh.md)。

定位：在客户自己的 Windows 上克隆本仓，跑 `scripts/setup-all.ps1`，得到局域网服务器（登录、种子管理员、网关、桌面客户端）。**默认管理员：账号 `tdh`，密码 `12345678`。** 模型接在服务器上：管理员在设置 → 模型里填各家 API key（OpenAI、Anthropic、DeepSeek、xAI、Kimi、智谱、任意 OpenAI 兼容地址）或接 Grok 订阅，保存在服务器的 `gateway.env`，员工电脑上没有钥匙；员工端登录后自动列出服务器能调的模型。ChatGPT、Claude 的个人订阅不做团队反代，请用它们的 API key。不是托管 SaaS。仓库不带公司资料和订阅钥匙。只装内核用 `setup.sh`，那一条不起服务器。官方上游暂时不收外部 PR。产品向的 PR 只在**本仓**合。功能讲解：[BRIEF.zh.md](BRIEF.zh.md)。认领缺口：[WANTED.zh.md](WANTED.zh.md)。

## 参与门槛

不需要公司网、花名册、协作者权限。

1. 按 [README](../README.md) 在**本地目录**装一遍。setup 或第一次 `dsh --patch` 挂了，开 **Bug** 就有用。
2. 从 [BUGS.md](../BUGS.md) 认领一个 id，开 **Task** issue，再 fork + PR。
3. 验收看 `*_OK=1`，不看「我改了 README」。

技术细节、文件路径、Done when 写在英文 [BUGS.md](../BUGS.md)。

## 现在缺什么

C1–C9 已在英文 [BUGS.md](../BUGS.md) 标绿。本机模型登录 / 自定义端点见 [MODELS.md](MODELS.md)。不是缺口：本地工作区；往官方仓提 PR；公司网关 / 花名册。

## 怎么算做完

绿线写在 [BUGS.md](../BUGS.md) 对应 C# 的 **Done when**。路径和脚本名只用 ASCII。不要提交办公室 IP、密码、花名册、活的 `node_modules`。
