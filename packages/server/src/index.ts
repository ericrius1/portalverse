import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { RegistryFile, ServerNetMessage } from '../../core/src/types';
import { parseClientMessage, serializeServerMessage, MAX_CLIENT_MESSAGE_BYTES } from './protocol';
import { RoomManager, type Outbound } from './roomManager';

export { RoomManager } from './roomManager';
export * from './protocol';

export interface PortalverseServerOptions {
  port?: number;
  host?: string;
  /** Registry used for friendly world names; defaults to the repo's registry.json. */
  registry?: RegistryFile;
  /** Heartbeat interval for dead-socket cleanup (ms). */
  heartbeatMs?: number;
  /** Silence startup logs (tests). */
  quiet?: boolean;
}

export interface PortalverseServer {
  server: Server;
  wss: WebSocketServer;
  roomManager: RoomManager;
  /** Starts listening; resolves with the bound port (useful with port 0). */
  start: () => Promise<{ port: number; host: string }>;
  stop: () => Promise<void>;
}

const DEFAULT_PORT = 3001;
const DEFAULT_HOST = '0.0.0.0';

function loadRegistry(): RegistryFile | undefined {
  try {
    const path = fileURLToPath(new URL('../../../registry.json', import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')) as RegistryFile;
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

interface TrackedSocket extends WebSocket {
  isAlive?: boolean;
  connectionId?: string;
}

export function createPortalverseServer(options: PortalverseServerOptions = {}): PortalverseServer {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const registry = options.registry ?? loadRegistry();
  const startedAt = Date.now();

  const worldNames: Record<string, string> = {};
  for (const w of registry?.worlds ?? []) {
    if (w.kind === 'local') worldNames[w.id] = w.name;
  }
  const roomManager = new RoomManager({
    worldNames,
    defaultWorldId: registry?.defaultWorldId ?? 'hub',
  });

  const sockets = new Map<string, TrackedSocket>();
  let connectionCounter = 0;

  const dispatch = (outbound: Outbound[]): void => {
    for (const { to, message } of outbound) {
      const data = serializeServerMessage(message);
      for (const id of to) {
        const ws = sockets.get(id);
        if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    }
  };

  const sendTo = (ws: WebSocket, message: ServerNetMessage): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(serializeServerMessage(message));
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    applyCors(res);
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
      return;
    }
    if (pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        uptimeMs: Date.now() - startedAt,
        totalPlayers: roomManager.getTotalPlayers(),
        worlds: roomManager.getWorldSummaries(),
      });
      return;
    }
    if (pathname === '/api/worlds') {
      sendJson(res, 200, { worlds: roomManager.getWorldSummaries() });
      return;
    }
    sendJson(res, 404, { ok: false, error: 'not_found' });
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_CLIENT_MESSAGE_BYTES });

  wss.on('connection', (socket: WebSocket) => {
    const ws = socket as TrackedSocket;
    const connectionId = `c${++connectionCounter}`;
    ws.connectionId = connectionId;
    ws.isAlive = true;
    sockets.set(connectionId, ws);

    ws.on('pong', () => {
      ws.isAlive = true;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      ws.isAlive = true;
      if (isBinary) {
        sendTo(ws, { type: 'error', code: 'bad_message', message: 'Binary frames are not supported' });
        return;
      }
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        sendTo(ws, { type: 'error', code: 'bad_message', message: 'Malformed or invalid message' });
        return;
      }
      dispatch(roomManager.handleMessage(connectionId, msg));
    });
    const cleanup = () => {
      if (!sockets.has(connectionId)) return;
      sockets.delete(connectionId);
      dispatch(roomManager.disconnect(connectionId));
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });

  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const start = () =>
    new Promise<{ port: number; host: string }>((resolveStart, reject) => {
      const onError = (err: Error) => reject(err);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.off('error', onError);
        heartbeat = setInterval(() => {
          for (const ws of sockets.values()) {
            if (ws.isAlive === false) {
              ws.terminate();
              continue;
            }
            ws.isAlive = false;
            try {
              ws.ping();
            } catch {
              ws.terminate();
            }
          }
        }, heartbeatMs);
        heartbeat.unref?.();
        const address = server.address();
        const boundPort = typeof address === 'object' && address ? address.port : port;
        if (!options.quiet) {
          console.log(`[portalverse] server listening on http://${host}:${boundPort} (ws path /ws)`);
        }
        resolveStart({ port: boundPort, host });
      });
    });

  const stop = () =>
    new Promise<void>((resolveStop) => {
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = undefined;
      for (const ws of sockets.values()) ws.terminate();
      wss.close(() => {
        if (!server.listening) {
          resolveStop();
          return;
        }
        server.close(() => resolveStop());
        server.closeAllConnections?.();
      });
    });

  return { server, wss, roomManager, start, stop };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const target = realpathSync(resolve(entry));
    return self === target || self.replace(/\.[cm]?[jt]s$/, '') === target.replace(/\.[cm]?[jt]s$/, '');
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const port = Number.parseInt(process.env.PORT ?? '', 10);
  const app = createPortalverseServer({
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    host: process.env.HOST ?? DEFAULT_HOST,
  });
  app.start().catch((err) => {
    console.error('[portalverse] failed to start server:', err);
    process.exit(1);
  });
  const shutdown = () => {
    app.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
