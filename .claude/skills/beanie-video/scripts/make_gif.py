#!/usr/bin/env python3
"""Encode a GIF, optionally searching for the largest version that fits a byte budget.

Platforms cap uploads (Substack is 5 MB) and handheld footage is expensive in GIF:
the camera moves, so almost every pixel changes every frame and there is very little
for the format to reuse. Expect to give something up.

What to give up, in order - this ordering came from measuring, not taste:

  1. Grain. Handheld indoor footage carries sensor noise that changes every pixel every
     frame, which defeats GIF's frame-differencing entirely. A light hqdn3d pre-pass buys
     ~20% for very little visible cost, and it is the only lever that makes the format
     work better rather than just asking it to do less. Pushed too hard it plasticises
     faces, so this stays light.
  2. Frame rate. Cheap. 12.5 -> 12 fps is imperceptible on handheld footage. Below about
     10 it starts to look like a flipbook, and fast beats (an arm raise, a head turn)
     strobe before slow ones do.
  3. Width. Predictable and graceful. Costs detail evenly.
  4. Colour depth. LAST RESORT. Dropping 128 -> 96 saves less than a width step and
     blotches skin tones green and pink. Faces are where a viewer looks; do not pay
     for file size out of the faces.

Dither is a size lever too, not just a quality one. Error diffusion (sierra2_4a) makes a
single frame look nicer and re-randomises pixels every frame, destroying inter-frame
compression - on this footage it produced 11.6 MB against 6.9 MB for no dither. If you
want dithering, use ordered Bayer: the pattern is static, so it still compresses.

Deliberately NOT offered: ImageMagick's lossy `-fuzz` frame optimisation. It hits a
much smaller file at full width, which is tempting, but it works by leaving
near-matching pixels un-updated between frames. On a flat background that is free;
on a face it shows as blotches crawling around as the animation plays.

Usage:
  make_gif.py in.mp4 out.gif --width 480 --fps 12.5
  make_gif.py in.mp4 out.gif --max-bytes 5000000 --width 480
"""
import argparse, os, subprocess, sys, tempfile


def encode(src, dst, width, fps, colors, denoise=None, dither="none"):
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as t:
        pal = t.name
    try:
        dn = f"hqdn3d={denoise}," if denoise else ""
        vf = f"{dn}fps={fps},scale={width}:-2:flags=lanczos"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf",
                        f"{vf},palettegen=max_colors={colors}:stats_mode=diff", pal], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-i", pal, "-lavfi",
                        f"{vf}[x];[x][1:v]paletteuse=dither={dither}:diff_mode=rectangle",
                        "-gifflags", "+transdiff", "-loop", "0", dst], check=True)
    finally:
        os.unlink(pal)
    return os.path.getsize(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--width", type=int, default=480)
    ap.add_argument("--fps", type=float, default=12.5)
    ap.add_argument("--colors", type=int, default=128)
    ap.add_argument("--denoise", default="4:3:6:6",
                    help="hqdn3d strength; grain defeats GIF frame-differencing so a light "
                         "pass is the cheapest saving available. Pass '' to disable.")
    ap.add_argument("--dither", default="none", choices=["none", "bayer", "sierra2_4a"],
                    help="error diffusion re-randomises pixels every frame and wrecks "
                         "inter-frame compression; prefer none, or bayer if you need it")
    ap.add_argument("--max-bytes", type=int, default=None,
                    help="search for the largest version that fits (e.g. 5000000 for Substack)")
    ap.add_argument("--min-width", type=int, default=300)
    ap.add_argument("--headroom", type=float, default=0.04,
                    help="aim this far under the cap, so a re-encode elsewhere still fits")
    a = ap.parse_args()

    dn = a.denoise or None
    if not a.max_bytes:
        n = encode(a.src, a.dst, a.width, a.fps, a.colors, dn, a.dither)
        print(f"{a.dst}  {a.width}w {a.fps}fps {a.colors}c"
              f"{' denoise=' + dn if dn else ''}  {n:,} bytes ({n/1e6:.2f} MB)")
        return

    target = int(a.max_bytes * (1 - a.headroom))
    seen = {}          # (width, fps) -> bytes, so we never encode the same thing twice
    on_disk = [None]   # which (width, fps) the output file currently holds

    def try_enc(width, fps):
        key = (width, fps)
        if key in seen:
            return seen[key]
        n = encode(a.src, a.dst, width, fps, a.colors, dn, a.dither)
        on_disk[0] = key
        seen[key] = n
        print(f"  tried {width}w {fps}fps {a.colors}c -> {n:,} bytes", file=sys.stderr)
        return n

    def fit_width_at(fps, size_hint, width_hint):
        """Largest width (multiple of 20) that fits at this fps.

        Size scales roughly with width squared, so estimate a starting width from a
        known measurement rather than stepping down from the top - each encode is
        slow and the estimate usually lands within one step."""
        est = int(width_hint * (target / size_hint) ** 0.5) if size_hint > target else width_hint
        w = min(a.width, max(a.min_width, est - est % 20 + 20))
        last_ok = None
        while w >= a.min_width:
            n = try_enc(w, fps)
            if n <= target:
                last_ok = (w, n)
                if w + 20 <= a.width and try_enc(w + 20, fps) <= target:
                    last_ok = (w + 20, seen[(w + 20, fps)])
                break
            w -= 20
        return last_ok

    base = try_enc(a.width, a.fps)
    if base <= target:
        print(f"{a.dst}  {a.width}w {a.fps}fps {a.colors}c  {base:,} bytes "
              f"({base/1e6:.2f} MB)  {a.max_bytes - base:,} bytes under the cap")
        return

    # Frame rate is the cheapest thing to give up, so spend it before pixels - but only
    # when the file is meaningfully over. If a small width trim gets there, keep the fps.
    overshoot = base / target
    ladder = [f for f in (12.5, 12, 11, 10.5, 10) if f < a.fps] or []
    fps_order = ([a.fps] + ladder) if overshoot <= 1.12 else (ladder + [a.fps] if ladder else [a.fps])

    best = None
    for fps in fps_order:
        got = fit_width_at(fps, base, a.width)
        if got:
            best = (got[0], fps, got[1])
            break

    if not best:
        print(f"\nCould not fit {a.max_bytes:,} bytes down to {a.min_width}px wide at "
              f"{a.colors} colours.\nRather than dropping colour depth and wrecking the "
              f"faces, deliver an mp4 instead - it is smaller than any of these and looks "
              f"better. Use a GIF only where the destination genuinely cannot play video "
              f"(email is the real case).", file=sys.stderr)
        sys.exit(1)

    width, fps, n = best
    if on_disk[0] != (width, fps):
        n = encode(a.src, a.dst, width, fps, a.colors, dn, a.dither)
    print(f"{a.dst}  {width}w {fps}fps {a.colors}c{' denoise=' + dn if dn else ''}  "
          f"{n:,} bytes ({n/1e6:.2f} MB)  {a.max_bytes - n:,} bytes under the cap")


if __name__ == "__main__":
    main()
