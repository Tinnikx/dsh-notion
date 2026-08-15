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
