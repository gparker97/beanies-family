#!/usr/bin/env python3
"""Build a horizontal beanies.family watermark lockup as a transparent PNG.

Two styles, and which you need depends entirely on what sits behind it:

  bare   mark + wordmark with a soft shadow. Use when the logo sits on a flat
         brand ground you control (the cream area of a framed preset). Cleanest
         look, but Deep Slate on a dark background is nearly invisible.

  scrim  the same lockup on a low-opacity cream pill. Use when the logo sits over
         live footage, where you cannot predict the background. Costs a little
         visually and saves you from the logo vanishing against dark scenery.

Usage:
  make_logo_lockup.py out.png --style scrim --mark-height 92 --wordmark-width 256
"""
import argparse, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREAM = (248, 249, 250)
SLATE = (44, 62, 80)


def build(style, mark_h, word_w, gap, scrim_alpha, radius):
    mark = Image.open(os.path.join(HERE, "assets", "mark.png")).convert("RGBA")
    word = Image.open(os.path.join(HERE, "assets", "wordmark.png")).convert("RGBA")
    mw = round(mark.width * mark_h / mark.height)
    mark = mark.resize((mw, mark_h), Image.LANCZOS)
    wh = round(word.height * word_w / word.width)
    word = word.resize((word_w, wh), Image.LANCZOS)

    if style == "mark":
        pad = 18
        c = Image.new("RGBA", (mark.width + pad * 2, mark_h + pad * 2), (0, 0, 0, 0))
        c.alpha_composite(mark, (pad, pad))
        sh = Image.new("RGBA", c.size, SLATE + (255,))
        sh.putalpha(c.getchannel("A").point(lambda a: int(a * 0.55)))
        sh = sh.filter(ImageFilter.GaussianBlur(8))
        out = Image.new("RGBA", c.size, (0, 0, 0, 0))
        out.alpha_composite(sh, (0, 3))
        out.alpha_composite(c)
        return out

    if style == "bare":
        pad = 22
        W, H = mw + gap + word_w, mark_h
        c = Image.new("RGBA", (W + pad * 2, H + pad * 2), (0, 0, 0, 0))
        c.alpha_composite(mark, (pad, pad))
        c.alpha_composite(word, (pad + mw + gap, pad + (H - wh) // 2))
        sh = Image.new("RGBA", c.size, SLATE + (255,))
        sh.putalpha(c.getchannel("A").point(lambda a: int(a * 0.5)))
        sh = sh.filter(ImageFilter.GaussianBlur(9))
        out = Image.new("RGBA", c.size, (0, 0, 0, 0))
        out.alpha_composite(sh, (0, 3))
        out.alpha_composite(c)
        return out

    padx, pady, pad = 26, 19, 26
    W, H = padx * 2 + mw + gap + word_w, pady * 2 + mark_h
    c = Image.new("RGBA", (W + pad * 2, H + pad * 2), (0, 0, 0, 0))
    sh = Image.new("RGBA", c.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [pad, pad + 5, pad + W - 1, pad + H - 1 + 5], radius=radius, fill=(30, 44, 58, 70))
    c.alpha_composite(sh.filter(ImageFilter.GaussianBlur(12)))
    pill = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        [0, 0, W - 1, H - 1], radius=radius, fill=CREAM + (scrim_alpha,))
    c.alpha_composite(pill, (pad, pad))
    c.alpha_composite(mark, (pad + padx, pad + pady))
    c.alpha_composite(word, (pad + padx + mw + gap, pad + (H - wh) // 2))
    return c


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--style", choices=["bare", "scrim", "mark"], default="scrim")
    ap.add_argument("--mark-height", type=int, default=92)
    ap.add_argument("--wordmark-width", type=int, default=256)
    ap.add_argument("--gap", type=int, default=17)
    ap.add_argument("--scrim-alpha", type=int, default=150, help="0-255 cream pill opacity")
    ap.add_argument("--radius", type=int, default=42)
    a = ap.parse_args()
    img = build(a.style, a.mark_height, a.wordmark_width, a.gap, a.scrim_alpha, a.radius)
    img.save(a.out)
    print(f"{a.out}  {img.size}  style={a.style}")
