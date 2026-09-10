#!/usr/bin/env python3
"""Build a framing plate: a full-canvas PNG that is opaque brand ground everywhere
except a feathered hole where the footage shows through.

Composite order is: video underneath, plate on top. Everything outside the hole is
hidden by the plate, so the video only has to cover the hole itself.

Why the alpha ramp is computed with numpy rather than PIL's ellipse: on an oval,
a fixed-pixel feather has to be measured in real pixels, not in normalised
ellipse-space. Scaling a normalised distance gives you a feather that is thin at
the sides and fat at the poles, which reads as a wobbly edge. The ramp below
converts normalised distance back to pixels using rx, so the softness is even
all the way round.

Usage:
  make_frame_plate.py out.png --shape oval --rx 480 --ry 660 --cy 830 \
      --logo lockup.png --logo-y 1670
"""
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CREAM = (248, 249, 250)
SLATE = (44, 62, 80)


def parse_colour(s):
    """Accept #RRGGBB or 0xRRGGBB; fall back to Cloud White."""
    h = s.lower().lstrip("#").replace("0x", "")
    try:
        return tuple(bytes.fromhex(h))
    except ValueError:
        return CREAM


def build(a):
    W, H = a.width, a.height
    cx = a.cx if a.cx is not None else W // 2
    cy = a.cy if a.cy is not None else H // 2
    rx = a.rx
    ry = a.rx if a.shape == "circle" else a.ry

    plate = Image.new("RGBA", (W, H), parse_colour(a.ground) + (255,))

    # drop shadow, so the print reads as mounted on the paper rather than cut into it
    if a.shadow:
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(sh).ellipse(
            [cx - rx - a.ring, cy - ry - a.ring + a.shadow_dy,
             cx + rx + a.ring, cy + ry + a.ring + a.shadow_dy], fill=SLATE + (a.shadow_alpha,))
        plate.alpha_composite(sh.filter(ImageFilter.GaussianBlur(a.shadow_blur)))

    # the frame ring
    if a.ring > 0:
        ring = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d = ImageDraw.Draw(ring)
        d.ellipse([cx - rx - a.ring, cy - ry - a.ring, cx + rx + a.ring, cy + ry + a.ring],
                  fill=(255, 255, 255, 255))
        d.ellipse([cx - rx - a.ring + 3, cy - ry - a.ring + 3,
                   cx + rx + a.ring - 3, cy + ry + a.ring - 3], fill=SLATE + (a.ring_alpha,))
        d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(0, 0, 0, 0))
        plate.alpha_composite(ring)

    if a.logo:
        lg = Image.open(a.logo).convert("RGBA")
        ly = a.logo_y if a.logo_y is not None else H - lg.height - 120
        plate.alpha_composite(lg, ((W - lg.width) // 2, ly - lg.height // 2))

    # punch the hole with an even, real-pixel feather
    y, x = np.ogrid[:H, :W]
    e = np.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2)
    hole = np.clip((e - 1.0) * rx / a.feather + 1.0, 0.0, 1.0)
    alpha = np.array(plate.getchannel("A"), dtype=np.float32) / 255.0
    plate.putalpha(Image.fromarray((np.minimum(alpha, hole) * 255).astype(np.uint8)))
    return plate, (cx, cy, rx, ry)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--shape", choices=["oval", "circle"], default="oval")
    ap.add_argument("--width", type=int, default=1080)
    ap.add_argument("--height", type=int, default=1920)
    ap.add_argument("--cx", type=int, default=None)
    ap.add_argument("--cy", type=int, default=830)
    ap.add_argument("--rx", type=int, default=480)
    ap.add_argument("--ry", type=int, default=660)
    ap.add_argument("--ring", type=int, default=11)
    ap.add_argument("--ring-alpha", type=int, default=46)
    ap.add_argument("--feather", type=float, default=3.0, help="edge softness in pixels")
    ap.add_argument("--ground", default="#F8F9FA")
    ap.add_argument("--shadow", action="store_true", default=True)
    ap.add_argument("--no-shadow", dest="shadow", action="store_false")
    ap.add_argument("--shadow-alpha", type=int, default=68)
    ap.add_argument("--shadow-blur", type=int, default=28)
    ap.add_argument("--shadow-dy", type=int, default=12)
    ap.add_argument("--logo", default=None)
    ap.add_argument("--logo-y", type=int, default=None)
    a = ap.parse_args()
    plate, (cx, cy, rx, ry) = build(a)
    plate.save(a.out)
    print(f"{a.out}  {plate.size}")
    print(f"video box: {2*rx}x{2*ry} at ({cx-rx},{cy-ry})   aspect {2*rx/(2*ry):.3f}")
    hexc = "0x" + "".join(f"{c:02X}" for c in parse_colour(a.ground))
    print(f"ffmpeg:  ...,scale={2*rx}:{2*ry},pad={a.width}:{a.height}:{cx-rx}:{cy-ry}:color={hexc}[framed]")
