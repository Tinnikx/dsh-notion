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
