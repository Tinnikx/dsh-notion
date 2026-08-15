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
    // The wait promise may reject before a consumer attaches a handler (e.g. the
    // OAuth callback fires during the browser redirect). Swallow the no-op so Node
    // never reports an unhandled rejection; real handlers still receive the error.
    wait.catch(() => {})

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
