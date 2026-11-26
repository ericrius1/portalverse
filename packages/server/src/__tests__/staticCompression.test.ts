import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, request, type IncomingHttpHeaders } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createPortalverseServer, type PortalverseServer } from '../index';
import { precompressDirectory } from '../../../../scripts/precompress';

const script = 'export const portal = "portalverse";\n'.repeat(400);
const page = `<!doctype html><title>Portalverse</title>${'<p>portal</p>'.repeat(400)}`;
const picture = Buffer.alloc(8000, 7);

let root: string;
let app: PortalverseServer;
let port: number;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'portalverse-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), page);
  writeFileSync(join(root, 'assets', 'app-abc.js'), script);
  writeFileSync(join(root, 'assets', 'tiny-abc.js'), 'export {};');
  writeFileSync(join(root, 'assets', 'shot-abc.png'), picture);
  await precompressDirectory(root);
  app = createPortalverseServer({ port: 0, host: '127.0.0.1', quiet: true, staticDir: root });
  port = (await app.start()).port;
});

afterAll(async () => {
  await app.stop();
  rmSync(root, { recursive: true, force: true });
});

/** A raw request: unlike fetch, node:http neither asks for compression nor undoes it. */
function load(path: string, acceptEncoding?: string, method = 'GET') {
  return new Promise<{ headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const headers = acceptEncoding === undefined ? {} : { 'accept-encoding': acceptEncoding };
    const req = (method === 'GET' ? get : request)({ port, host: '127.0.0.1', path, method, headers }, res => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (method !== 'GET') req.end();
  });
}

describe('precompressing the build', () => {
  it('writes Brotli and gzip copies that restore the original', () => {
    const file = join(root, 'assets', 'app-abc.js');
    expect(brotliDecompressSync(readFileSync(`${file}.br`)).toString()).toBe(script);
    expect(gunzipSync(readFileSync(`${file}.gz`)).toString()).toBe(script);
  });

  it('skips images and files too small to gain anything', () => {
    for (const name of ['shot-abc.png', 'tiny-abc.js']) {
      expect(existsSync(join(root, 'assets', `${name}.br`)), name).toBe(false);
      expect(existsSync(join(root, 'assets', `${name}.gz`)), name).toBe(false);
    }
  });

  it('does not compress its own output when run again', async () => {
    await precompressDirectory(root);
    expect(existsSync(join(root, 'assets', 'app-abc.js.br.gz'))).toBe(false);
    expect(existsSync(join(root, 'assets', 'app-abc.js.gz.br'))).toBe(false);
  });
});

describe('serving compressed static files', () => {
  it('prefers Brotli, keeping the type and long-term caching', async () => {
    const { headers, body } = await load('/assets/app-abc.js', 'gzip, deflate, br, zstd');
    expect(headers['content-encoding']).toBe('br');
    expect(headers['content-type']).toBe('application/javascript; charset=utf-8');
    expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(headers.vary).toBe('Accept-Encoding');
    expect(Number(headers['content-length'])).toBe(body.length);
    expect(body.length).toBeLessThan(script.length / 4);
    expect(brotliDecompressSync(body).toString()).toBe(script);
  });

  it('falls back to gzip', async () => {
    const { headers, body } = await load('/assets/app-abc.js', 'gzip, deflate');
    expect(headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(body).toString()).toBe(script);
  });

  it('honours an encoding refused with q=0', async () => {
    const { headers } = await load('/assets/app-abc.js', 'br;q=0, gzip;q=0.5');
    expect(headers['content-encoding']).toBe('gzip');
  });

  it('sends the original to a client that accepts no encoding, and still varies on it', async () => {
    const { headers, body } = await load('/assets/app-abc.js');
    expect(headers['content-encoding']).toBeUndefined();
    expect(headers.vary).toBe('Accept-Encoding');
    expect(body.toString()).toBe(script);
  });

  it('sends files without a compressed copy as they are', async () => {
    const { headers, body } = await load('/assets/shot-abc.png', 'br, gzip');
    expect(headers['content-encoding']).toBeUndefined();
    expect(body.equals(picture)).toBe(true);
  });

  it('compresses the page for the app routes too', async () => {
    const { headers, body } = await load('/some/room', 'br');
    expect(headers['content-encoding']).toBe('br');
    expect(headers['content-type']).toBe('text/html; charset=utf-8');
    expect(headers['cache-control']).toBe('no-cache');
    expect(brotliDecompressSync(body).toString()).toBe(page);
  });

  it('answers HEAD with the headers of the compressed file', async () => {
    const full = await load('/assets/app-abc.js', 'br');
    const head = await load('/assets/app-abc.js', 'br', 'HEAD');
    expect(head.headers['content-encoding']).toBe('br');
    expect(head.headers['content-length']).toBe(full.headers['content-length']);
    expect(head.body.length).toBe(0);
  });
});
