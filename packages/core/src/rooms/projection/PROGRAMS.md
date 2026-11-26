# Solarpunk Projection-Mapping Programs

Visual library in [programs.wgsl](./programs.wgsl) (`PROGRAM_COUNT = 8u`). Every program emits **linear HDR light** (`rgb >= 0`, `0 = dark`, `~1 = full beam`, crisp highlights capped at `~2.5–2.6`) designed for additive architectural projection onto stone, columns, and coffered domes at **10–40 m** viewing distance.

## Visual Grammar & Technical Contracts

- **Shared Linear Palette**: Warm ivory-sunlight, honey gold, deep amber, backlit chlorophyll leaf green, sage, sea-glass teal, and restrained coral-apricot accents. No rainbow hue-cycling, kaleidoscopes, tunnels, or neon grids.
- **Dark-First Coverage**: Each program leaves roughly **60–82% of the frame dark** so additive projection sculpts architectural reliefs and casts crisp column shadows rather than flattening the stone.
- **Precision-Safe Continuous Motion**: Every time-varying phase wraps via `pj_phase(t, period, offset)` or tiled cell wrapping (`pj_wrapCell`), keeping motion completely smooth even after hours of uptime (`t > 86,400 s`).
- **Multi-Drone Variation**: `seed` (`0..1`) shifts orientation, phase, botanical spacing, and drift so two drones running the same program never look cloned.
- **Aspect Independence**: All coordinates normalize via `(uv - 0.5) * vec2f(aspect, 1.0)` so rosettes, leaves, and droplets stay undistorted from `1.0` to `1.78` aspect.

---

## Program Catalog

| # | Name | Display Title | Primary Palette | Motion & Breath | Coverage / Peak | Relative Cost | Best Surfaces |
|---:|---|---|---|---|---|---|---|
| 0 | `lagoon_caustics` | Lagoon Caustics | Sea-glass teal, honey gold, warm ivory cusps | 36 s refraction drift, 14 s breath | ~14–20% / ~2.1 | Very low (4 trig iters + 1 noise) | Dome, colonnade, lagoon-facing facades |
| 1 | `komorebi` | Komorebi Canopy | Warm ivory/gold sunbeams, backlit leaf green | 22–36 s wind gusts, 15 s breath | ~32–38% / ~2.4 | Medium (two 3×3 leaf-sprig passes) | Colonnade walls, broad stone faces, piers |
| 2 | `art_nouveau_vines` | Maybeck Vines | Honey gold filigree, sage leaves, coral-ivory buds | 28 s ascending sap & bloom, 18 s sway | ~15–20% / ~2.0 | Very low (analytic curves, 2-node loop) | Vertical piers, arch intrados, columns |
| 3 | `stained_venation` | Dragonfly Venation | Gold leading, teal/sage/amber glass panes | 30 s sunset sweep, 48 s organic drift | ~30–36% / ~2.4 | Low (one 3×3 Voronoi + 3 noise) | Dome coffers, broad arches, rotunda drum |
| 4 | `sunflower_phyllotaxis` | Golden Phyllotaxis | Coral-gold core, honey florets, sea-glass calyx | 64 s rotation, 16 s radial pollen pulse | ~22–30% / ~2.2 | Very low (pure O(1) polar math) | **Inner coffered dome (from below)**, medallions |
| 5 | `unfurling_ferns` | Silver Fern Fronds | Sunlit leaf green & sage, gilded rachis & croziers | 38 s unfurl breath, 17–26 s breeze sway | ~26–34% / ~1.5 | Very low (4 analytic frond SDFs) | Piers, lower arches, colonnade bays |
| 6 | `mycelial_pulse` | Mycelial Network | Sea-glass teal & amber hyphae, ivory-gold pulses | 16 s nutrient surges, 56 s colony drift | ~18–22% / ~2.5 | Low (one 3×3 Voronoi + 4 noise) | Stone bases, soffits, piers, dome ribs |
| 7 | `pollen_drift` | Evening Pollen & Seeds | Sunlit ivory dandelion tufts, gold & teal bokeh | 36 s breeze ribbons, 118–250 s buoyant drift | ~20–23% / ~1.6 | Medium (two tuft + two mote 3×3 grids) | Quiet interludes, colonnade, wide domes |

---

## Program Notes & Drone Guidance

### `0` · `lagoon_caustics` — Lagoon Caustics
Iterative curled-phase water refraction webs with subtle physical gold/sea-glass dispersion and calm dark water pockets.
- **How `seed` varies drones**: Rotates the caustic lattice, shifts swell phase, and moves the slow dark-pool envelope.
- **Low-intensity readability**: Excellent down to ~0.35× intensity — the bright ivory cusps keep reading like reflected lagoon water on stone.

### `1` · `komorebi` — Komorebi Canopy
Two parallax layers of swaying three-leaf sprigs carving dappled late-afternoon golden sun pools, rimmed with backlit chlorophyll green where light grazes leaf margins.
- **How `seed` varies drones**: Generates distinct canopy branch layouts and out-of-phase diagonal wind gusts.
- **Low-intensity readability**: Best at ~0.6–1.0× so the subtle emerald backlit rims stay distinct against warm ochre stone.

### `2` · `art_nouveau_vines` — Maybeck Vines
Architectural triad of gently arching Art Nouveau stems crowned by a floral arch, with connected whiplash spiral tendrils, veined leaves, coral-ivory buds, and continuously rising golden sap waves (never fades to all-black).
- **Orientation**: Designed right-side-up (`uv.y = 1` bottom to `uv.y = 0` top); aim projector upright onto vertical piers or arches.
- **Low-intensity readability**: High contrast filigree reads crisply even at ~0.4× intensity.

### `3` · `stained_venation` — Dragonfly Venation
Elongated Voronoi venation warped along a tapered curved botanical midrib. A slow sunset wave illuminates ~30% of the cells at a time in Tiffany-glass teal, sage, amber, and soft coral while the golden leading stays crisp.
- **How `seed` varies drones**: Tilts the midrib axis and shifts the travelling sunset illumination wave.
- **Low-intensity readability**: Strong — golden veins hold structure at low intensity while lit glass cells emerge gracefully as intensity rises.

### `4` · `sunflower_phyllotaxis` — Golden Phyllotaxis
Seamless `(13, 21)` dual-parastichy Fibonacci rosette with five nested rings of golden florets, warm stamen heart, counter-travelling pollen waves, and a sculpted 13-petal sea-glass calyx crown. Naturally circular with clean dark margin.
- **Hero placement**: Aim straight up into the **inner coffered dome** (`aspect ≈ 1.0`) so the rosette crowns the oculus like a living botanical skylight.
- **Low-intensity readability**: Very strong at ~0.4–1.0×; looks sublime even as a faint golden mandala at dusk.

### `5` · `unfurling_ferns` — Silver Fern Fronds
Four gracefully spaced sword-fern fronds arching upward with gently curved pinnae, gilded rachis veins, seamlessly curled fiddlehead croziers, and drifting golden spores in the dark air above.
- **Orientation**: Anchored along the bottom edge (`uv.y = 1`); ideal for projecting upward from low-hovering drones onto piers, arch bases, and colonnade bays.
- **Low-intensity readability**: Moderate-high; the gilded veins and fiddlehead spirals lead the eye cleanly.

### `6` · `mycelial_pulse` — Mycelial Network
Organic domain-warped hyphal network modulated by a slowly migrating colony mask, carrying warm golden-ivory nutrient surges that bloom at branching triple junctions in sea-glass teal.
- **How `seed` varies drones**: Shifts active colony patches and radial pulse timing so multiple drones feel like one shared living root system.
- **Low-intensity readability**: Excellent at ~0.35–0.85×; bright junction pulses stay legible without overpowering stone texture.

### `7` · `pollen_drift` — Evening Pollen & Seeds
Backlit dandelion-seed tufts bobbing and tilting along gossamer gold-and-teal air currents, surrounded by multi-depth golden pollen and sea-glass evening motes.
- **Role**: The calmest, airiest program — ideal as a breather act, on wide colonnades, or layered subtly alongside a stronger geometric piece.
- **Low-intensity readability**: Good at ~0.5–1.0×; avoid running below ~0.35× or the delicate pappus filaments become too faint on warm-lit stone.

---

## Recommended Choreography (Palace of Fine Arts — Blue Hour)

### Spatial Assignment (6–12 Drones)
1. **Inner Coffered Dome (1–2 overhead-aimed drones, `aspect ≈ 1.0`, center of rotunda)**
   - Primary hero cycle: `4 (sunflower_phyllotaxis)` -> `0 (lagoon_caustics)` -> `3 (stained_venation)` -> `7 (pollen_drift)`.
   - If using **2 dome drones**, run `4 (sunflower_phyllotaxis)` centered at full scale and offset `7 (pollen_drift)` or `0 (lagoon_caustics)` gently across the upper drum at ~0.45× intensity.
2. **Rotunda Piers & Open Arches (3–5 drones, upright orientation, `aspect ≈ 1.0–1.35`)**
   - Alternate monumental botanical silhouettes: `2 (art_nouveau_vines)`, `5 (unfurling_ferns)`, `6 (mycelial_pulse)`, and `3 (stained_venation)`.
   - Keep adjacent piers on **complementary density** (e.g., filigree `2` next to airy `7` or `6`, never two dense foliage frames colliding on the same corner).
3. **Curving Peristyle Colonnades & Lagoon Facades (2–5 drones, wider `aspect ≈ 1.35–1.78`)**
   - Favor horizontal flow and environmental resonance: `0 (lagoon_caustics)` (echoing the real lagoon reflection right below!), `1 (komorebi)`, `7 (pollen_drift)`, and `6 (mycelial_pulse)`.

### Pacing & Crossfades
- **Dwell time**: **45–65 seconds** per program per drone (long enough to feel one full slow motion cycle and breath; avoid rapid cycling).
- **Stagger transitions**: Switch 1–2 drones at a time every ~12–18 seconds rather than switching the whole fleet simultaneously, so the rotunda evolves like living twilight.
- **Crossfade curve**: **5–7 second smoothstep additive blend** (`mix(a, b, smoothstep(0, 1, u))`). Because all 8 programs share dark backgrounds and the same warm gold / teal / sage color space, additive crossfades stay clean and luminous without muddy mid-frames.

### Curated Crossfade & Simultaneous Pairings
- **Water to Glass (`0 lagoon_caustics` ↔ `3 stained_venation`)**: Shared sea-glass teal and honey-gold web geometry dissolves seamlessly from liquid ripples into leaded dragonfly wings.
- **Canopy to Meadow (`1 komorebi` ↔ `5 unfurling_ferns` ↔ `7 pollen_drift`)**: Natural progression from overhead sunbeams to arching fronds to floating evening dandelion seeds.
- **Architecture to Roots (`2 art_nouveau_vines` ↔ `6 mycelial_pulse`)**: Ascending golden Art Nouveau lines melt organically into living underground root pulses.
- **Dome Crown Pairs (`4 sunflower_phyllotaxis` + `7 pollen_drift` or `0 lagoon_caustics`)**: Structured botanical medallion in the dome oculus paired with drifting seeds or caustics on the surrounding colonnade.
- **Avoid**: Running `1 (komorebi)` and `3 (stained_venation)` overlapped on the exact same stone surface at full intensity (their combined coverage can exceed 60% and flatten the stone relief).
