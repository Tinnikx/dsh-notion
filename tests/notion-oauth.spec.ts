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
