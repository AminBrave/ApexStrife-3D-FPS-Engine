/**
 * server.ts
 * Express + WebSockets (ws) server entry point.
 * Hosts the authoritative 60Hz GameServer on `/ws` and serves the Vite client app on port 3000.
 */

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { GameServer } from './src/server/GameServer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const server = http.createServer(app);

  // 1. Mount Authoritative WebSocket Game Server
  const wss = new WebSocketServer({ server, path: '/ws' });
  const gameServer = new GameServer(wss);
  gameServer.start();

  // 2. Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', serverTickRate: 60, time: Date.now() });
  });

  // 3. Vite middleware (development) or Static files (production)
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.info(`[Server] Game Server & HTTP running on http://0.0.0.0:${PORT} (WS on /ws)`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
