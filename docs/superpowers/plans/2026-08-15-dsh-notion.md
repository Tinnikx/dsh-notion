# dsh-notion 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一个 dsh bundle 插件，让 agent 通过官方 Notion MCP（OAuth + PKCE）读写 Notion，工具以 `mcp__notion__*` 暴露。

**Architecture:** 方案 A（OAuth 前置 + 包一层 `@deepseek-ai/dsh-mcp-client`）。插件自己完成 MCP OAuth 流程（发现 → DCR → PKCE → 本地回调 → 交换 → 轮换刷新），把 access token 作为静态 `Authorization: Bearer` header 挂载 dsh 现成的 mcp-client；token 存 `ctx.credentials`（单条 JSON 值，原子写）。刷新时卸载重挂 mcp-client。

**Tech Stack:** TypeScript、Node 22、Cordis（`@deepseek-ai/cordis`）、`@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-cmdline`（commander）、`@deepseek-ai/schemastery`、`node:crypto` / `node:http` / `fetch`、tsdown（构建）、vitest（测试）。

## Global Constraints

- 包名 / 仓库名：`dsh-notion`；`package.json` 必须声明 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`。
- 官方 `@deepseek-ai/*` 包一律用 `peerDependencies`，不得进 `dependencies`（唯一例外是 dev/test 依赖）。运行时不引入第三方依赖（`node:` 内置 + `@deepseek-ai/*` peer + commander via dsh-cmdline）。
- 回调地址固定 `http://127.0.0.1:53007/callback`，默认端口 `53007`（可通过 plugin config 覆盖；`127.0.0.1` 而非 `localhost`）。
- MCP 服务器 URL 默认 `https://mcp.notion.com/mcp`；`serverName` 固定 `notion`（→ 工具名 `mcp__notion__*`）。
- token 生命周期：access ~8h（以响应 `expires_in` 为准，不写死）；refresh token 每次刷新轮换；180 天绝对上限 / 30 天不活动即 `invalid_grant`。`invalid_grant` 为**终态，绝不重试**。
- 刷新必须**串行化（互斥锁）**；persist 后写 refresh_token（单条 JSON 已天然原子）。
- 单测用 vitest；HTTP 相关单测一律用本地 `node:http` mock server，不访问真实 Notion。
- 构建产物为 `lib/`（tsdown）；`prepare` 脚本跑构建（供 git 安装）。

## File Structure

- `package.json` — bundle manifest（`dsh.bundle`）+ peerDependencies + scripts
- `tsconfig.json` / `tsdown.config.ts` / `vitest.config.ts` — 构建与测试配置
- `cordis.patch.yml` — 插一行插件（`dsh-notion`）
- `.gitignore` / `LICENSE` / `README.md` — 工程文件
- `src/notion-oauth.ts` — 纯函数：PKCE、state、发现、DCR、交换、刷新
- `src/notion-token-store.ts` — 经 `ctx.credentials` 读写 token（单条 JSON）
- `src/login-server.ts` — 本地回调 HTTP 服务
- `src/index.ts` — 插件本体（Service：apply、挂载 mcp-client、注册 `notion login`、调度刷新）
- `tests/notion-oauth.spec.ts`、`tests/notion-token-store.spec.ts`、`tests/login-server.spec.ts`

---

### Task 1: 工程脚手架（可加载的空 bundle）

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts`, `cordis.patch.yml`, `.gitignore`, `LICENSE`, `src/index.ts`（空实现）

**Interfaces:**
- Produces: 一个能 `npm run build` 且 `cordis.patch.yml` 引用得到 `dsh-notion` 的最小包；`src/index.ts` 导出 `name`、`Config`、`apply`（暂空）。

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "dsh-notion",
  "version": "0.1.0",
  "description": "Connect DeepSeek Harness (dsh) to Notion via the official Notion MCP (OAuth + PKCE)",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "exports": { ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" } },
  "files": ["lib", "cordis.patch.yml"],
  "scripts": {
    "build": "tsdown",
    "prepare": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-mcp-client": "*",
    "@deepseek-ai/dsh-credentials": "*",
    "@deepseek-ai/dsh-cmdline": "*",
    "@deepseek-ai/schemastery": "*"
  },
  "devDependencies": {
    "tsdown": "^0.13.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  },
  "license": "MIT",
  "keywords": ["dsh", "dsh-plugin", "notion", "mcp", "deepseek-harness"]
}
```

- [ ] **Step 2: 写 cordis.patch.yml**

```yaml
- insert:
    - id: notion
      name: dsh-notion
```

- [ ] **Step 3: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "lib",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 写 tsdown.config.ts 与 vitest.config.ts**

```ts
// tsdown.config.ts
import { defineConfig } from 'tsdown'
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: true, clean: true })
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 5: 写 .gitignore 与 LICENSE**

`.gitignore`：`node_modules/`、`lib/`、`*.tsbuildinfo`。`LICENSE` 用 MIT 全文（占位「Copyright (c) 2026 <your name>」）。

- [ ] **Step 6: 写最小 src/index.ts**

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'notion'

export function apply(_ctx: Context): void {}
```

- [ ] **Step 7: 安装依赖并验证构建**

Run: `cd /Users/admin/Mingdom/dsh-notion && npm install && npm run build && npm run typecheck`
Expected: `lib/index.js` 与 `lib/index.d.ts` 生成，无报错。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold dsh-notion bundle"
```

---

### Task 2: PKCE 与 state 原语

**Files:**
- Create: `src/notion-oauth.ts`（先写 PKCE 部分）
- Test: `tests/notion-oauth.spec.ts`

**Interfaces:**
- Produces:
  - `base64url(buf: Buffer): string`
  - `generateVerifier(): string`（32 随机字节 → base64url）
  - `computeChallenge(verifier: string): string`（SHA-256 → base64url）
  - `generateState(): string`（16 随机字节 → base64url）

- [ ] **Step 1: 写失败测试**

```ts
// tests/notion-oauth.spec.ts
import { describe, it, expect } from 'vitest'
import { base64url, generateVerifier, computeChallenge, generateState } from '../src/notion-oauth.js'

describe('PKCE', () => {
  it('verifier is 43 chars of url-safe base64url', () => {
    const v = generateVerifier()
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
  it('challenge is the S256 hash of the verifier', () => {
    const v = generateVerifier()
    const c = computeChallenge(v)
    expect(c).toMatch(/^[A-Za-z0-9_-]{43}$/)
    // determinism: same verifier -> same challenge
    expect(computeChallenge(v)).toBe(c)
  })
  it('state is url-safe and non-empty', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
  it('base64url has no +, / or =', () => {
    expect(base64url(Buffer.from('hello?!'))).not.toMatch(/[+/=]/)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/notion-oauth.js'`。

- [ ] **Step 3: 实现**

```ts
// src/notion-oauth.ts
import { createHash, randomBytes } from 'node:crypto'

export function base64url(buf: Buffer): string {
  return buf.toString('base64url')
}

export function generateVerifier(): string {
  return base64url(randomBytes(32))
}

export function computeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export function generateState(): string {
  return base64url(randomBytes(16))
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test`
Expected: 4 tests PASS。

- [ ] **Step 5: Commit**

```bash
git add src/notion-oauth.ts tests/notion-oauth.spec.ts
git commit -m "feat(oauth): PKCE S256 and state primitives"
```

---

### Task 3: OAuth 发现 + DCR 注册

**Files:**
- Modify: `src/notion-oauth.ts`（追加发现 + DCR）
- Test: `tests/notion-oauth.spec.ts`（追加）

**Interfaces:**
- Consumes: `base64url`（本文件内）
- Produces:
  - `interface OAuthDiscovery { authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint: string }`
  - `discoverOAuth(resourceBaseUrl: string): Promise<OAuthDiscovery>`
  - `registerClient(registrationEndpoint: string, redirectUris: string[]): Promise<{ clientId: string }>`

- [ ] **Step 1: 写失败测试（用本地 mock server）**

```ts
// tests/notion-oauth.spec.ts（追加）
import { createServer } from 'node:http'
import { once } from 'node:events'
import { discoverOAuth, registerClient } from '../src/notion-oauth.js'

async function withServer(routes: Record<string, (url: URL) => unknown>) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const handler = routes[url.pathname]
    res.setHeader('Content-Type', 'application/json')
    if (!handler) { res.writeHead(404).end(); return }
    res.end(JSON.stringify(handler(url)))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

it('discoverOAuth follows protected-resource -> auth-server', async () => {
  const { server, baseUrl } = await withServer({
    '/.well-known/oauth-protected-resource': () => ({ authorization_servers: [`${baseUrl}/auth`] }),
    '/auth/.well-known/oauth-authorization-server': () => ({
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
    }),
  })
  const d = await discoverOAuth(baseUrl)
  expect(d).toEqual({ authorizationEndpoint: `${baseUrl}/authorize`, tokenEndpoint: `${baseUrl}/token`, registrationEndpoint: `${baseUrl}/register` })
  server.close()
})

it('registerClient posts DCR params and returns client_id', async () => {
  const { server, baseUrl } = await withServer({
    '/register': () => ({ client_id: 'cid-123' }),
  })
  const { clientId } = await registerClient(`${baseUrl}/register`, ['http://127.0.0.1:53007/callback'])
  expect(clientId).toBe('cid-123')
  server.close()
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test`
Expected: 两个新用例 FAIL（`discoverOAuth is not a function`）。

- [ ] **Step 3: 实现**

```ts
// src/notion-oauth.ts（追加）
export interface OAuthDiscovery {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

export async function discoverOAuth(resourceBaseUrl: string): Promise<OAuthDiscovery> {
  const base = new URL(resourceBaseUrl)
  const protectedResource = await fetchJson(`${base.origin}/.well-known/oauth-protected-resource`)
  const authServer: string = protectedResource.authorization_servers?.[0]
  if (!authServer) throw new Error('OAuth discovery: no authorization_servers advertised')
  const meta = await fetchJson(`${authServer}/.well-known/oauth-authorization-server`)
  return {
    authorizationEndpoint: meta.authorization_endpoint,
    tokenEndpoint: meta.token_endpoint,
    registrationEndpoint: meta.registration_endpoint,
  }
}

export async function registerClient(
  registrationEndpoint: string,
  redirectUris: string[],
): Promise<{ clientId: string }> {
  const res = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'dsh-notion',
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })
  if (!res.ok) throw new Error(`DCR failed: HTTP ${res.status}`)
  const body = await res.json()
  return { clientId: body.client_id }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/notion-oauth.ts tests/notion-oauth.spec.ts
git commit -m "feat(oauth): discovery (RFC 9470/8414) and dynamic client registration"
```

---

### Task 4: code 交换 + refresh_token 刷新

**Files:**
- Modify: `src/notion-oauth.ts`（追加交换 + 刷新 + `InvalidGrantError`）
- Test: `tests/notion-oauth.spec.ts`（追加）

**Interfaces:**
- Consumes: 本文件内 `generateVerifier` 等
- Produces:
  - `interface TokenResponse { accessToken: string; refreshToken?: string; expiresIn: number; identity?: { userId: string; workspaceId: string } }`
  - `class InvalidGrantError extends Error`
  - `buildAuthorizeUrl(authorizationEndpoint: string, opts: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string`
  - `exchangeCode(tokenEndpoint: string, opts: { clientId: string; code: string; redirectUri: string; codeVerifier: string }): Promise<TokenResponse>`
  - `refreshAccessToken(tokenEndpoint: string, opts: { clientId: string; refreshToken: string }): Promise<TokenResponse>`

- [ ] **Step 1: 写失败测试**

```ts
// tests/notion-oauth.spec.ts（追加）
import { buildAuthorizeUrl, exchangeCode, refreshAccessToken, InvalidGrantError } from '../src/notion-oauth.js'

it('buildAuthorizeUrl sets PKCE + state params', () => {
  const u = new URL(buildAuthorizeUrl('https://auth.example/authorize', {
    clientId: 'cid', redirectUri: 'http://127.0.0.1:53007/callback', state: 'st', codeChallenge: 'ch',
  }))
  expect(u.searchParams.get('response_type')).toBe('code')
  expect(u.searchParams.get('code_challenge_method')).toBe('S256')
  expect(u.searchParams.get('code_challenge')).toBe('ch')
  expect(u.searchParams.get('state')).toBe('st')
})

it('exchangeCode posts form-encoded and returns tokens', async () => {
  const { server, baseUrl } = await withServer({
    '/token': () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 28800, user_id: 'u1', workspace_id: 'w1' }),
  })
  const t = await exchangeCode(`${baseUrl}/token`, {
    clientId: 'cid', code: 'code', redirectUri: 'http://127.0.0.1:53007/callback', codeVerifier: 'v',
  })
  expect(t.accessToken).toBe('at')
  expect(t.refreshToken).toBe('rt')
  expect(t.expiresIn).toBe(28800)
  expect(t.identity).toEqual({ userId: 'u1', workspaceId: 'w1' })
  server.close()
})

it('refreshAccessToken maps invalid_grant to InvalidGrantError', async () => {
  const { server, baseUrl } = await withServer({
    '/token': () => ({ error: 'invalid_grant' }),
  })
  await expect(refreshAccessToken(`${baseUrl}/token`, { clientId: 'cid', refreshToken: 'rt' }))
    .rejects.toBeInstanceOf(InvalidGrantError)
  server.close()
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test`
Expected: 新用例 FAIL。

- [ ] **Step 3: 实现**

```ts
// src/notion-oauth.ts（追加）
export class InvalidGrantError extends Error {
  constructor() { super('invalid_grant: refresh token expired or rotated away — re-authorize required') }
}

export interface TokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  identity?: { userId: string; workspaceId: string }
}

export function buildAuthorizeUrl(
  authorizationEndpoint: string,
  opts: { clientId: string; redirectUri: string; state: string; codeChallenge: string },
): string {
  const url = new URL(authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', opts.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

function parseTokenBody(body: any): TokenResponse {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresIn: body.expires_in,
    identity: body.user_id ? { userId: body.user_id, workspaceId: body.workspace_id } : undefined,
  }
}

export async function exchangeCode(
  tokenEndpoint: string,
  opts: { clientId: string; code: string; redirectUri: string; codeVerifier: string },
): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: opts.clientId,
      code: opts.code,
      redirect_uri: opts.redirectUri,
      code_verifier: opts.codeVerifier,
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status}`)
  return parseTokenBody(await res.json())
}

export async function refreshAccessToken(
  tokenEndpoint: string,
  opts: { clientId: string; refreshToken: string },
): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: opts.clientId,
      refresh_token: opts.refreshToken,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (body.error === 'invalid_grant') throw new InvalidGrantError()
  if (!res.ok) throw new Error(`refresh failed: HTTP ${res.status}`)
  return parseTokenBody(body)
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/notion-oauth.ts tests/notion-oauth.spec.ts
git commit -m "feat(oauth): code exchange, refresh, invalid_grant terminal error"
```

---

### Task 5: token 存储（ctx.credentials，单条 JSON）

**Files:**
- Create: `src/notion-token-store.ts`
- Test: `tests/notion-token-store.spec.ts`

**Interfaces:**
- Consumes: `import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'`（类型层面：`resolve`/`set`/`unset`，与 dsh 的 `ctx.credentials` 形状一致）
- Produces:
  - `interface NotionTokens { accessToken: string; refreshToken: string; expiresAt: number; clientId: string }`
  - `class NotionTokenStore { constructor(credentials: CredentialProvider); load(): Promise<NotionTokens | undefined>; save(t: NotionTokens): Promise<void>; clear(): Promise<void> }`

- [ ] **Step 1: 写失败测试（用内存 fake provider）**

```ts
// tests/notion-token-store.spec.ts
import { describe, it, expect } from 'vitest'
import { NotionTokenStore, type NotionTokens } from '../src/notion-token-store.js'

function fakeProvider() {
  const map = new Map<string, string>()
  return {
    async resolve(ref: string) { const v = map.get(ref); return v === undefined ? undefined : { value: v, source: 'file' } },
    async set(ref: string, value: string) { map.set(ref, value) },
    async unset(ref: string) { map.delete(ref) },
    async describe() { return { configured: false, writable: true } },
  }
}

const tokens: NotionTokens = { accessToken: 'at', refreshToken: 'rt', expiresAt: 123456, clientId: 'cid' }

it('round-trips tokens through a single credential entry', async () => {
  const store = new NotionTokenStore(fakeProvider() as any)
  await store.save(tokens)
  expect(await store.load()).toEqual(tokens)
})

it('load returns undefined when nothing stored', async () => {
  const store = new NotionTokenStore(fakeProvider() as any)
  expect(await store.load()).toBeUndefined()
})

it('clear removes the entry', async () => {
  const store = new NotionTokenStore(fakeProvider() as any)
  await store.save(tokens)
  await store.clear()
  expect(await store.load()).toBeUndefined()
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/notion-token-store.ts
import { credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'

const REF = credentialRef('NOTION_OAUTH')

export interface NotionTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch milliseconds
  clientId: string
}

export class NotionTokenStore {
  constructor(private credentials: CredentialProvider) {}

  async load(): Promise<NotionTokens | undefined> {
    const resolved = await this.credentials.resolve(REF)
    if (!resolved) return undefined
    try {
      return JSON.parse(resolved.value) as NotionTokens
    } catch {
      return undefined
    }
  }

  async save(tokens: NotionTokens): Promise<void> {
    // Single entry -> one atomic set (access + refresh + expiry + clientId together).
    await this.credentials.set(REF, JSON.stringify(tokens))
  }

  async clear(): Promise<void> {
    await this.credentials.unset(REF)
  }
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test`
Expected: 3 个新用例 PASS（`@deepseek-ai/dsh-credentials` 需已装——Task 1 的 `npm install` 已含 peer 包，若 vitest 解析不到则 `npm i -D @deepseek-ai/dsh-credentials`）。

- [ ] **Step 5: Commit**

```bash
git add src/notion-token-store.ts tests/notion-token-store.spec.ts
git commit -m "feat: NotionTokenStore over ctx.credentials (single atomic JSON entry)"
```

---

### Task 6: 本地回调服务器

**Files:**
- Create: `src/login-server.ts`
- Test: `tests/login-server.spec.ts`

**Interfaces:**
- Produces:
  - `interface LoginCallback { code: string; state: string }`
  - `startLoginServer(expectedState: string, port: number): Promise<{ redirectUri: string; wait: Promise<LoginCallback> }>`
    - `redirectUri` 为实际绑定地址（端口为 `0` 时读取系统分配端口，便于测试）。
    - `wait` 在收到合法 `/callback?code&state` 时 resolve（已校验 state 与 error）；`state` 不匹配则 reject；服务器在单次回调后自关。

- [ ] **Step 1: 写失败测试**

```ts
// tests/login-server.spec.ts
import { describe, it, expect } from 'vitest'
import { startLoginServer } from '../src/login-server.js'

it('resolves with code+state on a valid callback', async () => {
  const { redirectUri, wait } = await startLoginServer('expected-state', 0)
  const url = new URL(redirectUri)
  url.searchParams.set('code', 'auth-code')
  url.searchParams.set('state', 'expected-state')
  const p = wait
  await fetch(url)
  expect(await p).toEqual({ code: 'auth-code', state: 'expected-state' })
})

it('rejects when state does not match', async () => {
  const { redirectUri, wait } = await startLoginServer('expected-state', 0)
  const url = new URL(redirectUri)
  url.searchParams.set('code', 'auth-code')
  url.searchParams.set('state', 'wrong')
  await fetch(url)
  await expect(wait).rejects.toThrow(/state/i)
})

it('rejects on OAuth error', async () => {
  const { redirectUri, wait } = await startLoginServer('expected-state', 0)
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  await fetch(url)
  await expect(wait).rejects.toThrow(/access_denied/)
})
```

- [ ] **Step 2: 运行验证失败**

Run: `npm test`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```ts
// src/login-server.ts
import { createServer, type Server } from 'node:http'

export interface LoginCallback { code: string; state: string }

export function startLoginServer(
  expectedState: string,
  port: number,
): Promise<{ redirectUri: string; wait: Promise<LoginCallback> }> {
  return new Promise((resolveListen, rejectListen) => {
    let resolveWait!: (r: LoginCallback) => void
    let rejectWait!: (e: Error) => void
    const wait = new Promise<LoginCallback>((resolve, reject) => {
      resolveWait = resolve
      rejectWait = reject
    })

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const respond = (body: string, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(body)
        server.close()
      }
      const error = url.searchParams.get('error')
      if (error) {
        respond('<h1>授权失败</h1>')
        rejectWait(new Error(`OAuth error: ${error}`))
        return
      }
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) {
        respond('<h1>缺少 code 或 state</h1>')
        rejectWait(new Error('missing code or state'))
        return
      }
      if (state !== expectedState) {
        respond('<h1>state 校验失败</h1>')
        rejectWait(new Error('state mismatch'))
        return
      }
      respond('<h1>授权成功，可关闭此页</h1>')
      resolveWait({ code, state })
    })

    server.on('error', rejectListen)
    server.listen(port, '127.0.0.1', () => {
      const actual = (server.address() as { port: number }).port
      resolveListen({ redirectUri: `http://127.0.0.1:${actual}/callback`, wait })
    })
  })
}
```

- [ ] **Step 4: 运行验证通过**

Run: `npm test`
Expected: 3 个新用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/login-server.ts tests/login-server.spec.ts
git commit -m "feat: localhost OAuth callback server with state validation"
```

---

### Task 7: 插件本体（挂载 mcp-client + 登录命令 + 刷新）

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `NotionTokenStore`、`startLoginServer`、`discoverOAuth` / `registerClient` / `buildAuthorizeUrl` / `exchangeCode` / `refreshAccessToken` / `InvalidGrantError`、`@deepseek-ai/dsh-mcp-client`（`import * as mcpClient`）、`@deepseek-ai/dsh-cmdline` 的 `parseCmdline`、`@deepseek-ai/schemastery` 的 `z`
- Produces: `export const name = 'notion'`、`export const inject = ['cmdlineArgs', 'credentials']`、`export const Config = z.object({ mcpUrl: z.string().default('https://mcp.notion.com/mcp'), port: z.number().default(53007) })`、`export function apply(ctx: Context, config: Config): Promise<void>`

- [ ] **Step 1: 写 Config 与 apply 骨架（先让 `notion login` 命令能打印，不含挂载）**

```ts
// src/index.ts
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Command } from 'commander'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'

export const name = 'notion'
export const inject = ['cmdlineArgs', 'credentials']

export const Config = z.object({
  mcpUrl: z.string().default('https://mcp.notion.com/mcp'),
  port: z.number().default(53007),
})

type Cfg = { mcpUrl: string; port: number }

export function apply(ctx: Context, config: Cfg): void {
  const program = new Command()
  const notion = program.command('notion').description('Notion integration')
  notion
    .command('login')
    .description('Authorize Notion via the official MCP OAuth flow')
    .action(() => {
      void ctx.logger.info('[dsh-notion] login flow starts here (Task 7)')
    })
  parseCmdline(ctx, program)
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 通过。若 `commander` 未被 dsh-cmdline 透传，则 `npm i -D commander`（commander 作为运行时 peer，从 dsh 解析）。

- [ ] **Step 3: 实现 token 解析 + 挂载 + 刷新 + 登录，替换 apply**

完整实现分四块，全部写进 `src/index.ts`：

**3a. 挂载与刷新**

```ts
async function mountMcp(ctx: Context, accessToken: string, config: Cfg, slot: { child?: Fiber }): Promise<void> {
  if (slot.child) await slot.child.dispose()
  slot.child = ctx.plugin(mcpClient, {
    transport: 'streamable-http',
    serverName: 'notion',
    url: config.mcpUrl,
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
```

**3b. 静默刷新（互斥锁 + invalid_grant 终态）**

```ts
async function refreshAndMount(
  ctx: Context,
  store: NotionTokenStore,
  config: Cfg,
  slot: { child?: Fiber },
  refreshMutex: { running: boolean },
): Promise<void> {
  if (refreshMutex.running) return
  refreshMutex.running = true
  try {
    const tokens = await store.load()
    if (!tokens) return
    const disc = await discoverOAuth(config.mcpUrl)
    let next
    try {
      next = await refreshAccessToken(disc.tokenEndpoint, { clientId: tokens.clientId, refreshToken: tokens.refreshToken })
    } catch (e) {
      if (e instanceof InvalidGrantError) {
        await store.clear()
        ctx.logger.error('[dsh-notion] invalid_grant: run `dsh notion login` to re-authorize')
        return
      }
      throw e
    }
    const refreshed: NotionTokens = {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      expiresAt: Date.now() + next.expiresIn * 1000,
      clientId: tokens.clientId,
    }
    await store.save(refreshed) // single atomic write (rotated refresh persisted with access)
    await mountMcp(ctx, refreshed.accessToken, config, slot)
  } finally {
    refreshMutex.running = false
  }
}
```

**3c. 登录流程**

```ts
async function runLogin(ctx: Context, store: NotionTokenStore, config: Cfg, slot: { child?: Fiber }): Promise<void> {
  const redirectBase = `http://127.0.0.1:${config.port}/callback`
  const disc = await discoverOAuth(config.mcpUrl)
  const { clientId } = await registerClient(disc.registrationEndpoint, [redirectBase])
  const verifier = generateVerifier()
  const state = generateState()
  const authorizeUrl = buildAuthorizeUrl(disc.authorizationEndpoint, {
    clientId,
    redirectUri: redirectBase,
    state,
    codeChallenge: computeChallenge(verifier),
  })
  ctx.logger.info(`[dsh-notion] open this URL to authorize Notion:\n${authorizeUrl}`)
  const { wait } = await startLoginServer(state, config.port)
  const cb = await wait
  const tokens = await exchangeCode(disc.tokenEndpoint, {
    clientId, code: cb.code, redirectUri: redirectBase, codeVerifier: verifier,
  })
  const stored: NotionTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken!,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    clientId,
  }
  await store.save(stored)
  await mountMcp(ctx, stored.accessToken, config, slot)
  ctx.logger.info('[dsh-notion] authorized — Notion tools now available as mcp__notion__*')
}
```

**3d. apply 组装（载入 token → 挂载或刷新；注册命令；调度到期刷新）**

```ts
export function apply(ctx: Context, config: Cfg): void {
  const store = new NotionTokenStore(ctx.credentials)
  const slot: { child?: Fiber } = {}
  const refreshMutex = { running: false }

  // 启动时：有 token 直接挂载；过期则静默刷新；无 token 则提示。
  void (async () => {
    const tokens = await store.load()
    if (!tokens) {
      ctx.logger.info('[dsh-notion] not authorized — run `dsh notion login`')
      return
    }
    if (tokens.expiresAt > Date.now() + 60_000) {
      await mountMcp(ctx, tokens.accessToken, config, slot)
      scheduleRefresh(ctx, store, config, slot, refreshMutex, tokens.expiresAt)
    } else {
      await refreshAndMount(ctx, store, config, slot, refreshMutex)
      const fresh = await store.load()
      if (fresh) scheduleRefresh(ctx, store, config, slot, refreshMutex, fresh.expiresAt)
    }
  })().catch((e) => ctx.logger.error(e))

  // 登录命令
  const program = new Command()
  program
    .command('notion')
    .command('login')
    .description('Authorize Notion via the official MCP OAuth flow')
    .action(() => {
      void runLogin(ctx, store, config, slot)
        .then(() => ctx.appExit?.(0))
        .catch((e) => { ctx.logger.error(e); ctx.appExit?.(1) })
    })
  parseCmdline(ctx, program)

  // 卸载时关闭子 mcp-client
  ctx.on('dispose', () => { void slot.child?.dispose() })
}

function scheduleRefresh(
  ctx: Context,
  store: NotionTokenStore,
  config: Cfg,
  slot: { child?: Fiber },
  refreshMutex: { running: boolean },
  expiresAt: number,
): void {
  const delay = Math.max(60_000, expiresAt - Date.now() - 5 * 60_000) // 到期前 5 分钟
  ctx.setTimeout(() => {
    void refreshAndMount(ctx, store, config, slot, refreshMutex).then(() => {
      void store.load().then((t) => { if (t) scheduleRefresh(ctx, store, config, slot, refreshMutex, t.expiresAt) })
    })
  }, delay)
}
```

- [ ] **Step 4: 类型检查 + 单测（仅保证编译与纯函数回归）**

Run: `npm run typecheck && npm test`
Expected: 通过。`ctx.appExit` / `ctx.setTimeout` / `ctx.on` 为 Cordis 上下文 API（`appExit` 由 `dsh-cmdline` 的启动器提供，若类型报缺则用 `(ctx as any).appExit` 并注释原因）。

- [ ] **Step 5: 手动验证（本地 harness）**

Run（在 `../deepseek-harness` 内，`dsh-notion` 已 `npm run build`）：
```sh
cd /Users/admin/Mingdom/deepseek-harness
pnpm dsh web --patch /Users/admin/Mingdom/dsh-notion/cordis.patch.yml
# 另开终端验证登录命令：
pnpm dsh --patch /Users/admin/Mingdom/dsh-notion/cordis.patch.yml notion login
```
Expected: 首次启动日志提示 `not authorized — run dsh notion login`；`notion login` 打印 authorize URL；浏览器授权后回调、打印 `authorized`。真实 Notion 授权需手动（无自动化）。若需先跑通链路的 mock 版，临时把 `config.mcpUrl` 指向本地 mock MCP+OAuth 服务。

- [ ] **Step 6: Commit**

```bash
git add src/index.ts
git commit -m "feat: notion plugin — mount mcp-client, login command, refresh scheduling"
```

---

### Task 8: 端到端安装验证 + 发布与收录

**Files:**
- Create: `README.md`
- Modify: `package.json`（确认 `files`、`prepare` 无误）

**Interfaces:** 无新代码接口。

- [ ] **Step 1: 从本地安装到 profile 验证 bundle 形态**

Run:
```sh
cd /Users/admin/Mingdom/deepseek-harness
pnpm dsh plugin --profile demo add /Users/admin/Mingdom/dsh-notion
pnpm dsh --profile demo --dump-config   # 应出现 "# == dsh-notion" 层
pnpm dsh --profile demo web             # 工具以 mcp__notion__* 出现（需先 login）
```
Expected: `--dump-config` 含 `dsh-notion` 层；`notion login` 后可看到 Notion 工具。

- [ ] **Step 2: 写 README.md**（安装、`dsh notion login`、卸载、OAuth 说明、权限/安全提示、致谢 Notion MCP）

- [ ] **Step 3: 打 `dsh-plugin` topic + 发布 npm**

```sh
cd /Users/admin/Mingdom/dsh-notion
git add -A && git commit -m "docs: README"
git remote add origin git@github.com:<you>/dsh-notion.git && git push -u origin main
# 在 GitHub 仓库 Settings 里加 topic: dsh-plugin
npm publish   # 或 npm publish --access public
```

- [ ] **Step 4: PR 到 awesome-dsh-plugin**

在 `Notifications & Integrations` 分类下，`README.md` 与 `README.zh.md` 各加一行：
```markdown
- [<you>/dsh-notion](https://github.com/<you>/dsh-notion) - Connect dsh to Notion via the official Notion MCP (OAuth + PKCE): read and write pages, databases, and comments through `mcp__notion__*` tools.
```
中文版对应翻译。提交 PR，勾选 PR 模板四项自查。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: release README and distribution prep"
```

---

## Self-Review 记录

- **Spec 覆盖**：PKCE/state → Task 2；发现+DCR → Task 3；交换+刷新+invalid_grant 终态 → Task 4；token 存 ctx.credentials（单条原子 JSON）→ Task 5；本地回调+state 校验 → Task 6；挂载 mcp-client + `notion login` + 刷新调度/互斥 → Task 7；安装验证 + npm + awesome 收录 → Task 8。无遗漏。
- **占位符**：无 TBD/TODO；`<you>` 为发布阶段用户自填，属正常变量。
- **类型一致性**：`NotionTokens`（Task 5）在 Task 7 复用；`startLoginServer`/`discoverOAuth`/`registerClient`/`exchangeCode`/`refreshAccessToken`/`InvalidGrantError` 的签名跨 Task 3/4/6/7 一致；`mountMcp` 的 `slot.child` 类型 `Fiber` 与 `ctx.plugin` 返回一致。
