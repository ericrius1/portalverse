# Infrastructure Brainstorm: Creator-Hosted Rooms

> **Status: brainstorm, not an approved plan.** Sections marked **Existing** describe code on `main` at `5f3ec1a`. Everything marked **Proposed** is unbuilt. Numbers marked *provisional* are guesses to test, not budgets.

## 1. The goal

The aim is for anyone to add a room to Portalverse without a pull request. Concretely:

- A creator registers a URL for their room's module and assets. They host it, so central hosting and compute stay small.
- Rooms link as a graph, not just one loop: links to friends' rooms, a random webring, branching without limit.
- Portals stay seamless: live previews, prefetch, and crossings with no blank frame.
- Creators get full visual freedom and can write their own physics.
- A broken or hostile room fails alone. The host page always shows its own HTML **Exit**, **Vote** and **Report** controls.
- Every room has budgets for bytes, triangles, shader compile time and runtime cost.
- An optional local tool lets creators pack, check and sign a room before publishing.

These goals pull against each other. Seamless portals work today because one renderer draws every room on one GPU device and one thread. Full freedom and failure that stays in one room both push toward separate execution. Most of this document is about that tradeoff.

## 2. What exists today (Existing, `5f3ec1a`)

| Area | Current behaviour | Evidence |
|---|---|---|
| Rooms | 13 rooms, all bundled ES modules in this repo. Catalog order sets the loop. | [registry.json](registry.json), [AGENTS.md](AGENTS.md) |
| Loaded window | Two rooms each way on desktop. One each way on phone profiles. | [roomWindow.ts](packages/core/src/engine/roomWindow.ts#L5), [performanceProfile.ts](packages/core/src/engine/performanceProfile.ts#L30-L90) |
| Live portals | The nearest visible portals are drawn live: 4 on desktop, 1–2 on phones. The rest show snapshots. The portal at the far end of the next room is drawn live on desktop only. | [PortalPreviews.ts](packages/core/src/engine/PortalPreviews.ts#L1097-L1139) |
| Visible portals mount rooms | `render()` → `request()` → `destination()` mounts the room behind *any* visible local portal, including side portals players place. It is dropped after 4 s unseen. | [PortalPreviews.ts](packages/core/src/engine/PortalPreviews.ts#L560-L590), [L1202](packages/core/src/engine/PortalPreviews.ts#L1202) |
| Side portals | 5 slots per room. Players can spawn them through the server. | [roomLayout.ts](packages/core/src/portal/roomLayout.ts#L5), [protocol.ts](packages/server/src/protocol.ts#L56-L59) |
| Shared GPU device | The engine requests one device with every optional adapter feature and raised limits, then gives it to Three.js and to rooms as `ctx.gpu`. | [gpuDevice.ts](packages/core/src/engine/gpuDevice.ts#L25-L41), [WorldEngine.ts](packages/core/src/engine/WorldEngine.ts#L229-L238) |
| Room-drawn GPU layers | `ctx.addGpuLayer` calls a room's own WebGPU code for every view of that room and composites its colour **and depth** under the Three.js scene. | [gpuLayers.ts](packages/core/src/engine/gpuLayers.ts#L5-L16), [types.ts](packages/core/src/types.ts#L276-L328) |
| Custom gates | `customizeRouteGate` takes any aperture: full 3D orientation, custom radius, custom arrival spawn. The Palace's exit is a 34 m overhead dome. | [RoomInstance.ts](packages/core/src/engine/RoomInstance.ts#L98-L112), [types.ts](packages/core/src/types.ts#L204-L226) |
| Physics hooks | Rooms pass code, not data: terrain height functions (6 rooms), a collider (1 room), walk bounds and falling. The avatar controller calls them synchronously on every step. | [types.ts](packages/core/src/types.ts#L237-L256), [AvatarController.ts](packages/core/src/engine/AvatarController.ts#L381-L383) |
| Off-site assets | Music is served from content-addressed R2 objects. The Palace fetches a 5 MB mesh from another project's R2. Neither download is hash-checked after it arrives. | [Soundtrack.ts](packages/core/src/audio/Soundtrack.ts#L376), [layout.ts](worlds/eric-palace-lagoon/layout.ts#L25-L26), [palaceMesh.worker.ts](worlds/eric-palace-lagoon/palaceMesh.worker.ts#L39) |
| Budgets | `check:rooms` counts local bytes and image size. COLLAB notes that runtime downloads and GPU time need other controls. | [check-rooms.mjs](scripts/check-rooms.mjs#L62-L76), [COLLAB.md](COLLAB.md#room-budgets) |
| Failure handling | See below. | [RoomInstance.ts](packages/core/src/engine/RoomInstance.ts#L114-L138), [L161-L165](packages/core/src/engine/RoomInstance.ts#L161-L165), [WorldEngine.ts](packages/core/src/engine/WorldEngine.ts#L611-L671) |
| Remote portals | Portals with a `remoteUrl` are never drawn live. Crossing one hands off to the other site with a `returnUrl`. | [PortalPreviews.ts](packages/core/src/engine/PortalPreviews.ts#L1108), [types.ts](packages/core/src/types.ts#L86-L97) |
| Presence | Any roster change sends the full global roster to every session. | [roomManager.ts](packages/server/src/roomManager.ts#L412-L416) |

Failure handling today:

- If a room's mount fails, the room is disposed, and a preview retries after 5 s.
- Activation callbacks are guarded.
- Per-frame room updates are not guarded. The next frame is requested before they run, so an update that throws fails again every frame.
- Nothing in `packages/` or `app/` handles `GPUDevice` loss.
- A GPU layer's `render` is wrapped in `try/catch`. That catches JavaScript exceptions, not GPU faults.

**Palace Lagoon** ([worlds/eric-palace-lagoon](worlds/eric-palace-lagoon/index.ts)) is the stress case for every option below:

- It is drawn with weft, using raw WGSL.
- Its flock runs as compute shaders.
- Two workers build its mesh and its grove.
- It uses a projection rig in core ([rooms/projection](packages/core/src/rooms/projection/rig.ts)), a code-based collider and an overhead dome gate.
- Its time of day depends on each view's eye.
- Its mount waits up to 15 s for pipelines and the mesh ([index.ts](worlds/eric-palace-lagoon/index.ts#L86-L91)).

The cross-reviews looked at an older `main`. Some of their claims are now out of date: "12 rooms", "no room uses raw GPU or compute" and "collisions are terrain only".

### Two kinds of compositing

The engine composites in two different places, and they must be kept apart.

1. **Inside a room (GPU layer, new).** A layer renders each pass synchronously ("`render` must submit its GPU work before it returns", [types.ts](packages/core/src/types.ts#L322-L328)). It returns colour plus depth. The engine converts that depth to Three.js depth, and a backdrop mesh writes both ([gpuLayers.ts](packages/core/src/engine/gpuLayers.ts#L171-L249)). That is how players, portal rings and the crossing avatar end up behind or in front of the room's own geometry. It works only because everything shares one device and textures change hands without a copy.
2. **At a portal opening.** The opening samples only the **colour** of the destination's render target, in screen space ([PortalPreviews.ts](packages/core/src/engine/PortalPreviews.ts#L981-L985)). That target already contains the destination's own layer composite. The host never uses the destination's depth.

What this means for a room rendered on another device:

- **Previews.** An image made elsewhere could, in principle, feed composite (2).
- **The room the player is in.** The host still draws players, portal rings and the crossing avatar into it, which is composite (1). Either depth crosses the boundary as well, or the room draws those things itself. The synchronous layer contract would need an asynchronous replacement with frame identifiers and camera/state synchronization. Prediction is one possible latency mitigation, not a requirement or a guarantee.
- **Request volume.** The Palace's lighting depends on each view's eye, so every view needs its own render: the main view, up to four live windows, the far gate and snapshots.
- **Moving the Palace.** It can't move to another device as it is. It would need its own device and either colour-and-depth transport for host composition or responsibility for drawing the complete room view itself. Gate geometry and crossing metadata would need a protocol, and its collider would need to become data or run on its own side.

## 3. Browser facts the three reviews now agree on

These held up under cross-review against primary sources. Several reverse first-round claims.

1. **GPU access can't be switched off with CSP.**
   - WebGPU is exposed in windows and workers in secure contexts and has no Permissions-Policy switch ([WebGPU](https://www.w3.org/TR/webgpu/#navigator-gpu)).
   - `connect-src` governs network requests, not GPU access ([CSP3](https://www.w3.org/TR/CSP3/#directive-connect-src)).
   - Workers can also get WebGL contexts from `OffscreenCanvas`.
   - A sandboxed iframe loaded over HTTPS is treated as a secure context ([Secure Contexts](https://www.w3.org/TR/secure-contexts/)). The escape test should confirm this in each browser.
2. **Workers can start other workers, and messages can flood the host.**
   - Workers can create workers, and blob workers inherit their creator's CSP.
   - `postMessage` has no rate limit, and HTML calls out denial of service through messaging ([HTML messaging](https://html.spec.whatwg.org/multipage/web-messaging.html#security)).
3. **`Worker.terminate()` isolates CPU, nothing more.** It aborts script running on another thread ([HTML workers](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker)). It gives no deadline guarantee and no isolation of memory or GPU faults.
4. **Same-thread guards can't stop a loop.**
   - `try/catch` and timeouts on one thread never interrupt a loop on that thread.
   - A compile timeout stops the host waiting. It doesn't cancel GPU work already submitted.
   - Loading a module from another site is just code execution. It isn't a sandbox.
5. **Removing an iframe is not guaranteed recovery.**
   - The host's own thread has to be free to remove it.
   - Chromium puts cross-site and sandboxed frames in their own processes on desktop. On Android that depends on device memory and heuristics ([Chromium process model](https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md)).
   - Whether WebKit's site isolation has shipped is unconfirmed ([WebKit docs](https://docs.webkit.org/Deep%20Dive/SiteIsolation.html)).
6. **The specific sandbox-escape warning for `allow-scripts allow-same-origin` concerns a child sharing the parent's origin** ([HTML sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)).
   - A separate credential-free site can preserve origin separation. It still needs restricted permissions, validated messages and no access to host credentials; the flags alone do not establish general safety.
   - A subdomain of the host is the *same site*.
   - Domains on the [Public Suffix List](https://publicsuffix.org/), such as `vercel.app` and `github.io`, give each creator a separate site.
   - Rooms also need separate origins from *each other*.
7. **Opaque-origin workers can't start from an HTTPS URL.**
   - A worker's entry script is fetched in same-origin mode, so an HTTPS entry fails from an opaque origin ([HTML module fetch](https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-single-module-script)).
   - A blob URL created *inside* that origin, or a data: URL, is plausible ([File API](https://w3c.github.io/FileAPI/#originOfBlobURL)). It is untested per browser.
   - Imports then need CORS that accepts `Origin: null`.
8. **CORS and CORP do different jobs.**
   - Under `COEP: require-corp`, a successful CORS fetch needs no CORP header as well. Cross-origin no-cors resources need appropriate opt-in; embedded documents have additional COEP compatibility requirements ([HTML COEP](https://html.spec.whatwg.org/multipage/browsers.html#coep), [Fetch](https://fetch.spec.whatwg.org/)).
   - CORS is not a sandbox.
9. **WebGPU leaves resource limits to the browser.**
   - Memory limits and watchdogs are up to each implementation ([WebGPU DoS](https://www.w3.org/TR/webgpu/#security-denial-of-service)).
   - `timestamp-query` is optional and deliberately coarse.
   - Copying an external image into a texture is specified ([copyExternalImageToTexture](https://www.w3.org/TR/webgpu/#dom-gpuqueue-copyexternalimagetotexture)). Sharing textures across devices is not.
10. **Pointer lock in an iframe needs its own user gesture** ([Pointer Lock](https://w3c.github.io/pointerlock/)). A plausible fix is for the host to hold the lock and forward input to the room.

## 4. The design space (Proposed)

| Option | Who renders | Art freedom | Physics freedom | Seamless portals | Failure containment | Main unknown |
|---|---|---|---|---|---|---|
| **A. Trusted native** (today, hardened) | Host, shared device | Full, including raw WebGPU | Full, as synchronous code | Full | None against hostile code; fixes for accidental bugs only | Only scales by invitation |
| **B. Bounded host rendering** | Host, from a constrained package | Limited to what the format can express | Host movement plus colliders as data, or metered scripts | Full in principle | Depends on a real capability boundary | Can a boundary be built and audited, and does it keep enough art? |
| **C. Isolated self-rendering rooms** | Room, on its own device (worker or cross-site iframe) | Full | Full, but room-owned | Snapshots by default; live only if pose-to-image transport works | CPU loops if workers are used; partial for iframes; GPU faults unknown | Transport quality, depth, memory, mobile |
| **D. Independent worlds** | Creator's own page | Full | Full | No; full-page handoff with return | Separate origin and document; persistent host UI is lost, and GPU faults remain possible | Discovery and return flow only |

How each option works:

- **A** is what `main` is today.
  - Hardening helps against bugs: guard per-frame updates and physics callbacks, handle device loss, add mount deadlines.
  - It doesn't contain hostile code. A room on the shared device can request any adapter feature the engine enabled, and losing the device loses it for every room.
- **B** keeps the shared renderer, so it keeps far-gate recursion and crossings within the same frame.
  - "Bounded" has to mean creator code has **no path** to native GPU, WebGL, `OffscreenCanvas`, nested workers or raw messaging. An ordinary worker with CSP, or a friendly wrapper SDK, doesn't do that (section 3, facts 1–2).
  - Candidate designs:
    - a declarative-only package (scene, materials, colliders);
    - a metered interpreter;
    - validated Wasm with restricted imports and fuel limits.
  - Removing or freezing JavaScript globals inside a worker before creator code runs is an untested hardening idea, not a proven sandbox. Every candidate needs its own security review.
  - What B loses, compared with today: arbitrary JavaScript, raw WGSL and compute, custom passes, DOM use, and the Palace as built.
- **C** keeps full freedom. Crossing switches which running room is on screen, and the host page overlays Exit, Vote and Report. Live previews would come from sending camera poses and receiving images back. Its costs: no shared compiled pipelines, a second hop for the far gate, depth transport (or a room-side avatar kit) for host-drawn players, and weak containment on mobile.
- **D** is the fallback for anything else, and it partly exists through `remoteUrl` portals.

## 5. Where the reviews agree and disagree

**They agree on these points after cross-review** (beyond section 3):

- **Separate devices make seamless rendering harder, not impossible.** No review could defend a fixed "≥1–2 frame" latency floor. "3–5× VRAM" misread a whole-process total from the [five-room window measurements](CHANGELOG.md) (Chrome's GPU process, one headless Metal setup). Additional device, pipeline, asset and transport costs are unmeasured and depend on the implementation; neither a fixed overhead nor a multiplier follows from those measurements.
- **Porting.** Rooms using TSL shows demand for shader graphs. It doesn't show the existing rooms would run in a restricted format without a port.
- **Prefetch and verification.** Side portals already prefetch outside the ring, so trust checks must run before any preview. Client-side checks protect visitors; a server verifier is optional.

**They genuinely disagree on these:**

| Question | Positions | Why they differ | What would settle it |
|---|---|---|---|
| Public default | Codex: B, keeping D. Claude: C first, B only if its experiments pass. Antigravity: ship C with snapshots first, then decide. | Whether live recursive portals or creative freedom is "the product", and how much a constrained runtime costs to maintain. | Both prototypes in §8 |
| Confinement mechanism | Codex and Antigravity: a metered interpreter or fuel-limited Wasm. Claude: locked-down worker globals plus `terminate()`. | Trading a large trusted runtime against relying on an allow-list being complete. | An escape suite plus independent security review |
| How expressive B must be | Codex: declarative PBR materials. Antigravity: a bounded shader format. Claude: losing compute and WGSL is a major cost. | Art standards versus security surface. | Porting a demanding room (§8) |
| Physics | Everyone agrees standard movement is a real loss for custom physics. They differ on whether colliders-as-data are enough at first. | Gameplay ambition versus host-run physics. | The same port, with collision comparison |

**What the refresh adds** (from the current code, not from the reviews):

- Raw shared-device rendering is now a shipped, documented feature ([COLLAB.md](COLLAB.md#rooms-drawn-with-your-own-webgpu-code)).
- Option B now has to say what happens to rooms like the Palace.
- Option C now has to carry depth for any active room that uses GPU layers.

## 6. Distribution and trust (Proposed)

- **A manifest covering everything the room loads.** It lists every file the room will consume: entry module, lazy chunks, worker scripts, WGSL, models, textures, audio, and runtime fetches such as the Palace's mesh. Each entry has a length and a digest. The manifest also carries the protocol version, the apertures and arrival points, and a preview snapshot.
- **Integrity checked on use.**
  - The client hashes the bytes it actually uses before decoding or running them. An earlier check doesn't protect a later fetch.
  - A content-addressed *URL* is a name; on its own it doesn't guarantee what bytes arrive. Today's music and Palace fetches show the gap.
  - Loading a mutable creator site in an iframe gets no integrity from earlier validation. Label such rooms honestly as "live site, revision unverified".
- **Signatures and attestations.**
  - A creator's signature proves who published a digest. It doesn't prove any check ran honestly.
  - A trusted-builder attestation is stronger, if verifiers check the builder's identity, the artifact digest and the exact accepted workflow ([SLSA](https://slsa.dev/spec/v1.2/verifying-artifacts)). It is a badge, not a gate.
- **Checks.**
  - Clients enforce static limits on pinned bytes: size, image dimensions, model counts, the uncompressed-model rule, and validity of any restricted format.
  - A central directory may run the same checks for listing quality and abuse control. Fetching creator URLs from a server needs SSRF guards.
- **A thin directory** holding:
  - accounts and keys;
  - for each room id, its version, manifest URL, digest and provenance;
  - graph edges: friends' links and the webring;
  - votes and reports, authenticated through the host's own UI, never through anything a room supplies;
  - a revocation list;
  - presence scoped to each room, unlike today's global roster.
- **Prefetching is running code.**
  - Mounting a room for a preview runs it.
  - Mounting should depend on the room's trust level and on the player coming close.
  - Side portals to untrusted rooms show the manifest snapshot until then.
- **Privacy.** Fetching from a creator's host shows them visitors' IP addresses and timing, and prefetch makes that worse. Possible mitigations are disclosure, fetching only on approach, or an optional caching proxy, which costs central bandwidth.
- **Availability.** A creator's host can go down. Pinned digests make mirroring and caching safe, and the directory can mark rooms as stale.
- **Creator release workflow.** Use the optional `pack` → `check` → `sign` CLI, deploy static files with CORS, register the digest, and let the directory switch versions. Rolling back means re-pointing to an earlier digest.

## 7. Budgets: what can be counted

| Budget | Exact? | Enforcement |
|---|---|---|
| Downloaded bytes and decoded-resource sizes | Download bytes can be counted; decoded sizes need format-specific validation | Stream caps before buffering; declared-size checks and bounded decoding before GPU upload |
| Image size, triangles, draw calls | Yes, for declarative content; only after the fact for arbitrary code | Static check, or counting at runtime |
| Host-allocated GPU memory | Exact *logical* count of the host's own objects; not physical VRAM | Accounting |
| Shader complexity | A restricted vocabulary and expansion limits bound accepted programs, not portable execution time; overdraw × views × passes also matters | Format rules plus runtime measurement |
| Compile time | Measurable | A timeout stops the wait but doesn't cancel the work |
| GPU frame time | Coarse, optional | Demotion after an overrun |
| Worker CPU | Wall-clock lateness only | `terminate()` |

The limits should depend on the device profile, as the room window and the live-portal count already do. Don't publish production numbers until §8 has a baseline. "Zero central compute" isn't achievable; the realistic aim is small.

## 8. Recommendation (Proposed)

**Step 0: baseline the 13 current rooms** on each profile. Measure:

- bytes, including runtime fetches;
- triangles, draw calls and pipelines;
- compile time;
- GPU time per view, for the main view and portal views;
- extra memory per mounted room;
- mount duration and the longest main-thread task.

These figures replace every guessed budget.

**Prototype 1: isolated renderer.** Run two real rooms on separate devices (workers or cross-site iframes). Cover a full crossing and return, the crossing avatar and remote players, HDR colour against today's native rendering, a custom layer that needs depth, the far gate, fullscreen presentation, device loss in one room, pointer-lock handoff, and at least one phone.

Measure p95 image age while strafing at 14.5 m/s ([roomLayout.ts](packages/core/src/portal/roomLayout.ts#L3)), edge error after turn correction, colour difference, blank frames on crossing, extra memory per device, Exit latency while the room loops, and how far a device loss spreads.

*Provisional* bars from the reviews:

- p95 image age within one frame at 60 Hz;
- no blank crossing frame;
- Exit responds within 100 ms p95 on desktop.

**Prototype 2: a real capability boundary.** Port one demanding room behind a boundary with no native GPU, WebGL, `OffscreenCanvas`, nested workers or raw messaging. Either port the Palace or list exactly what can't come across (compute flock, raw WGSL, weft passes, projection rig, workers, collider code, dome aperture). Record what was lost, authoring effort, visual and collision match, the escape-suite results, and an independent security review.

**Then decide.**

- If Prototype 1 passes, C can carry open publishing with live previews.
- If Prototype 2 passes and keeps enough art, B is worth building as a public SDK.
- If neither passes, open rooms use C with snapshots, or D.
- Keep A for trusted rooms either way.

Don't commit to maintaining three products before the data exists.

**Independent of direction**, maintainers could also:

- guard per-frame room callbacks;
- handle `GPUDevice` loss;
- require trust before a visible portal mounts a room;
- hash-check runtime fetches.

## 9. Decisions to make

1. Which comes first for public rooms: seamless live portals or full freedom?
2. Is raw shared-device WebGPU (`ctx.gpu`, `addGpuLayer`) limited to trusted rooms?
3. Must every untrusted room use a pinned manifest that the client verifies?
4. Who can place side portals to unlisted rooms, and what do viewers see before they approach?
5. Which central services exist: directory, votes, revocation, presence, and optionally a cache?
6. Physics: host movement with colliders as data, or room-owned physics? Relaying a room's local pose is not authoritative physics.
7. Which tiers are offered on which platforms, given weaker isolation on mobile?

## 10. Overclaims we reject

Each of these appeared in at least one review and failed under cross-review or against current code:

- **Rendering:** separate devices can't match portal images; isolation costs at least 1–2 frames, or 3–5× VRAM.
- **Containment:** an opaque iframe with `connect-src 'none'` contains GPU use; remote imports or CORS are sandboxing; `try/catch` or timeouts stop loops; removing an iframe always recovers; workers isolate memory and GPU faults; deleting or freezing JavaScript globals is a proven hostile-code sandbox.
- **Origins:** an opaque origin is the only safe option; `allow-same-origin` is always unsafe; COEP needs CORP on every CORS asset.
- **Trust and budgets:** a signature proves validation ran; exact VRAM or shader-time caps; zero central compute; prefetch is harmless.
- **Freedom:** a restricted TSL format runs today's rooms without a port; standard movement equals custom physics.
- **Out of date at `5f3ec1a`:** 12 rooms; no raw GPU or compute in rooms; terrain-only collision.

## 11. Open questions

- Do blob workers start inside sandboxed iframes, browser by browser?
- Does `ImageBitmap` keep HDR precision, and can depth be carried cheaply?
- What is the status of WebKit and Firefox-on-Android site isolation?
- How much memory does each extra device cost?
- If one device hangs the GPU, does that reach other devices in the same GPU process?
- Do creators want a constrained format at all?
- What would it cost to maintain one alongside Three.js and weft releases?

## Provenance

This brainstorm combines independent assessments from Claude, Codex and Antigravity, plus each one's critique of the others, all run at explicit extra-high effort. Those reviews examined an earlier `main` (`448d0ad`). On 2026-11-26 the document was checked again against `main` at `5f3ec1a`, nine commits later, by re-reading the current code. The reviews themselves were not re-run. Uncommitted spawn and portal-anchor changes the reviews saw are not on `main` and are not described here. On `main`, custom gates set `arrivalSpawn`, and portal framing uses each aperture's own placement.
