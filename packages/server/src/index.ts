import { livePortalSlots } from '../../core/src/portal/roomLayout';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
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
  /** Optional directory containing built Vite frontend assets (e.g. `dist`). */
  staticDir?: string;
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

export interface RtcIceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const DEFAULT_ICE_SERVERS: RtcIceServerConfig[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function loadIceServers(): RtcIceServerConfig[] {
  const raw = process.env.ICE_SERVERS_JSON;
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as RtcIceServerConfig[];
    }
  } catch {
    // Ignore malformed ICE_SERVERS_JSON override
  }
  return DEFAULT_ICE_SERVERS;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.hdr': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function defaultStaticDir(): string | undefined {
  const dir = fileURLToPath(new URL('../../../dist', import.meta.url));
  return existsSync(join(dir, 'index.html')) ? dir : undefined;
}

/** Copies the build writes beside a file (scripts/precompress.ts), best first. */
const ENCODINGS = [
  { name: 'br', suffix: '.br' },
  { name: 'gzip', suffix: '.gz' },
] as const;

/** Whether an Accept-Encoding header names this encoding without refusing it (`q=0`). */
function accepts(header: string, encoding: string): boolean {
  return header.split(',').some((entry) => {
    const [name, ...params] = entry.split(';').map((part) => part.trim().toLowerCase());
    return name === encoding && !params.some((p) => p.startsWith('q=') && Number(p.slice(2)) === 0);
  });
}

function serveFile(res: ServerResponse, filePath: string, method: string, cacheControl: string): void {
  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const copies = ENCODINGS.filter((e) => existsSync(filePath + e.suffix));
  const acceptEncoding = String(res.req.headers['accept-encoding'] ?? '');
  const encoding = copies.find((e) => accepts(acceptEncoding, e.name));
  const sentPath = encoding ? filePath + encoding.suffix : filePath;
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': statSync(sentPath).size,
    'Cache-Control': cacheControl,
    ...(copies.length ? { Vary: 'Accept-Encoding' } : {}),
    ...(encoding ? { 'Content-Encoding': encoding.name } : {}),
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(sentPath).pipe(res);
}

function tryServeStatic(staticRoot: string, pathname: string, method: string, res: ServerResponse): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = resolve(staticRoot, rel);
  const insideRoot = candidate === staticRoot || candidate.startsWith(staticRoot + sep);
  if (insideRoot && existsSync(candidate) && statSync(candidate).isFile()) {
    const isHashedAsset = decoded.startsWith('/assets/');
    serveFile(
      res,
      candidate,
      method,
      isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    return true;
  }
  // Never rewrite missing /api/* or /assets/* requests to index.html.
  if (decoded.startsWith('/api/') || decoded.startsWith('/assets/') || extname(rel)) {
    return false;
  }
  const indexPath = join(staticRoot, 'index.html');
  if (existsSync(indexPath)) {
    serveFile(res, indexPath, method, 'no-cache');
    return true;
  }
  return false;
}

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
  const staticRoot = options.staticDir ? resolve(options.staticDir) : undefined;
  const startedAt = Date.now();

  const worldNames: Record<string, string> = {};
  for (const w of registry?.worlds ?? []) {
    if (w.kind === 'local') worldNames[w.id] = w.name;
  }
  const roomManager = new RoomManager({
    worldNames,
    livePortalLimits: new Map((registry?.worlds ?? []).map(w => [w.id, livePortalSlots(w)])),
    defaultWorldId: registry?.defaultWorldId ?? 'jp-world',
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
    if (pathname === '/api/rtc-config') {
      sendJson(res, 200, { iceServers: loadIceServers() });
      return;
    }
    if (staticRoot && tryServeStatic(staticRoot, pathname, method, res)) {
      return;
    }
    if (pathname === '/') {
      sendJson(res, 200, {
        ok: true,
        service: 'portalverse-multiplayer',
        wsPath: '/ws',
        health: '/api/health',
        totalPlayers: roomManager.getTotalPlayers(),
      });
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
    staticDir: process.env.STATIC_DIR || defaultStaticDir(),
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
