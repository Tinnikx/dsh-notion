# dsh-notion 设计文档

- 日期：2026-08-15
- 状态：已定稿，待进入实现计划
- 目标：一个把 DeepSeek Harness (dsh) 连接到官方 Notion MCP 的插件

## 1. 概览

`dsh-notion` 是一个 dsh 的 **bundle（组合包）插件**：独立的 npm 包 + GitHub 仓库，`package.json` 声明 `dsh.bundle`，用户通过 `dsh plugin add dsh-notion` 安装。

装上后，用户跑一次 `dsh notion login` 完成 OAuth 授权，之后 dsh 的 agent 即可使用 `mcp__notion__*` 工具读写 Notion（搜索、读写页面/数据库/评论等；具体工具集由 Notion MCP 提供，插件不裁剪）。

核心工作不是"配一个 URL"，而是：**自己实现 PKCE OAuth 流程 → 拿 access/refresh token → 存进 dsh 的 `ctx.credentials` → 定时静默刷新 → 把 token 作为 `Authorization` header 注入 `@deepseek-ai/dsh-mcp-client`**。dsh 目前没有任何可复用的通用 OAuth 能力（已核查：`oauth2 / pkce / authorization_code / redirect_uri / device code` 在 packages 中零命中）。

## 2. 背景与关键约束

- dsh 内置 MCP 客户端 `@deepseek-ai/dsh-mcp-client`，支持 `stdio` 与 `streamable-http` 两种传输，但**只支持静态 `headers` 认证**，无 OAuth。
- Notion MCP（`https://mcp.notion.com/mcp`）是 `streamable-http` 服务，**只支持 OAuth 授权码 + PKCE**；官方 FAQ 明确"暂不支持非交互授权"。旧的 bearer-token 版 `notion-mcp-server` 已停维护。
- Notion MCP 的 OAuth 使用**动态客户端注册（DCR，RFC 7591）**：客户端运行时自行注册拿到 `client_id`，`token_endpoint_auth_method: none`（public 客户端）——**无需预先注册，仓库里不嵌入任何 secret 或 client_id**。
- OAuth 端点**动态发现**：先从 `https://mcp.notion.com/mcp/.well-known/oauth-protected-resource`（RFC 9470）拿 `authorization_servers`，再拉 `{authServer}/.well-known/oauth-authorization-server`（RFC 8414）拿 `authorization_endpoint` / `token_endpoint`。
- `localhost` 回调 Notion 接受，但建议用 `127.0.0.1`；`redirect_uri` 必须与 Notion 后台注册的完全一致（含端口）。
- MCP 客户端需走 `.well-known/oauth-*` 的 OAuth 发现；`@modelcontextprotocol/sdk` 内置 OAuth 支持。

## 3. 方案选择

采用**方案 A（OAuth 前置 + 包一层 dsh-mcp-client）**，已与用户确认：

- 插件自己完成 PKCE OAuth（CLI 命令 + 本地回调），token 存 `ctx.credentials`，再用 access token 作为静态 `Authorization` header 挂载 `@deepseek-ai/dsh-mcp-client`。
- token 到期用 refresh_token 换新、再重挂载。
- 优点：复用 dsh 现成的 mcp-client（工具命名 `mcp__notion__*`、断线重连、HMR、注册回滚），胶水代码最少。
- 代价：刷新 = 卸载再挂载 mcp-client（约每小时一次，工具短暂抖动，可接受）。

放弃的备选（记录，不实施）：

- 方案 B：直接用 `@modelcontextprotocol/sdk` 内置 OAuth provider，重写工具注册胶水——代码量与维护面更大。
- 方案 C：给 dsh-mcp-client 提上游 OAuth feature——依赖上游 PR 合入，不在控制内。作为后续独立贡献。

## 4. 组件

四个模块，职责单一：

| 模块 | 职责 |
|---|---|
| `notion-oauth.ts` | 纯函数：OAuth 发现（RFC 9470/8414）、DCR 注册（RFC 7591）、PKCE S256（verifier/challenge）、state 生成、authorize URL 构造、code→token 交换、refresh_token 刷新（含轮换）。无副作用、可单测 |
| `notion-token-store.ts` | 经 `ctx.credentials` 读写 token（`NOTION_ACCESS_TOKEN` / `NOTION_REFRESH_TOKEN` / `NOTION_TOKEN_EXPIRES_AT`），借用 credentials-local 的 0600 权限 + 原子写 |
| `login-server.ts` | 登录命令的运行时：起一个 `127.0.0.1:53007` 的临时 HTTP 服务，打印/打开 authorize URL，收到回调后校验 state、交换 token、落盘、关闭 |
| `index.ts`（插件本体，Service 类） | 编排：启动时解析 token→挂载 mcp-client；注册 `dsh notion login` 命令；调度到期刷新 |

挂载 mcp-client 的方式：

```ts
ctx.plugin(mcpClientModule, {
  transport: 'streamable-http',
  serverName: 'notion',
  url: 'https://mcp.notion.com/mcp',
  headers: { Authorization: `Bearer ${accessToken}` },
})
```

`serverName: 'notion'` → 工具公开名为 `mcp__notion__<rawName>`。

## 5. 数据流

### 5.1 运行时（插件 apply）

```
插件 apply → 读 token store
  ├─ 有 token 且未过期 → 直接挂 mcp-client
  ├─ 有 refresh_token 但 access 过期 → 静默刷新 → 更新存储 → 挂载
  └─ 没有 token → 不挂载，日志提示「运行 dsh notion login」
```

### 5.2 登录（dsh notion login）

```
OAuth 发现 → DCR 注册 → 生成 PKCE verifier/challenge + state → 起本地回调服务
→ 打印 authorize URL（用户浏览器点授权）
→ Notion 回调 /callback?code&state → 校验 state → 用 code+verifier 换 token
→ 存 token store → 挂载/刷新 mcp-client → 关闭回调服务
```

登录命令通过 dsh 官方「表层组合包持有自己的命令行」模式实现：插件注入 `cmdlineArgs`，用 `@deepseek-ai/dsh-cmdline` 的 `parseCmdline` 注册 `notion login` 子命令。

## 6. token 刷新

Notion access token 约 8 小时过期（以响应的 `expires_in` 为准，不写死）。插件在到期前静默用 refresh_token 换新，然后**卸载重挂** mcp-client（`ctx.dispose` 子插件 → 用新 token 重新 `ctx.plugin`）。亚秒级工具缺失，可接受。

刷新 token 每次刷新都会**轮换**（返回新 refresh_token、作废旧 token）：刷新必须串行化（互斥锁）并原子持久化。refresh_token 有 180 天绝对上限或 30 天不活动即失效；届时返回 `invalid_grant`，为**终态**——绝不重试（重放已轮换的 token 会被当作盗用信号、吊销整个授权），只能让用户重新 `login`。

## 7. 错误处理

| 场景 | 处理 |
|---|---|
| state 不匹配 / code 过期 | 明确报错，重新 `login` |
| `redirect_uri` 不匹配（Notion 精确匹配） | 报错并提示检查注册端口 |
| 回调端口被占 | 明确报错（Notion 要求固定注册端口，不静默换端口） |
| refresh 失败（refresh_token 被吊销） | 卸载工具 + 提示重新 `login` |
| `invalid_grant`（refresh_token 过期/轮换丢失） | **终态，不重试**：卸载工具 + 提示重新 `login` |
| mcp-client 初次连接失败 | `failOnStartupError: false`（默认），插件照常激活、日志报错、走重连 |

## 8. 测试

- **单测**：PKCE 编解码、authorize URL 构造、token 交换/刷新（用本地 mock token endpoint）。
- **集成**：起本地 mock MCP 服务器（复用 dsh mcp-client 自带的 fixture-server 思路），验证工具注册成 `mcp__notion__*`、刷新后重挂载不丢工具。
- **E2E**：真实 Notion 需浏览器 OAuth，手动进行，不进自动化。

## 9. 范围（v1）

**做**：

- PKCE OAuth 登录（`dsh notion login` + 本地回调）
- token 持久化 + 静默刷新
- 把官方 Notion MCP 工具接入 agent

**不做（YAGNI，留到以后）**：

- Web GUI 设置卡片
- Notion「Skills」/ slash 命令封装
- 多 workspace 切换、只读模式开关
- 给 dsh-mcp-client 提上游 OAuth PR（方案 C，独立后续）

## 10. 发布与收录

- 包名 / 仓库名：`dsh-notion`
- `package.json` 声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`；`@deepseek-ai/*` 用 `peerDependencies`
- `cordis.patch.yml` 只插一行插件 id
- 发布到 npm（免 `allowBuilds` 授权）；仓库打 `dsh-plugin` topic
- 最后 PR 到 awesome-dsh-plugin，放 **Notifications & Integrations** 分类，中英文各加一行

## 11. 前置条件（用户需手动完成）

无需在 Notion 后台手动注册——插件通过动态客户端注册（DCR）在运行时自行注册。回调地址 `http://127.0.0.1:53007/callback` 由插件在 DCR 时声明（默认端口 `53007`，高位少见端口；如需更换，改插件配置即可，无需手动改 Notion 后台）。

## 12. 已确认的关键决策

- 技术路线：OAuth + 官方 Notion MCP（PKCE）
- 授权入口：CLI `dsh notion login` + 本地回调
- 架构：方案 A（OAuth 前置 + 包一层 dsh-mcp-client）
- token 存储：`ctx.credentials`
- 命名：`dsh-notion`
