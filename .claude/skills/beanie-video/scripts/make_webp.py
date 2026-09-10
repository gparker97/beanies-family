#!/usr/bin/env python3
"""Encode an animated WebP with correct per-frame durations.

Prefer WebP over GIF wherever the destination allows it: same footage lands at roughly
half the bytes at a higher resolution and frame rate, because WebP does real inter-frame
compression where GIF only has a 256-colour palette and transparency tricks.

This goes through Pillow rather than ffmpeg's libwebp muxer for one practical reason:
Pillow's `minimize_size` merges byte-identical adjacent frames into a single longer-duration
frame. Frame-duplicated slow motion produces a lot of those, so it is free size back.

Usage:
  make_webp.py in.mp4 out.webp --width 608 --fps 20
"""
import argparse, os, subprocess, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_output import webp_info  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=608)
    ap.add_argument("--fps", type=float, default=20)
    ap.add_argument("--quality", type=int, default=72)
    ap.add_argument("--method", type=int, default=5, help="0-6; higher is slower and smaller")
    a = ap.parse_args()

    sw, sh = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0", a.src],
        capture_output=True, text=True).stdout.strip().split(",")
    W = a.width - a.width % 2
    H = int(round(int(sh) * W / int(sw)))
    H -= H % 2

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", a.src, "-vf",
         f"fps={a.fps},scale={W}:{H}:flags=lanczos", "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
    stride = W * H * 3
    frames = [Image.frombytes("RGB", (W, H), raw[i * stride:(i + 1) * stride])
              for i in range(len(raw) // stride)]
    if not frames:
        sys.exit("no frames decoded - check the input path")

    dur = int(round(1000.0 / a.fps))
    frames[0].save(a.dst, format="WEBP", save_all=True, append_images=frames[1:],
                   duration=dur, loop=0, quality=a.quality, method=a.method,
                   minimize_size=True)

    info = webp_info(a.dst)
    n = os.path.getsize(a.dst)
    print(f"{a.dst}  {W}x{H}  {info['frames']} frames  {info['total_ms']/1000:.2f}s  "
          f"loop={'infinite' if info['loops'] == 0 else info['loops']}  "
          f"{n:,} bytes ({n/1e6:.2f} MB)")
    if info["frames"] < len(frames):
        print(f"   ({len(frames) - info['frames']} duplicate frames merged into longer "
              f"durations - expected with frame-duplicated slow motion)")
    if info["total_ms"] == 0:
        sys.exit("ERROR: frames carry no duration")


if __name__ == "__main__":
    main()
