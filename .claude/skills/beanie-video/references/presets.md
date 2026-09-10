# Look presets

A preset is a complete set of numbers for a finished look, so a video made months apart
matches. Pick one, or add one - but write the numbers down either way.

## Contents

- [oval-frame](#oval-frame) - footage in a vertical oval on cream, logo below
- [full-bleed](#full-bleed) - footage fills the frame, watermark over it
- [Adding a preset](#adding-a-preset)

## oval-frame

Footage sits in a vertical oval on a Cloud White ground with a thin ring and a soft drop
shadow, so it reads as a mounted print. The mask crops away room clutter - sofa, floor,
wall - without touching the subject, which is what makes handheld family footage look
deliberate rather than incidental.

**Canvas** 1080x1920 (9:16)

| | |
|---|---|
| oval centre | (540, 830) |
| radii | rx 480, ry 660 |
| video box | 960x1320, placed at (60, 170) - aspect 0.727 |
| ring | 11px, Deep Slate at 18% (`--ring-alpha 46`) |
| feather | 3px, even all the way round |
| shadow | Slate at 27%, blur 28, offset +12y |
| ground | Cloud White `#F8F9FA` |
| source window | `crop=1080:1485:0:<per-shot offset>` |
| vignette | `PI/3.6` |
| logo | bare lockup, bottom centre, vertical centre at y=1670 |

```bash
python3 scripts/make_logo_lockup.py logo.png --style bare --mark-height 104 --wordmark-width 300 --gap 20
python3 scripts/make_frame_plate.py plate.png --shape oval --rx 480 --ry 660 --cy 830 --logo logo.png --logo-y 1670
```

The source window is 1080x1485 rather than a square because the oval is taller than wide -
that keeps 77% of the source height instead of 56%. **Each shot needs its own vertical
offset** (`scripts/face_track.py --mode offsets --crop-h 1485`); one global offset cuts
tops of heads off.

Two useful properties: the flat cream ground compresses almost for free, so every
deliverable comes out roughly half the size of the equivalent full-bleed version; and the
logo sits on a ground you control, so it needs no scrim.

## full-bleed

Footage fills the frame; watermark sits over it. Better when the footage itself is strong
edge to edge, or when the destination crops unpredictably.

**Canvas** 1080x1920 (9:16)

| | |
|---|---|
| source | no crop, `scale=1080:1920` |
| vignette | `PI/5.2` |
| logo | scrim lockup at 92%, top left, 38px margin |

```bash
python3 scripts/make_logo_lockup.py logo.png --style scrim --mark-height 92 --wordmark-width 256
```

Top left, not bottom right: TikTok, Reels and Shorts all put their action rail and caption
block over the bottom-right corner.

The scrim is not decoration. A bare logo at 78% over this footage vanishes against a dark
picture frame on the wall - Deep Slate on dark navy is nearly zero contrast. Over
unpredictable backgrounds the cream pill is what keeps the mark legible.

## Adding a preset

Record every number needed to rebuild it: canvas, geometry, source window, vignette, logo
style/size/position/opacity, and the ground colour. Then say what the preset is *for* -
which footage it suits and which it does not - because that is what makes it possible to
choose between presets later.

Likely next ones:

- **square** (1080x1080) for feed posts - the oval geometry needs re-deriving, not just
  re-cropping, since the canvas aspect changes.
- **landscape** (1920x1080) for YouTube - portrait source footage will need either
  pillarboxing on a brand ground or a much tighter crop.
- **stinger-topped** - the existing 2.6s logo reveal at
  `Marketing/Video/stinger-v1/` prepended or appended. Note its README: that build of
  ffmpeg silently drops VP8/VP9 alpha, so use the `_alpha.mov` rather than a webm.
