import { describe, it, expect } from 'vitest'
import { base64url, generateVerifier, computeChallenge, generateState } from '../src/notion-oauth.js'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { discoverOAuth, registerClient } from '../src/notion-oauth.js'

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
