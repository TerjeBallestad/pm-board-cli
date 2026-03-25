import { Router } from 'express';

const router = Router();
const clients = new Set();

router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('\n');

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Keepalive every 30s
setInterval(() => {
  for (const res of clients) {
    res.write(': keepalive\n\n');
  }
}, 30_000).unref();

export function emit(entity, id, action) {
  const payload = JSON.stringify({ entity, id, action });
  for (const res of clients) {
    res.write(`data: ${payload}\n\n`);
  }
}

export default router;
