# Credits & Asset Provenance

- **`assets/female_human_head_game.glb`**: Uncompressed glTF binary (1,019,424 bytes; SHA-256 `8e54537ad6b380b72861edc07cfefa3ab0866ae16a1724dd2900aca4fc7ad04a`), supplied directly by JP Whitaker from `/Users/jpw/Downloads/female_human_head_game.glb`.
  - Embedded metadata identifies the exporter as Khronos glTF Blender I/O v5.0.21 and the mesh node as `uploads_files_2958480_female+head`.
  - No creator name, source URL, or license was embedded in or supplied alongside the file; original authorship and third-party redistribution rights remain unverified.
  - At load time (`headGeometry.ts`), the single primitive is split by welded connected components into weathered stone skin (with buried shoulder geometry trimmed below ground and a vertex-clustered far LOD copy for distant heads) and separate glossy obsidian eyeballs.
- The reference illustration that guided the stone/obsidian/crimson palette and monumental scale is not redistributed with this room.
- All procedural cobblestone/stone/reflection textures (`textures.ts`), fractured rubble and ruined monolith geometries (`headGeometry.ts`), deterministic corridor layout (`layout.ts`), and WebGPU TSL shaders (`index.ts`) were written specifically for `worlds/jp-visages-synthesis`.
