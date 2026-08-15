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
