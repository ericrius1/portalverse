// Portalverse's big media (the soundtrack's stems and portal sounds): the R2 bucket portalverse-assets behind
// Cloudflare's edge cache, modelled on ericlevin.dev's asset Worker. Every file is content-addressed
// (objects/<sha256>/<name>: scripts/publish-music.mjs) and never changes under its name, so it's read from R2 once
// per edge and served from the cache after that. Ranges come from the cached copy too. A .glb/.json/.bin with a
// brotli'd twin (<key>.br) is passed through as-is to askers that take br.
//   npx wrangler deploy  (in deploy/assets)
const LASTING = /^\/objects\/[0-9a-f]{16,64}\/[A-Za-z0-9_.~-]+$/;
const BR = /\.(glb|json|bin)$/;
/** the edge cache's namespace (a new one leaves every cached copy behind) */
const CACHE = 'c1';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'Range, If-Range, If-None-Match, If-Modified-Since',
  'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Encoding, ETag, X-Portalverse-Cache',
  'access-control-max-age': '86400',
  'cross-origin-resource-policy': 'cross-origin',
  'timing-allow-origin': '*',
};

const headersOf = (obj, cache) => {
  const h = new Headers(CORS);
  obj.writeHttpMetadata(h);
  h.set('cache-control', 'public, max-age=31536000, immutable');
  h.set('etag', obj.httpEtag);
  h.set('vary', 'accept-encoding');
  h.set('accept-ranges', 'bytes');
  h.set('x-content-type-options', 'nosniff');
  h.set('x-portalverse-cache', cache);
  return h;
};

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed\n', { status: 405, headers: CORS });
    const url = new URL(req.url);
    if (!LASTING.test(url.pathname)) return new Response('not found\n', { status: 404, headers: CORS });
    const key = url.pathname.slice(1);
    // (what the asker sent: Cloudflare rewrites accept-encoding before the Worker sees it)
    const accepts = req.cf?.clientAcceptEncoding ?? req.headers.get('accept-encoding') ?? '';
    const takesBr = !req.headers.has('range') && BR.test(key) && /\bbr\b/.test(accepts);
    return (takesBr && (await twin(req, env, ctx, url, key))) || plain(req, env, ctx, url, key);
  },
};

/** the brotli'd twin, passed through as it's stored (null when the bucket hasn't one). It's cached as plain bytes
 *  (the cache would decode a br body for an asker that didn't say br), its encoding put on as it goes out. */
async function twin(req, env, ctx, url, key) {
  const cacheKey = new Request(`${url.origin}/${CACHE}/${key}.br`);
  const out = (body, h, cache) => {
    const o = new Headers(h);
    o.set('content-encoding', 'br');
    o.set('x-portalverse-cache', `${cache} br`);
    return new Response(req.method === 'HEAD' ? null : body, { headers: o, encodeBody: 'manual' });
  };
  const hit = await caches.default.match(cacheKey);
  if (hit) return out(hit.body, hit.headers, 'hit');
  const obj = await env.BUCKET.get(`${key}.br`);
  if (!obj) return null;
  const h = headersOf(obj, 'miss');
  h.set('content-length', String(obj.size));
  if (req.method === 'HEAD') { obj.body.cancel(); return out(null, h, 'miss'); }
  const [give, keep] = obj.body.tee();
  ctx.waitUntil(caches.default.put(cacheKey, new Response(keep, { headers: h })));
  return out(give, h, 'miss');
}

/** the file itself */
async function plain(req, env, ctx, url, key) {
  // (the cache's key: the file alone, whatever the query or the request's headers)
  const cacheKey = new Request(`${url.origin}/${CACHE}/${key}`);
  const cache = caches.default;
  // (a range, a HEAD or a revalidation answered from the cached whole file: match() does the 206 and the 304)
  const hit = await cache.match(new Request(cacheKey.url, { headers: req.headers }));
  if (hit) {
    const h = new Headers(hit.headers);
    h.set('x-portalverse-cache', 'hit');
    return new Response(req.method === 'HEAD' ? null : hit.body, { status: hit.status, headers: h });
  }
  const obj = await env.BUCKET.get(key);
  if (!obj) return new Response('not found\n', { status: 404, headers: CORS });
  if (req.method === 'HEAD') { obj.body.cancel(); const h = headersOf(obj, 'miss'); h.set('content-length', String(obj.size)); return new Response(null, { headers: h }); }
  // the whole file into the cache, and to the asker (a range from the bucket: the cache has it whole next time)
  const [give, keep] = obj.body.tee();
  const whole = new Response(keep, { headers: headersOf(obj, 'miss') });
  whole.headers.set('content-length', String(obj.size));
  ctx.waitUntil(cache.put(cacheKey, whole));
  if (req.headers.has('range')) {
    give.cancel();
    const part = await env.BUCKET.get(key, { range: req.headers });
    if (!part) return new Response('not found\n', { status: 404, headers: CORS });
    const h = headersOf(part, 'miss');
    const r = part.range ?? { offset: 0, length: part.size };
    const end = (r.offset ?? 0) + (r.length ?? part.size) - 1;
    h.set('content-range', `bytes ${r.offset ?? 0}-${end}/${part.size}`);
    h.set('content-length', String(end - (r.offset ?? 0) + 1));
    return new Response(part.body, { status: 206, headers: h });
  }
  return new Response(give, { headers: headersOf(obj, 'miss') });
}
