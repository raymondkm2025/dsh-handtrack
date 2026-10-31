// dsh-handtrack host half — minimal, just an HTTP echo for camera status.
// All heavy lifting (MediaPipe + Three.js) runs in the browser client.

export default function register(ctx) {
  const http = ctx.get('httpServer')
  if (http) {
    http.onRequest((req, res) => {
      if (req.url === '/dsh-handtrack/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', mode: 'browser-only' }))
      } else if (req.url === '/dsh-handtrack/camera') {
        // Camera runs entirely client-side; this endpoint just confirms capability.
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ available: true, note: 'camera controlled by browser client' }))
      } else {
        res.writeHead(404).end()
      }
    })
  }

  ctx.systemPrompt.context({
    name: 'handtrack-status',
    order: 900,
    text: () => '' // no injection needed
  })
}
