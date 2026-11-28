# Coral Reef Walk — asset credits

The coral, rock, seaweed, jellyfish, fish, turtle and manta ray models in `assets/` come from the low-poly underwater pack JP used in `react-fiber-sea-floor`, `longHome` and `collectivSea`. Its original source and licence weren't recorded there; confirm them before this room is shipped publicly.

## CollectivSea water lighting

The turquoise water/fog colour (`#0fa2ab`) and fog range come from JP's `collectivSea/app/experience/Experience.jsx` and `app/global.css`. The animated caustic field is derived from that project's `public/water_1_lite_1.mp4`, used by `CausticLight.jsx`. The source project is the reference, not a new third-party shader dependency.

`assets/collectivsea-caustics.png` contains 64 grayscale frames from the six-second clip, arranged as an 8×8 atlas with 256×144 pixels per frame (2048×1152 total). Regenerate from the original asset with:

```sh
ffmpeg -i /path/to/collectivSea/public/water_1_lite_1.mp4 -vf 'fps=32/3,scale=256:144,format=gray,tile=8x8' -frames:v 1 worlds/jp-reef/assets/collectivsea-caustics.png
```

The room's TSL adapter interpolates neighbouring frames on the shared engine clock and projects the field over sand, creatures, and coral. It replaces the original video's spotlight with room-local material lighting, so the pattern extends through the walkable canyon without extra light/shadow passes. This is an adaptation of the original look, not a pixel-identical rendering of its React Three Fiber scene.
