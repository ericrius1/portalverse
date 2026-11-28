# Relay

A dark hall with a mirror-black floor. Ranks of square rack cages stand off in the dark either side of a matte walkway. Each rack is 4 ft square and 10.8–18.8 ft tall, and holds a stack of 4 in platters with 12 in between them. The rim of every platter is a low-resolution display: 32 modules of 8 × 8 orange LEDs. An orange slashed zero runs round the bottom platter. One beat later the platter above lights a glyph width behind it, then the next, until the whole tower turns as a staircase. Then the bottom glyph grows a tail of fading echoes, and each platter above follows. Every tower starts at its own fixed pseudo-random time, so the field wakes and sleeps across the room.

| File | What's in it |
| --- | --- |
| `cues.ts` | The cue scheduler: schema, `compileProgram`, `samplePlatter`. Pure TypeScript, no three.js. |
| `programs.ts` | The named programs (`RELAY`, `TWIST`, `WEAVE`) and how often towers run each. |
| `glyphs.ts` | 8 × 8 glyph bitmaps and the atlas the shader reads. |
| `layout.ts` | Sizes from the brief, rack placement, collision and walkable lids. |
| `shaders.ts` | TSL materials: LED rims, mirror floor and walkway, cage glow, haze. |
| `index.ts` | The mount: geometry, instancing, the per-frame update. |
| `relay.test.ts` | Scheduler timing and wraparound, layout, and a mount smoke test. |

## Cues, like a lighting console

A tower is a **fixture group** and each platter is a **fixture**, counted from 0 at the bottom. A **program** is a looping **cue list**. Each cue fades some **attributes** to new values. A **delay fan** across the group makes the change run up or down the tower.

```ts
const RELAY: ChaseProgram = {
  name: 'relay',
  speed: 1 / (8 * BEAT),          // laps per second; negative runs the other way
  direction: 'same',              // or 'alternate': neighbouring rings counter-rotate
  base: { intensity: 0, tail: 0, falloff: 0.72, phase: 1, heads: 1, glyph: GLYPH.slashedZero, spacing: 8 },
  cues: [
    //  label       hold: s to next GO   fade: s per platter   delay: s per platter, from an end   curve
    { label: 'rise',    hold: 16 * BEAT, fade: 0.55,     delay: BEAT,     from: 'bottom', easing: 'ignite', look: { intensity: 1 } },
    { label: 'trail',   hold: 24 * BEAT, fade: 4 * BEAT, delay: BEAT,     from: 'bottom', easing: 'smooth', look: { tail: 9 } },
    { label: 'retract', hold: 12 * BEAT, fade: 4 * BEAT, delay: BEAT / 2, from: 'top',    easing: 'smooth', look: { tail: 0 } },
    { label: 'release', hold: 8 * BEAT,  fade: BEAT,     delay: BEAT / 2, from: 'top',    easing: 'out',    look: { intensity: 0 } },
  ],
  rest: 20 * BEAT,                // dark time before the loop restarts
  restJitter: 32 * BEAT,          // each tower adds up to this much rest, from its seed
};
```

`BEAT` uses the soundtrack's nominal 88 BPM. This sets the chase tempo; randomized tower offsets are independent of audio playback, so the cues are not beat-synchronized to the playing track.

### Attributes (`ChaseLook`)

| Attribute | Meaning | Fades? |
| --- | --- | --- |
| `intensity` | Dimmer, 0..1. | yes |
| `tail` | Echoes trailing each head. A fractional value fades the last echo in. | yes |
| `falloff` | Brightness of each echo relative to the one ahead, 0..1. | yes |
| `phase` | How many glyph widths each platter trails the one below. 1 makes the staircase, 0 a straight column. | yes: crossfading it slides the glyphs round |
| `heads` | Heads spaced evenly round the ring: 1, 2, 4 or 8. | changes at once |
| `glyph` | Atlas index: `GLYPH.slashedZero`, `zero`, `block`, `dot`. | changes at once |
| `spacing` | Pixels from one echo to the next. 8 puts echoes in neighbouring modules. | changes at once |

A cue only changes the attributes in its `look`. The rest carry over from earlier cues, as on a tracking console.

### How a frame is worked out

Everything is a pure function of the engine's shared clock. Nothing keeps state between frames, so the room, every portal preview and every snapshot agree.

1. `towerTiming(program, seed)` gives each tower its loop length (the program plus its rest and jitter), where it starts in the loop, and a starting angle for its glyphs. All three come from an integer hash of the rack's seed. Nothing uses `Math.random` or `Date.now`.
2. The tower's loop time is `(time + offset) mod period`.
3. `sampleLook` starts from the settled look, which is where the last cue leaves things and so also where each loop starts. Each cue is then layered on in order. Platter `k`'s fade starts at `cue start + delay × k` (counted from the top when `from: 'top'`). It blends from whatever the cues before produce toward the cue's values by `easing(progress)`, so overlapping fades stay continuous. At the GO instant the old look still holds.
4. The glyph's position is not a cue attribute. It is `speed × time + angle` laps, minus `phase` glyph widths per platter. So the glyphs never jump when a cue fires or the loop wraps, and only the phase spread crossfades.

`compileProgram` rejects a program if any platter on the tallest tower would still be fading when its loop ends. That guarantees each loop ends exactly where the next one starts. The tests check this for every program at both tower heights, and also check the bottom-up start, the one-glyph lag at equal speed, and the tail growth order.

The easings are `linear`, `smooth`, `in`, `out`, `snap` and `ignite`. `ignite` is a deterministic power-on stutter: a flash, a drop, then a ramp up to full.

### Adding a program or a glyph

- **A program:** add a `ChaseProgram` to `programs.ts` and give it a weight in `PROGRAM_MIX`. The relay should stay the majority. Run `pnpm vitest run worlds/jp-relay`: the wrap test covers every program in the mix.
- **A glyph:** add an 8-row bitmap to `BITMAPS` in `glyphs.ts`, with `X` for a lit LED. It becomes `GLYPH.<name>`.

## Flat floor

The approved finish is a flat black mirror, with the matte walkway unchanged. Floor tuning controls, inspection lights, and saved ripple preferences have been removed.

## Occasional white solos

`specials.ts` temporarily overrides one inner-rank tower beside the promenade. Every 26 seconds it picks a tower with a seeded hash, waits 4–8 seconds, then alternates between:

- **Sparkle:** six seconds of independently staggered white slashed-zero flashes at random module positions on each platter. Sharp attacks, short decays, and skipped pulses keep the pattern scattered rather than synchronized.
- **Descent:** exactly one white zero on the entire tower. It steps through all 32 module positions in 0.8 seconds, then moves down one platter, continuing from the top to the bottom. No tails or overlap between platters.

Edit `SPECIALS` to tune timing. The ordinary orange programs keep running underneath and resume at their current time when the solo ends. Cage spill, haze and the mirrored displays follow the white tint. Selection and flashes use the shared clock; previews agree with the active room. No new meshes, render passes or real lights are added.

## How it's drawn

- **LED rims.** One instanced open cylinder for all 1,727 platters, plus one for their faces. Three instanced attributes per platter feed the shader: `aWhite` blends orange to white; `aChase` = (head pixel, tail, dimmer, direction) and `aStyle` = (glyph, heads, falloff, spacing). The fragment shader works out which echo of which glyph covers each LED and reads the bit from an 8 × 32 atlas. It draws each LED as a rounded square with a soft halo. Where LEDs get smaller than a pixel, it switches to how much of the pixel the lit run covers, so distant towers don't shimmer. Sampling the whole field takes about 0.25 ms a frame (measured in Node). Each frame uploads 28 KB of `aChase`, 7 KB of white tint and 3 KB of haze state. `aStyle` is only uploaded when a value changes, and a rack's cage glow only while it's changing (at most 35 KB).
- **Cages.** Posts, plinth, lid and rail frames are one instanced box mesh. Each box knows its rack's axis and glows orange (white during solos) on the faces that look at the platters, up to the tower's highest lit platter. A spindle runs through each stack.
- **Haze.** One soft vertical card per tower turns to face the eye and rises with the lit platters. It's additive and fades out up close, at steep angles and into the fog.
- **Floor.** One shader draws both the mirror plates and the walkway. The mirror plates are 32 ft lacquered plates with thin seams of slightly different widths, on the walkway's edges. The surface and its normals are flat, with no ripples or localized bumps. The walkway is 4 ft matte plates with 5 mm gaps, each a slightly different grey.

### Reflections, honestly

The floor's reflections are a **mirrored copy of the racks** (the same instances, drawn with `scale.y = -1`). The transparent floor blends its shaded surface over that geometry, with 28% normal-incidence reflectance rising toward the horizon and 0.08 surface roughness. There are no framebuffer copies, reflection textures, or additional scene passes.

What this leaves out:

- Only the racks, platters and haze reflect. Players, portals and anything the engine adds don't appear in the floor.
- The reflection is perfectly sharp. There's no roughness blur, and the dark seams only interrupt it.
- The orange light the towers give off is faked: emissive cage faces and haze, not real lights. The walkway is too far away to catch any.

## Collision and walking

The floor is walkable everywhere at y = 0, through both portals and along the walkway (`x` within ±2.44 m, `z` within ±40.2 m). Racks are solid up to their lids, so you slide along them. Fly over one and you can land on its lid, since the terrain height is one-way via `fromY`. The nearest rack stands 9.75 m from the centre line, well clear of both gates.
