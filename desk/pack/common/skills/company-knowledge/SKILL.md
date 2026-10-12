---
name: company-knowledge
description: One company_knowledge lookup. route=search. On not-found, web_search once.
whenToUse: 查公司, 手册.
disable-model-invocation: true
---

# company-knowledge

不要读个人 vault，不要对 `D:/dsh/brain` 或别人部门全库 `rg`。不要再写一个检索 skill。

用模型工具 **`company_knowledge`**。桌子会带上登录令牌。不要 `curl` 8443，不要自己报账号，不要 `--account`。

**一问一搜。** 默认只调一次：

```
company_knowledge  route=search  query=<窄词>
```

`search` 已经含查阅层、手册、纠错、个人 `_memory`、共享 `_memory`。不要再并行打 `memory` / `experience` / `handbook` / `correction`。`status` 只在不知道这把椅子时用一次，收据有身份就停。

地图命中只看那一条 how，闭合就停，不要倒库。`not-found` 就 `web_search` 同一批名字一次。不要换 route，不要 bash 扫盘，不要一上来开天眼查。收据点名了 L0/L1 路径才 `evidence=true` 并带 `path`，而且只一次。公开 GitHub / npm / Remotion 这类不是公司事实：不要调本工具，直接 `web_search`。

权限划分见 `company-access`。怎么写入见 `company-memory`。写入走 `company_memory_write`，不要官方 `write` 打 `_shared`。

## 规则

1. 别人的 `$personal/_memory` 搜不到，是权限，不是空。
2. `_shared/_memory` 全员可搜。
3. 别部门手册或经验被拒是正确结果。
4. 默认只查查阅层。全量 L0 是证据层，不默认打开。
5. 收据能闭合就停，不要倒库，不要再换 route。
6. 上传下达的文件在公司盘 inbox / projects，不在 `_memory`。
