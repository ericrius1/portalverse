# Credits & Asset Provenance

- **`assets/female_human_head_game.glb`**: Uncompressed glTF binary (1,019,424 bytes; SHA-256 `8e54537ad6b380b72861edc07cfefa3ab0866ae16a1724dd2900aca4fc7ad04a`), supplied directly by JP Whitaker from `/Users/jpw/Downloads/female_human_head_game.glb`.
  - Embedded metadata identifies the exporter as Khronos glTF Blender I/O v5.0.21 and the mesh node as `uploads_files_2958480_female+head`.
  - No creator name, source URL, or license was embedded in or supplied alongside the file; original authorship and third-party redistribution rights remain unverified.
  - At load time (`headGeometry.ts`), the single primitive is split by welded connected components into weathered stone skin (with buried shoulder geometry trimmed below ground) and separate glossy obsidian eyeballs.
- The reference illustration that guided the stone/obsidian/crimson palette and monumental scale is not redistributed with this room.
- All procedural cobblestone/stone/reflection textures (`textures.ts`), fractured rubble and ruined monolith geometries (`headGeometry.ts`), deterministic corridor layout (`layout.ts`), and WebGPU TSL shaders (`index.ts`) were written specifically for `worlds/jp-visages-synthesis`.

- **`assets/head-medium.glb`, `assets/head-far.glb`**: Derived from the same supplied model using Blender 5.0's collapse decimator, in the normalized coordinate frame of `loadSplitHead`. Medium: 9,263 skin + 1,182 eye triangles; far: 2,480 skin + 472 eye triangles. No textures or compression. The close-up source stays unchanged. Regenerate with `tools/export-normalized.mjs` followed by Blender's background `tools/prepare-lods.py`; commands are documented in those scripts. The source's authorship/license uncertainty also applies to these derived assets.
