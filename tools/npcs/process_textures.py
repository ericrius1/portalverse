"""
Portalverse AA NPC Portrait, PBR Texture & GLB Verification Pipeline.

Commands:
  portrait  <in_img> <out_img> [--size 512]
  pbr       <in_albedo> <out_dir> [--size 512] [--seamless] [--roughness-min 0.35] [--roughness-max 0.85] [--normal-strength 2.2] [--emissive-threshold 0.82]
  synth-pbr <out_dir> --style <style> --primary <#rrggbb> --secondary <#rrggbb> [--accent <#rrggbb>] [--size 512] [--seed 42]
  verify    <public_npcs_dir>
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

FORBIDDEN_GLB_EXTENSIONS = {
    "KHR_draco_mesh_compression",
    "EXT_meshopt_compression",
    "KHR_texture_basisu",
}
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_PORTRAIT_BYTES = 512 * 1024
MAX_PORTRAIT_EDGE = 1024


def hex_to_rgb01(hex_str: str) -> np.ndarray:
    h = hex_str.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return np.array([int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)], dtype=np.float32) / 255.0


def make_seamless(arr: np.ndarray, blend: float = 0.22) -> np.ndarray:
    """Smoothly wrap edges using offset-and-feather blending so textures tile seamlessly."""
    h, w = arr.shape[:2]
    shifted = np.roll(np.roll(arr, h // 2, axis=0), w // 2, axis=1)
    y = np.linspace(-1.0, 1.0, h, dtype=np.float32)[:, None]
    x = np.linspace(-1.0, 1.0, w, dtype=np.float32)[None, :]
    edge_dist = np.maximum(np.abs(x), np.abs(y))
    t = np.clip((edge_dist - (1.0 - blend * 2.0)) / max(1e-4, blend * 2.0), 0.0, 1.0)
    mask = t * t * (3.0 - 2.0 * t)
    if arr.ndim == 3:
        mask = mask[:, :, None]
    return arr * (1.0 - mask) + shifted * mask


def height_to_normal(height: np.ndarray, strength: float = 2.2) -> np.ndarray:
    """Multi-scale Sobel tangent-space OpenGL normal map from a 0..1 float heightfield."""
    # Periodic wrap padding so normal map also tiles seamlessly
    def sobel(field: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        p = np.pad(field, 1, mode="wrap")
        gx = (
            (p[0:-2, 2:] + 2.0 * p[1:-1, 2:] + p[2:, 2:])
            - (p[0:-2, 0:-2] + 2.0 * p[1:-1, 0:-2] + p[2:, 0:-2])
        ) * 0.25
        gy = (
            (p[2:, 0:-2] + 2.0 * p[2:, 1:-1] + p[2:, 2:])
            - (p[0:-2, 0:-2] + 2.0 * p[0:-2, 1:-1] + p[0:-2, 2:])
        ) * 0.25
        return gx, gy

    gx1, gy1 = sobel(height)
    # Coarser octave via simple 3x3 box blur
    p = np.pad(height, 1, mode="wrap")
    blurred = (
        p[0:-2, 0:-2] + p[0:-2, 1:-1] + p[0:-2, 2:]
        + p[1:-1, 0:-2] + p[1:-1, 1:-1] + p[1:-1, 2:]
        + p[2:, 0:-2] + p[2:, 1:-1] + p[2:, 2:]
    ) / 9.0
    gx2, gy2 = sobel(blurred)

    dx = -(gx1 * 0.65 + gx2 * 0.35) * strength
    dy = (gy1 * 0.65 + gy2 * 0.35) * strength
    dz = np.ones_like(dx)
    inv_len = 1.0 / np.sqrt(dx * dx + dy * dy + dz * dz + 1e-8)
    nx = (dx * inv_len * 0.5 + 0.5) * 255.0
    ny = (dy * inv_len * 0.5 + 0.5) * 255.0
    nz = (dz * inv_len * 0.5 + 0.5) * 255.0
    return np.clip(np.stack([nx, ny, nz], axis=-1), 0, 255).astype(np.uint8)


def tileable_value_noise(size: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    grid = rng.random((cells, cells), dtype=np.float32)
    coords = np.linspace(0.0, cells, size, endpoint=False, dtype=np.float32)
    ix = np.floor(coords).astype(np.int32)
    fx = coords - ix
    sx = fx * fx * (3.0 - 2.0 * fx)
    ix0 = ix % cells
    ix1 = (ix + 1) % cells

    y0 = ix0[:, None]
    y1 = ix1[:, None]
    x0 = ix0[None, :]
    x1 = ix1[None, :]
    sy = sx[:, None]
    sx_row = sx[None, :]

    c00 = grid[y0, x0]
    c10 = grid[y0, x1]
    c01 = grid[y1, x0]
    c11 = grid[y1, x1]
    top = c00 * (1.0 - sx_row) + c10 * sx_row
    bot = c01 * (1.0 - sx_row) + c11 * sx_row
    return top * (1.0 - sy) + bot * sy


def fbm_noise(size: int, base_cells: int, octaves: int, rng: np.random.Generator) -> np.ndarray:
    acc = np.zeros((size, size), dtype=np.float32)
    amp = 0.5
    norm = 0.0
    cells = base_cells
    for _ in range(octaves):
        acc += tileable_value_noise(size, min(cells, size), rng) * amp
        norm += amp
        amp *= 0.5
        cells *= 2
    return acc / max(1e-6, norm)


def cmd_portrait(args: argparse.Namespace) -> None:
    img = Image.open(args.input).convert("RGB")
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    # Favor upper-third headroom slightly for non-square portraits
    top = max(0, int((h - side) * 0.25))
    cropped = img.crop((left, top, left + side, top + side))
    resized = cropped.resize((args.size, args.size), Image.Resampling.LANCZOS)
    sharpened = resized.filter(ImageFilter.UnsharpMask(radius=1.1, percent=65, threshold=2))

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.suffix.lower() == ".webp":
        sharpened.save(out_path, format="WEBP", quality=86, method=5)
    elif out_path.suffix.lower() in (".jpg", ".jpeg"):
        sharpened.save(out_path, format="JPEG", quality=88, optimize=True)
    else:
        sharpened.save(out_path, format="PNG", optimize=True)
    print(f"PORTRAIT_OK {out_path} ({out_path.stat().st_size} bytes)")


def cmd_pbr(args: argparse.Namespace) -> None:
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(args.input).convert("RGB")
    img = img.resize((args.size, args.size), Image.Resampling.LANCZOS)
    albedo = np.asarray(img, dtype=np.float32) / 255.0
    if args.seamless:
        albedo = make_seamless(albedo, blend=0.22)

    lum = albedo[:, :, 0] * 0.299 + albedo[:, :, 1] * 0.587 + albedo[:, :, 2] * 0.114
    normal_u8 = height_to_normal(lum, strength=args.normal_strength)

    # Roughness: smoother on bright/sheen accents, rougher in dark crevices
    rough = args.roughness_max - lum * (args.roughness_max - args.roughness_min)
    rough_u8 = np.clip(rough * 255.0, 0, 255).astype(np.uint8)

    # Emissive mask for bright glowing accents
    if args.emissive_threshold >= 1.0:
        emis_u8 = np.zeros_like(normal_u8)
    else:
        sat = np.max(albedo, axis=-1) - np.min(albedo, axis=-1)
        glow_metric = np.maximum(lum, sat * 0.85 + lum * 0.35)
        mask = np.clip((glow_metric - args.emissive_threshold) / max(1e-4, 1.0 - args.emissive_threshold), 0.0, 1.0)
        emis = albedo * (mask[:, :, None] ** 1.4)
        emis_u8 = np.clip(emis * 255.0, 0, 255).astype(np.uint8)

    albedo_u8 = np.clip(albedo * 255.0, 0, 255).astype(np.uint8)
    Image.fromarray(albedo_u8, "RGB").save(out_dir / "albedo.png", optimize=True)
    Image.fromarray(normal_u8, "RGB").save(out_dir / "normal.png", optimize=True)
    Image.fromarray(rough_u8, "L").save(out_dir / "roughness.png", optimize=True)
    Image.fromarray(emis_u8, "RGB").save(out_dir / "emissive.png", optimize=True)
    print(f"PBR_OK {out_dir}")


def cmd_synth_pbr(args: argparse.Namespace) -> None:
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    size = args.size
    rng = np.random.default_rng(args.seed)

    c1 = hex_to_rgb01(args.primary)
    c2 = hex_to_rgb01(args.secondary)
    ca = hex_to_rgb01(args.accent) if args.accent else c2

    u = np.linspace(0.0, 1.0, size, endpoint=False, dtype=np.float32)[None, :]
    v = np.linspace(0.0, 1.0, size, endpoint=False, dtype=np.float32)[:, None]

    base_n = fbm_noise(size, 8, 4, rng)
    fine_n = fbm_noise(size, 32, 3, rng)
    emissive = np.zeros((size, size, 3), dtype=np.float32)

    style = args.style.lower()
    if style == "fabric":
        warp = 0.5 + 0.5 * np.sin(u * math.tau * 48.0)
        weft = 0.5 + 0.5 * np.sin(v * math.tau * 48.0)
        weave = 0.5 * warp + 0.5 * weft
        height = base_n * 0.45 + weave * 0.4 + fine_n * 0.15
        mix_t = np.clip(base_n * 0.65 + weave * 0.35, 0.0, 1.0)
        albedo = c1 * (1.0 - mix_t[:, :, None]) + c2 * mix_t[:, :, None]
        rough = 0.72 + (1.0 - weave) * 0.18
        normal_strength = 2.0
    elif style == "metal":
        brush = fbm_noise(size, 6, 3, rng) * 0.5 + tileable_value_noise(size, 64, rng) * 0.2
        streak = 0.5 + 0.5 * np.sin(v * math.tau * 90.0 + base_n * 3.0)
        height = brush * 0.55 + streak * 0.3 + fine_n * 0.15
        mix_t = np.clip(height * 0.8, 0.0, 1.0)
        albedo = c1 * (1.0 - mix_t[:, :, None]) + c2 * mix_t[:, :, None]
        rough = 0.18 + (1.0 - height) * 0.28
        normal_strength = 1.6
    elif style == "stone":
        ridge = 1.0 - np.abs(base_n * 2.0 - 1.0)
        height = ridge * 0.55 + fine_n * 0.45
        mix_t = np.clip(height, 0.0, 1.0)
        albedo = c1 * (1.0 - mix_t[:, :, None]) + c2 * mix_t[:, :, None]
        rough = 0.68 + (1.0 - ridge) * 0.25
        normal_strength = 3.2
    elif style == "cyber":
        grid_u = np.abs(np.sin(u * math.tau * 12.0))
        grid_v = np.abs(np.sin(v * math.tau * 12.0))
        trace = ((grid_u < 0.07) | (grid_v < 0.07)).astype(np.float32) * (base_n > 0.42).astype(np.float32)
        height = 0.35 + base_n * 0.25 + trace * 0.4
        albedo = c1 * (1.0 - base_n[:, :, None] * 0.35) + c2 * (base_n[:, :, None] * 0.35)
        albedo = albedo * (1.0 - trace[:, :, None] * 0.7) + ca * (trace[:, :, None] * 0.7)
        emissive = ca * trace[:, :, None] * 0.95
        rough = 0.32 + (1.0 - trace) * 0.35
        normal_strength = 2.4
    elif style == "organic":
        veins = np.exp(-((np.abs(base_n - 0.5) * 14.0) ** 2))
        height = base_n * 0.5 + fine_n * 0.25 + veins * 0.25
        albedo = c1 * (1.0 - base_n[:, :, None]) + c2 * base_n[:, :, None]
        albedo = albedo * (1.0 - veins[:, :, None] * 0.65) + ca * (veins[:, :, None] * 0.65)
        emissive = ca * veins[:, :, None] * 0.75
        rough = 0.42 + (1.0 - veins) * 0.35
        normal_strength = 2.4
    elif style == "celestial":
        swirl = 0.5 + 0.5 * np.sin((u * 3.0 + v * 2.0 + base_n * 1.4) * math.tau)
        stars = (fine_n > 0.86).astype(np.float32)
        height = swirl * 0.5 + base_n * 0.35 + stars * 0.15
        albedo = c1 * (1.0 - swirl[:, :, None] * 0.65) + c2 * (swirl[:, :, None] * 0.65)
        albedo = np.clip(albedo + ca * stars[:, :, None] * 0.9, 0.0, 1.0)
        emissive = ca * (stars[:, :, None] * 0.95 + swirl[:, :, None] * 0.18)
        rough = 0.26 + (1.0 - swirl) * 0.35
        normal_strength = 1.8
    elif style == "coral":
        scales = 0.5 + 0.5 * np.sin(u * math.tau * 22.0 + np.sin(v * math.tau * 11.0) * 1.6) * np.cos(v * math.tau * 22.0)
        height = scales * 0.55 + base_n * 0.3 + fine_n * 0.15
        albedo = c1 * (1.0 - scales[:, :, None]) + c2 * scales[:, :, None]
        albedo = albedo * 0.82 + ca * (np.clip(scales - 0.65, 0.0, 1.0)[:, :, None] * 0.7)
        emissive = ca * np.clip(scales - 0.8, 0.0, 1.0)[:, :, None] * 0.8
        rough = 0.25 + (1.0 - scales) * 0.32
        normal_strength = 2.8
    elif style == "snow":
        knit = 0.5 + 0.5 * np.sin(u * math.tau * 26.0 + np.sin(v * math.tau * 26.0) * 1.2)
        height = knit * 0.45 + base_n * 0.35 + fine_n * 0.2
        albedo = c1 * (1.0 - knit[:, :, None] * 0.45) + c2 * (knit[:, :, None] * 0.45)
        rough = 0.78 + fine_n * 0.16
        normal_strength = 2.5
    elif style == "honey":
        drip = 0.5 + 0.5 * np.sin(u * math.tau * 8.0 + base_n * 4.0) * np.exp(-((v - 0.5) * 1.4) ** 2)
        height = drip * 0.6 + base_n * 0.4
        albedo = c1 * (1.0 - drip[:, :, None] * 0.55) + c2 * (drip[:, :, None] * 0.55)
        rough = 0.14 + (1.0 - drip) * 0.22
        normal_strength = 1.9
    else:  # wood or fallback
        grain = 0.5 + 0.5 * np.sin((u * 14.0 + base_n * 2.8) * math.tau)
        height = grain * 0.6 + fine_n * 0.4
        albedo = c1 * (1.0 - grain[:, :, None] * 0.55) + c2 * (grain[:, :, None] * 0.55)
        rough = 0.55 + (1.0 - grain) * 0.3
        normal_strength = 2.2

    albedo_u8 = np.clip(albedo * 255.0, 0, 255).astype(np.uint8)
    normal_u8 = height_to_normal(height, strength=normal_strength)
    rough_u8 = np.clip(rough * 255.0, 0, 255).astype(np.uint8)
    emis_u8 = np.clip(emissive * 255.0, 0, 255).astype(np.uint8)

    Image.fromarray(albedo_u8, "RGB").save(out_dir / "albedo.png", optimize=True)
    Image.fromarray(normal_u8, "RGB").save(out_dir / "normal.png", optimize=True)
    Image.fromarray(rough_u8, "L").save(out_dir / "roughness.png", optimize=True)
    Image.fromarray(emis_u8, "RGB").save(out_dir / "emissive.png", optimize=True)
    print(f"SYNTH_PBR_OK {out_dir} style={style}")


def inspect_glb(path: Path) -> dict[str, object]:
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        return {"ok": False, "error": "invalid glTF magic"}
    if len(data) > MAX_FILE_BYTES:
        return {"ok": False, "error": f"exceeds 4 MiB ({len(data)} bytes)"}
    chunk_len, chunk_type = struct.unpack_from("<II", data, 12)
    if chunk_type != 0x4E4F534A:  # JSON
        return {"ok": False, "error": "missing JSON chunk"}
    meta = json.loads(data[20 : 20 + chunk_len].decode("utf-8"))
    used = set(meta.get("extensionsUsed", [])) | set(meta.get("extensionsRequired", []))
    bad = sorted(used & FORBIDDEN_GLB_EXTENSIONS)
    if bad:
        return {"ok": False, "error": f"forbidden extensions: {bad}"}
    return {
        "ok": True,
        "bytes": len(data),
        "meshes": len(meta.get("meshes", [])),
        "skins": len(meta.get("skins", [])),
        "materials": len(meta.get("materials", [])),
        "images": len(meta.get("images", [])),
    }


def cmd_verify(args: argparse.Namespace) -> None:
    root = Path(args.dir)
    if not root.exists():
        print(json.dumps({"ok": False, "error": f"missing directory {root}"}))
        sys.exit(1)

    report: dict[str, object] = {}
    errors: list[str] = []

    for sub in sorted(p for p in root.iterdir() if p.is_dir()):
        entry: dict[str, object] = {}
        glb = sub / "model.glb"
        if glb.exists():
            res = inspect_glb(glb)
            entry["glb"] = res
            if not res.get("ok"):
                errors.append(f"{sub.name}/model.glb: {res.get('error')}")
        else:
            errors.append(f"{sub.name}: missing model.glb")

        portrait = next((sub / name for name in ("portrait.webp", "portrait.png", "portrait.jpg") if (sub / name).exists()), None)
        if portrait:
            with Image.open(portrait) as im:
                w, h = im.size
            sz = portrait.stat().st_size
            p_ok = w <= MAX_PORTRAIT_EDGE and h <= MAX_PORTRAIT_EDGE and sz <= MAX_PORTRAIT_BYTES
            entry["portrait"] = {"file": portrait.name, "width": w, "height": h, "bytes": sz, "ok": p_ok}
            if not p_ok:
                errors.append(f"{sub.name}/{portrait.name}: exceeds portrait budget ({w}x{h}, {sz}B)")
        else:
            errors.append(f"{sub.name}: missing portrait")

        report[sub.name] = entry

    print(json.dumps({"ok": len(errors) == 0, "count": len(report), "errors": errors, "npcs": report}, indent=2))
    if errors:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description="Portalverse NPC Portrait & PBR Texture Pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_port = sub.add_parser("portrait")
    p_port.add_argument("input")
    p_port.add_argument("output")
    p_port.add_argument("--size", type=int, default=512)
    p_port.set_defaults(func=cmd_portrait)

    p_pbr = sub.add_parser("pbr")
    p_pbr.add_argument("input")
    p_pbr.add_argument("output_dir")
    p_pbr.add_argument("--size", type=int, default=512)
    p_pbr.add_argument("--seamless", action="store_true")
    p_pbr.add_argument("--roughness-min", type=float, default=0.35)
    p_pbr.add_argument("--roughness-max", type=float, default=0.85)
    p_pbr.add_argument("--normal-strength", type=float, default=2.2)
    p_pbr.add_argument("--emissive-threshold", type=float, default=0.82)
    p_pbr.set_defaults(func=cmd_pbr)

    p_syn = sub.add_parser("synth-pbr")
    p_syn.add_argument("output_dir")
    p_syn.add_argument("--style", required=True)
    p_syn.add_argument("--primary", required=True)
    p_syn.add_argument("--secondary", required=True)
    p_syn.add_argument("--accent", default=None)
    p_syn.add_argument("--size", type=int, default=512)
    p_syn.add_argument("--seed", type=int, default=42)
    p_syn.set_defaults(func=cmd_synth_pbr)

    p_ver = sub.add_parser("verify")
    p_ver.add_argument("dir")
    p_ver.set_defaults(func=cmd_verify)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
