# dsh-notion

Connect [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (`dsh`) to Notion through the
official Notion MCP server using OAuth 2.0 (authorization code + PKCE). After one-time
authorization, your `dsh` agent can search, read, and write Notion pages, databases, and
comments through the `mcp__notion__*` tools.

## Install

```sh
dsh plugin add dsh-notion
```

## Authorize

```sh
dsh notion login
```

The command registers a dynamic OAuth client (RFC 7591), starts a temporary local HTTP server
on `127.0.0.1:53007`, and prints an authorization URL. Open it in your browser and approve the
request; Notion redirects to `http://127.0.0.1:53007/callback` with an authorization code. The
plugin validates the `state`, exchanges the code (plus the PKCE verifier) for tokens, stores
them, and mounts the Notion MCP client.

After authorization, Notion tools appear under the `mcp__notion__*` namespace.

## Uninstall

```sh
dsh plugin --profile <name> remove dsh-notion
```

## Configuration

| Key     | Default                    | Description                              |
| ------- | -------------------------- | ---------------------------------------- |
| `mcpUrl` | `https://mcp.notion.com/mcp` | Notion MCP server URL                   |
| `port`  | `53007`                    | Local OAuth callback port (`127.0.0.1`) |

## Security

- OAuth tokens are stored through dsh's credential seam (`ctx.credentials`) as a single entry
  and are not committed to this repository. No `client_id` or secret is embedded; the client is
  registered at runtime via dynamic client registration.
- Notion refresh tokens rotate on every refresh; the new token is persisted atomically with the
  access token.
- If Notion returns `invalid_grant` (refresh token expired or rotated away), the plugin clears
  the stored tokens and stops retrying. Re-authorize with `dsh notion login`.
