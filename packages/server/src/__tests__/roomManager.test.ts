import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ClientNetMessage, ServerNetMessage } from '../../../core/src/types';
import { parseClientMessage, sanitizePortalDefinition, serializeServerMessage } from '../protocol';
import { RoomManager, type Outbound } from '../roomManager';
import { createPortalverseServer, type PortalverseServer } from '../index';
import { MultiplayerClient, type WebSocketLike } from '../../../core/src/net/multiplayerClient';

const WORLD_NAMES = { hub: 'Portal Hub', 'eric-world': "Eric's Room", 'jp-world': "JP's Room" };

function makeManager(extra: ConstructorParameters<typeof RoomManager>[0] = {}) {
  let t = 1000;
  return new RoomManager({ worldNames: WORLD_NAMES, now: () => ++t, ...extra });
}

function hello(id: string, name: string, worldId = 'hub', color = '#22d3ee'): ClientNetMessage {
  return { type: 'hello', player: { id, name, color }, worldId, position: [0, 0, 0], yaw: 0 };
}

function portal(id: string, extra: Record<string, unknown> = {}) {
  return { id, label: `Portal ${id}`, position: [1, 0, 2], targetWorldId: 'jp-world', ...extra };
}

function sentTo(out: Outbound[], conn: string): ServerNetMessage[] {
  return out.filter((o) => o.to.includes(conn)).map((o) => o.message);
}

function events(out: Outbound[]): string[] {
  return out
    .map((o) => o.message)
    .filter((m): m is Extract<ServerNetMessage, { type: 'roster_update' }> => m.type === 'roster_update')
    .map((m) => m.event)
    .filter((e): e is string => !!e);
}

// ---------------------------------------------------------------------------
// protocol
// ---------------------------------------------------------------------------

describe('protocol: parseClientMessage', () => {
  it('accepts a valid hello and normalizes color', () => {
    const msg = parseClientMessage(
      JSON.stringify({
        type: 'hello',
        player: { id: 'eric-1', name: '  Eric  ', color: '#0Af' },
        worldId: 'hub',
        position: [1, 2, 3],
        yaw: 0.5,
        extra: 'dropped',
      }),
    );
    expect(msg).toEqual({
      type: 'hello',
      player: { id: 'eric-1', name: 'Eric', color: '#00aaff' },
      worldId: 'hub',
      position: [1, 2, 3],
      yaw: 0.5,
    });
  });

  it('rejects malformed JSON, unknown types and non-objects', () => {
    expect(parseClientMessage('{nope')).toBeNull();
    expect(parseClientMessage('')).toBeNull();
    expect(parseClientMessage('[]')).toBeNull();
    expect(parseClientMessage('"state"')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'teleport_everyone' }))).toBeNull();
    expect(parseClientMessage('x'.repeat(20_000))).toBeNull();
  });

  it('rejects non-finite or missing numbers', () => {
    // JSON cannot carry NaN/Infinity, but huge exponents overflow to Infinity.
    expect(parseClientMessage('{"type":"state","position":[1e999,0,0],"yaw":0,"velocityY":0}')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'state', position: [0, 0], yaw: 0, velocityY: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'state', position: [0, '1', 0], yaw: 0, velocityY: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'state', position: [0, 0, 0], yaw: null, velocityY: 0 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'ping', t: 'now' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'state', position: [0, 1, 0], yaw: 1, velocityY: -2 }))).toEqual({
      type: 'state',
      position: [0, 1, 0],
      yaw: 1,
      velocityY: -2,
    });
  });

  it('rejects invalid colors, ids and empty names', () => {
    const base = { type: 'update_profile', name: 'Eric' };
    expect(parseClientMessage(JSON.stringify({ ...base, color: 'red' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...base, color: 'url(javascript:alert(1))' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...base, color: '#12345' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'update_profile', name: '<>', color: '#fff' }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: 'switch_world', worldId: '../etc/passwd', position: [0, 0, 0], yaw: 0 })),
    ).toBeNull();
  });

  it('strips markup characters from names (XSS)', () => {
    const msg = parseClientMessage(
      JSON.stringify({ type: 'update_profile', name: '<img src=x onerror=alert(1)>JP', color: '#f59e0b' }),
    );
    expect(msg?.type).toBe('update_profile');
    if (msg?.type !== 'update_profile') throw new Error('unreachable');
    expect(msg.name).not.toMatch(/[<>]/);
    expect(msg.name.length).toBeLessThanOrEqual(32);
  });

  it('serializes server messages as JSON', () => {
    const msg: ServerNetMessage = { type: 'pong', t: 42 };
    expect(JSON.parse(serializeServerMessage(msg))).toEqual(msg);
  });
});

describe('protocol: sanitizePortalDefinition', () => {
  it('keeps valid fields, truncates label/subtitle, sets createdBy', () => {
    const p = sanitizePortalDefinition(
      portal('p1', {
        label: 'L'.repeat(80),
        subtitle: 'S'.repeat(90),
        targetHubStyle: 'meadow',
        remoteUrl: 'https://friend.example.com/?world=hub',
        colorA: '#ABCDEF',
        evil: '<script>',
      }),
      'eric',
    );
    expect(p).not.toBeNull();
    expect(p!.label).toHaveLength(40);
    expect(p!.subtitle).toHaveLength(60);
    expect(p!.targetHubStyle).toBe('meadow');
    expect(p!.remoteUrl).toBe('https://friend.example.com/?world=hub');
    expect(p!.colorA).toBe('#abcdef');
    expect(p!.createdBy).toBe('eric');
    expect(p).not.toHaveProperty('evil');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com',
    'https://user:pass@example.com',
    'not a url',
  ])('rejects unsafe remoteUrl %s', (remoteUrl) => {
    expect(sanitizePortalDefinition(portal('p1', { remoteUrl }))).toBeNull();
  });

  it('rejects bad hub styles, colors, positions and ids', () => {
    expect(sanitizePortalDefinition(portal('p1', { targetHubStyle: 'lava' }))).toBeNull();
    expect(sanitizePortalDefinition(portal('p1', { colorB: 'blue' }))).toBeNull();
    expect(sanitizePortalDefinition(portal('p1', { position: [0, Infinity, 0] }))).toBeNull();
    expect(sanitizePortalDefinition(portal('p1', { position: [0, 0] }))).toBeNull();
    expect(sanitizePortalDefinition(portal('<x>'))).toBeNull();
    expect(sanitizePortalDefinition(portal('p1', { targetWorldId: '' }))).toBeNull();
    expect(sanitizePortalDefinition(null)).toBeNull();
    expect(sanitizePortalDefinition('portal')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

describe('RoomManager', () => {
  it('welcomes a player and announces their arrival with friendly names', () => {
    const rm = makeManager();
    const out = rm.handleMessage('c1', hello('eric', 'Eric', 'eric-world'));
    const welcome = sentTo(out, 'c1').find((m) => m.type === 'welcome');
    expect(welcome).toMatchObject({ type: 'welcome', playerId: 'eric', worldId: 'eric-world', players: [] });
    expect(events(out)).toEqual(["Eric joined the metaverse in Eric's Room"]);
    expect(rm.getRoster().map((a) => a.id)).toEqual(['eric']);
  });

  it('requires hello before other messages', () => {
    const rm = makeManager();
    const out = rm.handleMessage('c1', { type: 'state', position: [0, 0, 0], yaw: 0, velocityY: 0 });
    expect(out).toEqual([{ to: ['c1'], message: expect.objectContaining({ type: 'error', code: 'not_joined' }) }]);
  });

  it('answers pings', () => {
    const rm = makeManager();
    expect(rm.handleMessage('c1', { type: 'ping', t: 7 })).toEqual([{ to: ['c1'], message: { type: 'pong', t: 7 } }]);
  });

  it('isolates state updates per world room', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    rm.handleMessage('c2', hello('jp', 'JP', 'hub'));
    rm.handleMessage('c3', hello('max', 'Max', 'jp-world'));

    const out = rm.handleMessage('c1', { type: 'state', position: [1, 2, 3], yaw: 0.1, velocityY: 0.5 });
    expect(out).toHaveLength(1);
    expect(out[0].to).toEqual(['c2']);
    expect(out[0].message).toMatchObject({ type: 'player_state', playerId: 'eric', position: [1, 2, 3] });
    expect(rm.getPlayersInWorld('hub').map((a) => a.id).sort()).toEqual(['eric', 'jp']);
    expect(rm.getPlayersInWorld('jp-world').map((a) => a.id)).toEqual(['max']);
  });

  it('second player in a world sees the first in welcome; first gets player_joined', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    const out = rm.handleMessage('c2', hello('jp', 'JP', 'hub'));
    const welcome = sentTo(out, 'c2').find((m) => m.type === 'welcome');
    expect(welcome && welcome.type === 'welcome' && welcome.players.map((p) => p.id)).toEqual(['eric']);
    expect(sentTo(out, 'c1').map((m) => m.type)).toEqual(['player_joined', 'roster_update']);
  });

  it('switches worlds: leaves old room, joins new, emits travel event to everyone', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    rm.handleMessage('c2', hello('jp', 'JP', 'hub'));
    rm.handleMessage('c3', hello('max', 'Max', 'jp-world'));

    const out = rm.handleMessage('c1', { type: 'switch_world', worldId: 'jp-world', position: [0, 0, 10], yaw: 0 });
    expect(sentTo(out, 'c2').map((m) => m.type)).toEqual(['player_left', 'roster_update']);
    expect(sentTo(out, 'c3').map((m) => m.type)).toEqual(['player_joined', 'roster_update']);
    const welcome = sentTo(out, 'c1').find((m) => m.type === 'welcome');
    expect(welcome).toMatchObject({ worldId: 'jp-world' });
    expect(events(out)).toEqual(["Eric entered JP's Room"]);
    const roster = out.find((o) => o.message.type === 'roster_update')!;
    expect(roster.to.sort()).toEqual(['c1', 'c2', 'c3']);
    expect(rm.getPlayersInWorld('jp-world').map((a) => a.id).sort()).toEqual(['eric', 'max']);
  });

  it('emits a leave event on disconnect and frees the player id', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric'));
    rm.handleMessage('c2', hello('jp', 'JP'));
    const out = rm.disconnect('c2');
    expect(events(out)).toEqual(['JP left the metaverse']);
    expect(sentTo(out, 'c1').map((m) => m.type)).toEqual(['player_left', 'roster_update']);
    expect(rm.getRoster().map((a) => a.id)).toEqual(['eric']);
    expect(rm.disconnect('c2')).toEqual([]);
  });

  it('deduplicates player ids from two tabs', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric'));
    const out = rm.handleMessage('c2', hello('eric', 'Eric'));
    const welcome = sentTo(out, 'c2').find((m) => m.type === 'welcome');
    expect(welcome).toMatchObject({ playerId: 'eric-2' });
  });

  it('falls back to the default world when strict world list rejects hello world', () => {
    const rm = makeManager({ knownWorldIds: ['hub', 'eric-world', 'jp-world'], defaultWorldId: 'hub' });
    const out = rm.handleMessage('c1', hello('eric', 'Eric', 'mystery-world'));
    expect(sentTo(out, 'c1').find((m) => m.type === 'welcome')).toMatchObject({ worldId: 'hub' });
    const sw = rm.handleMessage('c1', { type: 'switch_world', worldId: 'mystery-world', position: [0, 0, 0], yaw: 0 });
    expect(sw[0].message).toMatchObject({ type: 'error', code: 'unknown_world' });
  });

  it('clamps positions, velocity and normalizes yaw', () => {
    const rm = makeManager({ positionLimit: 100 });
    rm.handleMessage('c1', hello('eric', 'Eric'));
    rm.handleMessage('c1', { type: 'state', position: [1e9, -1e9, 5], yaw: 7 * Math.PI, velocityY: 1e6 });
    const [a] = rm.getRoster();
    expect(a.position).toEqual([100, -100, 5]);
    expect(a.velocityY).toBe(200);
    expect(Math.abs(a.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });

  it('profile updates broadcast new name with a rename event', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric'));
    rm.handleMessage('c2', hello('jp', 'JP'));
    const out = rm.handleMessage('c1', { type: 'update_profile', name: 'Rick', color: '#ff00ff' });
    expect(events(out)).toEqual(['Eric is now known as Rick']);
    expect(sentTo(out, 'c2')[0]).toMatchObject({ type: 'player_joined', player: { name: 'Rick', color: '#ff00ff' } });
  });

  it('syncs dynamic portals to everyone in that world only, and to late joiners', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    rm.handleMessage('c2', hello('jp', 'JP', 'hub'));
    rm.handleMessage('c3', hello('max', 'Max', 'jp-world'));

    const out = rm.handleMessage('c1', {
      type: 'spawn_portal',
      worldId: 'hub',
      portal: { id: 'p1', label: 'To JP', position: [9e9, 0, 0], targetWorldId: 'jp-world', createdBy: 'spoofed' },
    });
    expect(out).toHaveLength(1);
    expect(out[0].to.sort()).toEqual(['c1', 'c2']);
    const spawned = out[0].message;
    expect(spawned).toMatchObject({ type: 'portal_spawned', worldId: 'hub', portal: { id: 'p1', createdBy: 'eric' } });
    expect(rm.getDynamicPortals('hub')[0].position[0]).toBe(5000);
    expect(rm.getDynamicPortals('jp-world')).toEqual([]);

    const late = rm.handleMessage('c4', hello('zoe', 'Zoe', 'hub'));
    const welcome = sentTo(late, 'c4').find((m) => m.type === 'welcome');
    expect(welcome && welcome.type === 'welcome' && welcome.dynamicPortals.map((p) => p.id)).toEqual(['p1']);
    expect(rm.getWorldSummaries().find((w) => w.worldId === 'hub')).toEqual({
      worldId: 'hub',
      playerCount: 3,
      dynamicPortalCount: 1,
    });
  });

  it('caps dynamic portals per world at 24', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    for (let i = 0; i < 24; i++) {
      const out = rm.handleMessage('c1', { type: 'spawn_portal', worldId: 'hub', portal: portal(`p${i}`) as never });
      expect(out[0].message.type).toBe('portal_spawned');
    }
    const over = rm.handleMessage('c1', { type: 'spawn_portal', worldId: 'hub', portal: portal('p24') as never });
    expect(over[0].message).toMatchObject({ type: 'error', code: 'portal_limit' });
    expect(rm.getDynamicPortals('hub')).toHaveLength(24);
    // Updating an existing portal still works at the cap.
    const upd = rm.handleMessage('c1', {
      type: 'spawn_portal',
      worldId: 'hub',
      portal: portal('p3', { label: 'Renamed' }) as never,
    });
    expect(upd[0].message).toMatchObject({ type: 'portal_spawned', portal: { label: 'Renamed' } });
  });

  it('rejects unsafe portals even if they bypass the protocol layer', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    const out = rm.handleMessage('c1', {
      type: 'spawn_portal',
      worldId: 'hub',
      portal: portal('evil', { remoteUrl: 'javascript:alert(1)' }) as never,
    });
    expect(out[0].message).toMatchObject({ type: 'error', code: 'invalid_portal' });
  });

  it('refuses portals into arbitrary unnamed, unoccupied worlds', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    const out = rm.handleMessage('c1', { type: 'spawn_portal', worldId: 'spam-1', portal: portal('p') as never });
    expect(out[0].message).toMatchObject({ type: 'error', code: 'unknown_world' });
    const ok = rm.handleMessage('c1', { type: 'spawn_portal', worldId: 'jp-world', portal: portal('p') as never });
    expect(ok.find((o) => o.message.type === 'portal_spawned')?.to ?? []).toEqual([]);
    expect(rm.getDynamicPortals('jp-world')).toHaveLength(1);
  });

  it('only the creator can remove a portal while they are online', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    rm.handleMessage('c2', hello('jp', 'JP', 'hub'));
    rm.handleMessage('c1', { type: 'spawn_portal', worldId: 'hub', portal: portal('p1') as never });

    const denied = rm.handleMessage('c2', { type: 'remove_portal', worldId: 'hub', portalId: 'p1' });
    expect(denied[0].message).toMatchObject({ type: 'error', code: 'forbidden' });

    const hijack = rm.handleMessage('c2', { type: 'spawn_portal', worldId: 'hub', portal: portal('p1') as never });
    expect(hijack[0].message).toMatchObject({ type: 'error', code: 'portal_exists' });

    const removed = rm.handleMessage('c1', { type: 'remove_portal', worldId: 'hub', portalId: 'p1' });
    expect(removed[0]).toEqual({ to: expect.arrayContaining(['c1', 'c2']), message: { type: 'portal_removed', worldId: 'hub', portalId: 'p1' } });
    expect(rm.getDynamicPortals('hub')).toEqual([]);

    const missing = rm.handleMessage('c1', { type: 'remove_portal', worldId: 'hub', portalId: 'p1' });
    expect(missing[0].message).toMatchObject({ type: 'error', code: 'portal_not_found' });
  });

  it('lets others clean up portals once the creator has left', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    rm.handleMessage('c2', hello('jp', 'JP', 'hub'));
    rm.handleMessage('c1', { type: 'spawn_portal', worldId: 'hub', portal: portal('p1') as never });
    rm.disconnect('c1');
    const out = rm.handleMessage('c2', { type: 'remove_portal', worldId: 'hub', portalId: 'p1' });
    expect(out[0].message.type).toBe('portal_removed');
  });

  it('returns defensive copies from queries', () => {
    const rm = makeManager();
    rm.handleMessage('c1', hello('eric', 'Eric', 'hub'));
    rm.getRoster()[0].position[0] = 999;
    expect(rm.getRoster()[0].position[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HTTP + WebSocket integration
// ---------------------------------------------------------------------------

class TestSocket {
  readonly ws: WebSocket;
  readonly messages: ServerNetMessage[] = [];
  private waiters: Array<{ pred: (m: ServerNetMessage) => boolean; resolve: (m: ServerNetMessage) => void }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerNetMessage;
      this.messages.push(msg);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(msg)) return true;
        w.resolve(msg);
        return false;
      });
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }

  next<T extends ServerNetMessage['type']>(
    type: T,
    pred: (m: Extract<ServerNetMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerNetMessage, { type: T }>> {
    const match = (m: ServerNetMessage) => m.type === type && pred(m as Extract<ServerNetMessage, { type: T }>);
    const existing = this.messages.find(match);
    if (existing) {
      this.messages.splice(this.messages.indexOf(existing), 1);
      return Promise.resolve(existing as Extract<ServerNetMessage, { type: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), 3000);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          this.messages.splice(this.messages.indexOf(m), 1);
          resolve(m as Extract<ServerNetMessage, { type: T }>);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

describe('HTTP + WebSocket server (ephemeral port)', () => {
  let app: PortalverseServer | undefined;
  const sockets: TestSocket[] = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.close();
    await app?.stop();
    app = undefined;
  });

  async function boot() {
    app = createPortalverseServer({ port: 0, host: '127.0.0.1', quiet: true });
    const { port } = await app.start();
    return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
  }

  async function join(wsUrl: string, id: string, name: string, worldId: string) {
    const s = new TestSocket(wsUrl);
    sockets.push(s);
    await s.open();
    s.send(hello(id, name, worldId));
    const welcome = await s.next('welcome');
    return { s, welcome };
  }

  it('serves health and worlds JSON with CORS', async () => {
    const urls = await boot();
    const health = await fetch(`${urls.http}/api/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get('access-control-allow-origin')).toBe('*');
    const body = await health.json();
    expect(body).toMatchObject({ ok: true, totalPlayers: 0 });
    expect(typeof body.uptimeMs).toBe('number');
    expect(body.worlds.map((w: { worldId: string }) => w.worldId)).toEqual(
      expect.arrayContaining(['hub', 'eric-world', 'jp-world']),
    );

    const worlds = await (await fetch(`${urls.http}/api/worlds`)).json();
    expect(Array.isArray(worlds.worlds)).toBe(true);

    const preflight = await fetch(`${urls.http}/api/worlds`, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('GET');

    expect((await fetch(`${urls.http}/nope`)).status).toBe(404);
  });

  it('syncs Eric and JP across rooms over real sockets', async () => {
    const urls = await boot();
    const eric = await join(urls.ws, 'eric', 'Eric', 'hub');
    expect(eric.welcome.playerId).toBe('eric');

    const jp = await join(urls.ws, 'jp', 'JP', 'hub');
    expect(jp.welcome.players.map((p) => p.id)).toEqual(['eric']);
    await eric.s.next('player_joined', (m) => m.player.id === 'jp');
    const joinEvent = await eric.s.next('roster_update', (m) => !!m.event?.includes('JP joined'));
    expect(joinEvent.event).toBe('JP joined the metaverse in Portal Hub');

    eric.s.send({ type: 'state', position: [3, 1, 4], yaw: 0.2, velocityY: 0 });
    const state = await jp.s.next('player_state');
    expect(state).toMatchObject({ playerId: 'eric', position: [3, 1, 4] });

    eric.s.send({ type: 'spawn_portal', worldId: 'hub', portal: portal('eric-to-jp') });
    const spawned = await jp.s.next('portal_spawned');
    expect(spawned.portal).toMatchObject({ id: 'eric-to-jp', createdBy: 'eric' });

    jp.s.send({ type: 'switch_world', worldId: 'jp-world', position: [0, 0, 10], yaw: 0 });
    const jpWelcome = await jp.s.next('welcome');
    expect(jpWelcome.worldId).toBe('jp-world');
    expect(await eric.s.next('player_left')).toMatchObject({ playerId: 'jp', worldId: 'hub' });
    const travel = await eric.s.next('roster_update', (m) => m.event === "JP entered JP's Room");
    expect(travel.roster.find((a) => a.id === 'jp')?.worldId).toBe('jp-world');

    const health = await (await fetch(`${urls.http}/api/health`)).json();
    expect(health.totalPlayers).toBe(2);
    expect(health.worlds.find((w: { worldId: string }) => w.worldId === 'hub')).toEqual({
      worldId: 'hub',
      playerCount: 1,
      dynamicPortalCount: 1,
    });

    jp.s.close();
    const left = await eric.s.next('roster_update', (m) => m.event === 'JP left the metaverse');
    expect(left.roster.map((a) => a.id)).toEqual(['eric']);
  });

  it('answers malformed frames with an error and keeps the socket open', async () => {
    const urls = await boot();
    const s = new TestSocket(urls.ws);
    sockets.push(s);
    await s.open();
    s.send('{not json');
    expect(await s.next('error')).toMatchObject({ code: 'bad_message' });
    s.send({ type: 'spawn_portal', worldId: 'hub', portal: portal('x', { remoteUrl: 'javascript:alert(1)' }) });
    expect(await s.next('error')).toMatchObject({ code: 'bad_message' });
    s.send({ type: 'ping', t: 5 });
    expect(await s.next('pong')).toEqual({ type: 'pong', t: 5 });
  });
});

describe('MultiplayerClient against the real server', () => {
  let app: PortalverseServer | undefined;
  const clients: MultiplayerClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) c.disconnect();
    await app?.stop();
    app = undefined;
  });

  function waitFor(check: () => boolean, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (check()) return resolve();
        if (Date.now() - started > 3000) return reject(new Error(`timed out: ${label}`));
        setTimeout(tick, 10);
      };
      tick();
    });
  }

  it('connects, sees peers, syncs state + portals, and follows world switches', async () => {
    app = createPortalverseServer({ port: 0, host: '127.0.0.1', quiet: true });
    const { port } = await app.start();
    const url = `ws://127.0.0.1:${port}/ws`;
    const createSocket = (u: string) => new WebSocket(u) as unknown as WebSocketLike;
    const rosterEvents: string[] = [];

    const eric = new MultiplayerClient({
      url,
      createSocket,
      identity: { id: 'eric', name: 'Eric', color: '#22d3ee' },
      initialWorldId: 'hub',
      onRosterChange: (_r, e) => e && rosterEvents.push(e),
    });
    const jp = new MultiplayerClient({
      url,
      createSocket,
      identity: { id: 'jp', name: 'JP', color: '#f59e0b' },
      initialWorldId: 'hub',
    });
    clients.push(eric, jp);

    // Portal spawned while still offline is kept locally, then published on connect.
    eric.spawnPortal('hub', { id: 'solo-portal', label: 'Solo', position: [0, 0, 0], targetWorldId: 'jp-world' });
    expect(eric.getDynamicPortals().map((p) => p.id)).toEqual(['solo-portal']);

    eric.connect();
    await waitFor(() => eric.getConnectionState() === 'connected', 'eric connected');
    jp.connect();
    await waitFor(() => jp.getConnectionState() === 'connected', 'jp connected');
    await waitFor(() => eric.getPlayersInWorld().some((p) => p.id === 'jp'), 'eric sees jp');
    await waitFor(() => jp.getDynamicPortals().some((p) => p.id === 'solo-portal'), 'offline portal published');
    expect(eric.getLocalPlayerId()).toBe('eric');

    jp.sendState([5, 1, -2], 1, 0);
    await waitFor(() => eric.getPlayersInWorld().find((p) => p.id === 'jp')?.position[0] === 5, 'state synced');

    eric.spawnPortal('hub', { id: 'live', label: 'Live', position: [1, 0, 1], targetWorldId: 'eric-world' });
    await waitFor(() => jp.getDynamicPortals().some((p) => p.id === 'live'), 'live portal synced');
    eric.removePortal('hub', 'live');
    await waitFor(() => !jp.getDynamicPortals().some((p) => p.id === 'live'), 'portal removed');

    jp.switchWorld('jp-world', [0, 0, 10], 0);
    await waitFor(() => eric.getPlayersInWorld().length === 0, 'jp left hub');
    await waitFor(() => rosterEvents.includes("JP entered JP's Room"), 'travel event');
    expect(jp.getDynamicPortals()).toEqual([]);
    expect(eric.getRoster().find((a) => a.id === 'jp')?.worldId).toBe('jp-world');
  });
});
