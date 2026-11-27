# Adventurer characters

Original models and their 24 embedded animations by **Quaternius**, supplied as uncompressed GLBs:

- `adventurer-woman.glb`: [Adventurer on Poly Pizza](https://poly.pizza/m/ZwF0K7WBmu)
- `adventurer-man.glb`: [Adventurer on Poly Pizza](https://poly.pizza/m/5EGWBMpuXq)

Both source listings identify the assets as **Public Domain (CC0)**. The GLB bytes are unchanged. Runtime code normalizes scale/orientation, creates per-player skin materials, blends the supplied movement clips while keeping foot controls attached to the ankles, and adds procedural airborne poses. The walk clip plays at 1.4 times its prior cadence; run timing is unchanged. No weapon or combat clips are bound to unrelated gameplay actions.

## Skin color design

The continuous, artist-authored albedo palette spans pale peach through deep brown. Oklab interpolation varies hue/chroma along with lightness. A limited rosy-to-golden undertone control provides another dimension without exposing an unrestricted rainbow hue control. Only the named `Skin` material changes; clothes, hair, eyes and equipment retain their original colors. All materials use maximum roughness (1); skin also uses nonmetallic shading.

Research informing the choice of a broad color range and independent undertone:

- [Google Research: Which Skin Tone Measures Are the Most Inclusive?](https://research.google/pubs/which-skin-tone-measures-are-the-most-inclusive-an-investigation-of-skin-tone-measures-for-machine-learning/)
- [Ellis Monk / Google: Skin Tone Research](https://skintone.google/)
- [Beyond Skin Tone: A Multidimensional Measure of Apparent Skin Color](https://arxiv.org/abs/2309.05148)
- [Oklab color space, Björn Ottosson](https://bottosson.github.io/posts/oklab/)

This is a game customization palette, not a demographic classification or a reproduction of the Monk scale. The default is a warm medium brown (`skinTone: 0.52`, `undertone: 0.2`). Lighting and display settings affect its rendered appearance.
