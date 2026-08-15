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
