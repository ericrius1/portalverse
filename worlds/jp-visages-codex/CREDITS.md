# Asset provenance

`assets/head.glb` and `assets/head-distant.glb` are derived from the user-supplied
`female_human_head_game.glb` (1,019,424 bytes; SHA-256 `8e54537ad6b380b72861edc07cfefa3ab0866ae16a1724dd2900aca4fc7ad04a`).

The supplied file identifies its exporter as Khronos glTF Blender I/O v5.0.21
and its mesh as `uploads_files_2958480_female+head`. No creator name, source URL,
or license was supplied or embedded; attribution and redistribution rights
remain unverified. No author or license is inferred from the filename.

The supplied inspiration JPEG guided the stone, black eyes, red liquid and
monumental scale. It is not redistributed with this room.

Preparation preserves the original face and eyeball geometry, bakes the upright
orientation, clips away the shoulders at source y=8.2, and normalizes the head
to 30 metres tall. The distant mesh uses vertex clustering. Both exports are
uncompressed, with separate skin/eye material slots and no embedded textures.
Run `python3 worlds/jp-visages-codex/tools/prepare_head.py /path/to/female_human_head_game.glb`
with NumPy installed to reproduce them. Stone, floor, liquid, reflection sky,
rubble and layout are procedural work created for this room.
