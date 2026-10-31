// Stand-in locale di APNs (Fase 26), condiviso da check:apns (piano 04) e check:push (piano 06).
//
// Un vero server HTTP/2 in chiaro (h2c) su 127.0.0.1: i frame, i flussi, il GOAWAY e il timeout sono quelli
// veri di node:http2, niente finto. Annota ogni richiesta (metodo, percorso, header, corpo grezzo) e risponde
// secondo la funzione `answer`, che sceglie per token di dispositivo (l'ultimo pezzo di /3/device/<token>).
// Non verifica nulla da se': le asserzioni stanno nel gate che lo usa.
import http2, { type Http2Session, type IncomingHttpHeaders } from 'node:http2'

export type StubAnswer =
  | { status: number; body?: string }
  | { goaway: true } // chiude la sessione senza rispondere
  | { hang: true } // non risponde mai
  | { status: 400; body: string; destroyAfter: true } // risponde e butta giu' la sessione, come APNs dopo BadDeviceToken

export type CapturedRequest = { method: string; path: string; headers: IncomingHttpHeaders; body: string }

export async function startApnsStub(
  answer: (deviceToken: string) => StubAnswer,
): Promise<{ origin: string; requests: CapturedRequest[]; close(): Promise<void> }> {
  const requests: CapturedRequest[] = []
  const sessions = new Set<Http2Session>()
  const server = http2.createServer()
  server.on('session', (session) => {
    sessions.add(session)
    session.on('error', () => {})
    session.on('close', () => sessions.delete(session))
  })
  server.on('stream', (stream, headers) => {
    let body = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk: string) => {
      body += chunk
    })
    stream.on('error', () => {})
    stream.on('end', () => {
      const path = String(headers[':path'] ?? '')
      requests.push({ method: String(headers[':method'] ?? ''), path, headers, body })
      const a = answer(path.split('/').pop() ?? '')
      if ('goaway' in a) {
        stream.session?.goaway()
        return
      }
      if ('hang' in a) return
      stream.respond({ ':status': a.status })
      stream.end(a.body ?? '')
      if ('destroyAfter' in a) stream.on('close', () => stream.session?.destroy())
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sessions) s.destroy()
        server.close(() => resolve())
      }),
  }
}
