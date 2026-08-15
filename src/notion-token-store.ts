import { credentialRef } from '@deepseek-ai/dsh-credentials'

const REF = credentialRef('NOTION_OAUTH')

export interface NotionTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch milliseconds
  clientId: string
}

/**
 * Structural view of dsh's credential seam, so the store binds to neither the
 * published (`Credentials`) nor local (`CredentialProvider`) class name.
 */
export interface CredentialStore {
  resolve(ref: unknown): Promise<{ value: string } | undefined>
  set(ref: unknown, value: string): Promise<void>
  unset(ref: unknown): Promise<void>
}

export class NotionTokenStore {
  constructor(private credentials: CredentialStore) {}

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
