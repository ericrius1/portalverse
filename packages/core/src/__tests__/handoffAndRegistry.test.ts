import { describe, expect, it, vi } from 'vitest';
import type { PortalHandoffPayload, RegistryFile, WorldManifest, WorldModule } from '../types';
import {
  buildRemotePortalUrl,
  buildShareableWorldUrl,
  createReturnPortalFromHandoff,
  decodePortalHandoff,
  encodePortalHandoff,
  readRouteFromLocation,
  sanitizeText,
} from '../portal/handoff';
import { WorldRegistry } from '../portal/registry';
import { MultiplayerClient } from '../net/multiplayerClient';
import registryJson from '../../../../registry.json';

const payload: PortalHandoffPayload = {
  version: 1,
  playerName: 'Éric 🚀 ✨ 日本',
  playerColor: '#22d3ee',
  fromWorldId: 'eric-world',
  fromWorldName: "Eric's Room — Ünïcødé",
  returnUrl: 'https://eric.example.com/?world=eric-world',
  targetWorldId: 'jp-world',
  targetSpawnId: 'from-eric',
  sentAt: 1_700_000_000_000,
};

function toBase64Url(json: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('portal handoff encode/decode', () => {
  it('round-trips unicode payloads through URL-safe base64url', () => {
    const encoded = encodePortalHandoff(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodePortalHandoff(encoded)).toEqual(payload);
  });

  it('rejects garbage, wrong versions and missing origin worlds', () => {
    expect(decodePortalHandoff('')).toBeNull();
    expect(decodePortalHandoff('!!!not-base64!!!')).toBeNull();
    expect(decodePortalHandoff(toBase64Url('not json'))).toBeNull();
    expect(decodePortalHandoff(toBase64Url(JSON.stringify({ ...payload, version: 2 })))).toBeNull();
    expect(decodePortalHandoff(toBase64Url(JSON.stringify({ ...payload, fromWorldId: '<script>' })))).toBeNull();
    expect(decodePortalHandoff('A'.repeat(10_000))).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'https://u:p@evil.com/'])(
    'rejects handoffs whose returnUrl is %s',
    (returnUrl) => {
      expect(decodePortalHandoff(toBase64Url(JSON.stringify({ ...payload, returnUrl })))).toBeNull();
    },
  );

  it('sanitizes strings/colors and drops unknown fields such as the retired hub style', () => {
    const decoded = decodePortalHandoff(
      toBase64Url(
        JSON.stringify({
          ...payload,
          playerName: '<img src=x onerror=alert(1)>',
          playerColor: 'javascript:alert(1)',
          targetHubStyle: 'meadow',
          sentAt: 'yesterday',
        }),
      ),
    );
    expect(decoded).not.toBeNull();
    expect(decoded!.playerName).not.toMatch(/[<>]/);
    expect(decoded!.playerColor).toBe('#38bdf8');
    expect(decoded).not.toHaveProperty('targetHubStyle');
    expect(decoded!.sentAt).toBe(0);
  });

  it('sanitizeText strips control/bidi chars and truncates by code point', () => {
    expect(sanitizeText('a\u0000b\u202ec', 10)).toBe('a b c');
    expect(sanitizeText('🚀'.repeat(50), 3)).toBe('🚀🚀🚀');
    expect(sanitizeText('   ', 10)).toBeNull();
  });
});

describe('remote + shareable URLs', () => {
  it('builds remote portal URLs with a handoff param, preserving other params', () => {
    const url = buildRemotePortalUrl('https://jp.example.com/play?world=jp-world#handoff=stale', payload);
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get('world')).toBe('jp-world');
    expect(decodePortalHandoff(parsed.searchParams.get('handoff')!)).toEqual(payload);
    expect(parsed.hash).toBe('');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ws://example.com', '/relative', ''])(
    'refuses remote portal URL %s',
    (remote) => {
      expect(buildRemotePortalUrl(remote, payload)).toBeNull();
    },
  );

  it("builds clean shareable links for Eric's and JP's rooms", () => {
    expect(buildShareableWorldUrl('https://portalverse.dev/', { worldId: 'eric-world' })).toBe(
      'https://portalverse.dev/?world=eric-world',
    );
    expect(buildShareableWorldUrl('https://portalverse.dev/?handoff=old&world=fishpond#x', { worldId: 'jp-world' })).toBe(
      'https://portalverse.dev/?world=jp-world',
    );
    expect(
      buildShareableWorldUrl('https://portalverse.dev/?debug=1', { worldId: 'fishpond', spawnId: 'exit' }),
    ).toBe('https://portalverse.dev/?debug=1&world=fishpond&spawn=exit');
    expect(buildShareableWorldUrl('/', { worldId: 'jp-world' })).toBe('/?world=jp-world');
  });

  it('parses routes back out of a location, including hash handoffs', () => {
    expect(readRouteFromLocation('?world=jp-world')).toEqual({ worldId: 'jp-world' });
    expect(readRouteFromLocation('?world=fishpond&spawn=from-eric')).toEqual({
      worldId: 'fishpond',
      spawnId: 'from-eric',
    });
    // Old hub links still open the named room; the retired style param is ignored.
    expect(readRouteFromLocation('?world=jp-world&hubStyle=meadow')).toEqual({ worldId: 'jp-world' });
    expect(readRouteFromLocation('?world=%3Cscript%3E')).toEqual({});
    expect(readRouteFromLocation('', '')).toEqual({});

    const encoded = encodePortalHandoff(payload);
    expect(readRouteFromLocation(`?handoff=${encoded}`).handoff).toEqual(payload);
    expect(readRouteFromLocation('?world=jp-world', `#handoff=${encoded}`).handoff).toEqual(payload);
    expect(readRouteFromLocation('?handoff=garbage').handoff).toBeUndefined();
  });

  it('round-trips a shareable URL through readRouteFromLocation', () => {
    const url = new URL(buildShareableWorldUrl('https://x.dev/', { worldId: 'laser-lab', spawnId: 'entrance' }));
    expect(readRouteFromLocation(url.search, url.hash)).toEqual({ worldId: 'laser-lab', spawnId: 'entrance' });
  });
});

describe('createReturnPortalFromHandoff', () => {
  it('creates a glowing return portal back to the origin', () => {
    const p = createReturnPortalFromHandoff(payload, [2, 0, -4]);
    expect(p).toMatchObject({
      id: 'return-eric-world',
      targetWorldId: 'eric-world',
      remoteUrl: 'https://eric.example.com/?world=eric-world',
      position: [2, 0, -4],
      colorA: '#22d3ee',
    });
    expect(p!.label.length).toBeLessThanOrEqual(40);
    expect(p!.label.startsWith('Return to')).toBe(true);
    expect(p!.colorB).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns null without a safe return URL', () => {
    const { returnUrl: _omit, ...noReturn } = payload;
    expect(createReturnPortalFromHandoff(noReturn)).toBeNull();
    expect(createReturnPortalFromHandoff({ ...payload, returnUrl: 'javascript:alert(1)' })).toBeNull();
  });

  it('falls back to a default position when given non-finite coordinates', () => {
    const p = createReturnPortalFromHandoff(payload, [NaN, 0, 0]);
    expect(p!.position.every(Number.isFinite)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// WorldRegistry
// ---------------------------------------------------------------------------

function manifest(id: string, extra: Partial<WorldManifest> = {}): WorldManifest {
  return {
    id,
    name: id,
    author: 'test',
    description: 'test world',
    accentColor: '#ffffff',
    kind: 'local',
    spawns: { default: { position: [0, 0, 0], yaw: 0 } },
    ...extra,
  };
}

function worldModule(id: string): WorldModule {
  return { manifest: manifest(id), mount: () => {} };
}

const registryFile: RegistryFile = {
  version: 1,
  defaultWorldId: 'hub',
  worlds: [manifest('hub'), manifest('eric-world', { name: "Eric's Room" }), manifest('jp-world', { name: "JP's Room" })],
};

describe('WorldRegistry', () => {
  it('exposes defaults and manifests from the registry file', () => {
    const reg = new WorldRegistry(registryFile, {});
    expect(reg.getDefaultWorldId()).toBe('hub');
    expect(reg.listWorlds().map((w) => w.id)).toEqual(['hub', 'eric-world', 'jp-world']);
    expect(reg.getManifest('jp-world')?.name).toBe("JP's Room");
    expect(reg.getManifest('nope')).toBeUndefined();
  });

  it('accepts the real repo registry.json', () => {
    const reg = new WorldRegistry(registryJson as unknown as RegistryFile, {});
    expect(reg.getDefaultWorldId()).toBe('eric-world');
    expect(reg.listWorlds().map((w) => w.id)).toEqual([
      'eric-world',
      'jp-world',
      'jp-garden',
      'fishpond',
      'jp-reef',
      'jp-loft',
      'laser-lab',
      'alpine-sled',
    ]);
    expect(reg.getManifest('eric-world')?.name).toBe("Eric's Room");
    expect(reg.getManifest('jp-world')?.name).toBe("JP's Solarpunk Meadow");
    expect(reg.getManifest('fishpond')?.name).toBe('Kāneʻohe Fishpond');
    expect(reg.getManifest('laser-lab')?.name).toBe('Laser Forcefield Arena');
    expect(reg.getManifest('alpine-sled')?.name).toBe('Alpine Snow Run');
  });

  it('caches loaded modules and dedupes concurrent loads', async () => {
    const loader = vi.fn(async () => ({ default: worldModule('eric-world') }));
    const reg = new WorldRegistry(registryFile, { 'eric-world': loader });
    const [a, b] = await Promise.all([reg.loadWorld('eric-world'), reg.loadWorld('eric-world')]);
    const c = await reg.loadWorld('eric-world');
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('accepts loaders returning the module directly (no default export)', async () => {
    const reg = new WorldRegistry(registryFile, { 'jp-world': async () => worldModule('jp-world') });
    expect((await reg.loadWorld('jp-world')).manifest.id).toBe('jp-world');
  });

  it('validates the loaded manifest id and does not cache failures', async () => {
    let calls = 0;
    const reg = new WorldRegistry(registryFile, {
      'jp-world': async () => (++calls === 1 ? worldModule('eric-world') : worldModule('jp-world')),
    });
    await expect(reg.loadWorld('jp-world')).rejects.toThrow(/manifest id/);
    await expect(reg.loadWorld('jp-world')).resolves.toMatchObject({ manifest: { id: 'jp-world' } });
  });

  it('rejects unknown worlds and non-module loader results', async () => {
    const reg = new WorldRegistry(registryFile, { hub: async () => ({ default: {} as WorldModule }) });
    await expect(reg.loadWorld('missing')).rejects.toThrow(/Unknown world/);
    await expect(reg.loadWorld('hub')).rejects.toThrow(/WorldModule/);
  });

  it('registers remote worlds but refuses to shadow local ones or accept unsafe URLs', async () => {
    const reg = new WorldRegistry(registryFile, { 'eric-world': async () => worldModule('eric-world') });
    reg.registerRemoteWorld(manifest('jp-garden', { remoteUrl: 'https://jp.example.com/?world=garden' }));
    expect(reg.getManifest('jp-garden')).toMatchObject({ kind: 'remote', remoteUrl: 'https://jp.example.com/?world=garden' });
    expect(reg.listWorlds().map((w) => w.id)).toContain('jp-garden');
    await expect(reg.loadWorld('jp-garden')).rejects.toThrow(/remote/);

    expect(() => reg.registerRemoteWorld(manifest('eric-world', { remoteUrl: 'https://x.dev' }))).toThrow(/local/);
    expect(() => reg.registerRemoteWorld(manifest('bad', { remoteUrl: 'javascript:alert(1)' }))).toThrow(/http/);
    expect(() => reg.registerRemoteWorld(manifest('<x>', { remoteUrl: 'https://x.dev' }))).toThrow(/id/);

    // Re-registering a remote world replaces it.
    reg.registerRemoteWorld(manifest('jp-garden', { remoteUrl: 'https://jp2.example.com/' }));
    expect(reg.getManifest('jp-garden')?.remoteUrl).toBe('https://jp2.example.com/');
  });

  it('does not let callers mutate the registry file through it', () => {
    const file: RegistryFile = JSON.parse(JSON.stringify(registryFile));
    const reg = new WorldRegistry(file, {});
    file.worlds[0].name = 'mutated';
    expect(reg.getManifest('hub')?.name).toBe('hub');
  });
});

// ---------------------------------------------------------------------------
// MultiplayerClient offline behaviour (online paths are covered by the
// server integration suite)
// ---------------------------------------------------------------------------

describe('MultiplayerClient offline fallback', () => {
  it('stays usable solo when no server URL can be resolved', () => {
    const states: string[] = [];
    const errors: string[] = [];
    const portalsSeen: string[][] = [];
    const client = new MultiplayerClient({
      identity: { id: 'eric', name: 'Eric', color: '#22d3ee' },
      initialWorldId: 'hub',
      onConnectionChange: (s) => states.push(s),
      onError: (m) => errors.push(m),
      onDynamicPortalsChange: (p) => portalsSeen.push(p.map((x) => x.id)),
    });
    client.connect();
    expect(client.getConnectionState()).toBe('offline');
    expect(errors).toHaveLength(1);

    client.spawnPortal('hub', { id: 'p1', label: 'Solo', position: [0, 0, 0], targetWorldId: 'jp-world' });
    expect(client.getDynamicPortals().map((p) => p.id)).toEqual(['p1']);
    expect(client.getDynamicPortals()[0].createdBy).toBe('eric');

    client.switchWorld('jp-world', [0, 0, 10], 0);
    expect(client.getDynamicPortals()).toEqual([]);
    client.switchWorld('hub', [0, 0, 0], 0);
    expect(client.getDynamicPortals().map((p) => p.id)).toEqual(['p1']);

    client.removePortal('hub', 'p1');
    expect(client.getDynamicPortals()).toEqual([]);
    expect(portalsSeen.at(-1)).toEqual([]);

    client.updateProfile('Rick', '#ff00ff');
    expect(client.getRoster()).toEqual([expect.objectContaining({ id: 'eric', name: 'Rick', worldId: 'hub' })]);
    client.sendState([1, 2, 3], 0, 0); // no throw while offline
    client.disconnect();
    expect(client.getConnectionState()).toBe('offline');
  });

  it('retries with backoff when the socket fails to open', () => {
    vi.useFakeTimers();
    try {
      const created: string[] = [];
      const client = new MultiplayerClient({
        url: 'ws://127.0.0.1:1/ws',
        identity: { id: 'jp', name: 'JP', color: '#f59e0b' },
        initialWorldId: 'hub',
        reconnectBaseMs: 100,
        createSocket: (url) => {
          created.push(url);
          const sock = {
            readyState: 3,
            onopen: null,
            onclose: null as ((ev: unknown) => void) | null,
            onerror: null,
            onmessage: null,
            send: () => {},
            close: () => {},
          };
          queueMicrotask(() => sock.onclose?.({}));
          return sock;
        },
      });
      client.connect();
      expect(client.getConnectionState()).toBe('connecting');
      return Promise.resolve()
        .then(() => {
          expect(client.getConnectionState()).toBe('offline');
          vi.advanceTimersByTime(200);
          expect(created).toHaveLength(2);
          client.disconnect();
          vi.advanceTimersByTime(10_000);
          expect(created).toHaveLength(2);
        })
        .finally(() => vi.useRealTimers());
    } catch (err) {
      vi.useRealTimers();
      throw err;
    }
  });
});
