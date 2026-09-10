# Delivery

What to export, what each format is for, and how to fit a size cap without paying for it
out of the picture.

## Contents

- [The standard set](#the-standard-set)
- [Format choice](#format-choice)
- [Fitting a size cap](#fitting-a-size-cap)
- [Platform notes](#platform-notes)
- [The README that ships with it](#the-readme-that-ships-with-it)

## The standard set

Into `~/gdrive-gparker97/Projects/beanies.family/Marketing/Video/<project-slug>/`:

| file | what it is |
|---|---|
| `<slug>_1080x1920.mp4` | master, `-crf 17 -preset slow` |
| `<slug>_1080x1920_web.mp4` | for posting, `-crf 23` |
| `<slug>_<w>x<h>.webp` | animated WebP, ~20fps |
| `<slug>_<w>x<h>.gif` | only where video will not play |
| `build.sh` | the ffmpeg build, so it can be rebuilt or retimed |
| `README.md` | shot list, look settings, decisions |

Plus the plate and lockup PNGs if a framed preset was used, so the look is reproducible
without regenerating it.

Always `-movflags +faststart` on mp4s - without it a browser has to download the whole
file before the first frame.

## Format choice

**mp4 first.** It is smaller and better-looking than any GIF and plays essentially
everywhere. Reach for something else only when the destination genuinely cannot play video.

**WebP over GIF** wherever it is accepted: roughly half the bytes at a higher resolution
and frame rate, because it does real inter-frame compression while GIF has a 256-colour
palette and transparency tricks.

**GIF only for email**, which is the one context that genuinely cannot play video. Expect
it to be the largest file you ship.

A caveat worth passing on: animated WebP support is patchy *outside* browsers. Google
Drive's preview, Windows Photos and macOS Quick Look all handle it badly and may show a
still or appear to stop partway. That is a viewer problem, not a file problem - verify
with `scripts/verify_output.py` and check in a browser before re-encoding anything.

## Fitting a size cap

```bash
python3 scripts/make_gif.py in.mp4 out.gif --max-bytes 5000000 --width 480
```

Handheld footage is expensive in GIF: the camera moves, so nearly every pixel changes
every frame and there is little for the format to reuse. You will have to give something
up. The order matters, and it came from measuring:

1. **Grain.** A light `hqdn3d` denoise pre-pass buys ~20%. Sensor noise on handheld indoor
   footage changes every pixel every frame, which is exactly what defeats GIF's
   frame-differencing - so removing it makes the format work better rather than just
   asking it to do less. Keep it light; pushed hard it plasticises faces.
2. **Frame rate.** Cheap. 12.5 -> 12 fps is imperceptible here. Below about 10 it reads as
   a flipbook, and fast beats strobe before slow ones do.
3. **Width.** Predictable, costs detail evenly.
4. **Colour depth - last resort.** 128 -> 96 colours saves less than one width step and
   blotches skin tones green and pink. Faces are where a viewer looks. Do not pay for file
   size out of the faces.

**Dither is a size lever, not only a quality one.** Error diffusion (`sierra2_4a`) looks
slightly nicer per frame and re-randomises pixels every frame, which destroys inter-frame
compression - on this footage it produced 11.6 MB against 6.9 MB for no dither. Default to
`dither=none`; if you want dithering, ordered Bayer keeps a static pattern and still
compresses.

The script follows that order, jumps to a size estimate rather than stepping down from the
top, and keeps 4% headroom by default so a re-encode elsewhere still fits.

**Not offered, deliberately:** ImageMagick's lossy `-fuzz` frame optimisation. It reaches a
much smaller file at full width, which is tempting, but it works by leaving near-matching
pixels un-updated between frames. Free on a flat background; on a face it shows as blotches
crawling around during playback. `gifsicle` would do a better job than ImageMagick if it is
ever available - worth revisiting then.

## Platform notes

| destination | notes |
|---|---|
| Substack email | GIF, 5 MB cap. Use `--max-bytes 5000000`. |
| Substack web | mp4 - renders uploaded video, and looks far better than the email GIF. |
| TikTok / Reels / Shorts | 9:16 mp4. Keep the watermark out of the bottom-right corner. |
| Instagram feed | 1:1 or 4:5; needs a square preset, not a centre-crop of the 9:16. |
| Marketing site | WebP or mp4. Never a GIF - it is the worst option on every axis here. |

## The README that ships with it

Write a `README.md` beside the files. Include:

- **The shot list** - source clip, in, out, speed, crop offset, and one line on what the
  beat is. This is what makes a re-cut cheap.
- **The look** - preset name and any deviation from its numbers.
- **Decisions that cost time.** Why a shot is framed where it is, what was tried and
  rejected, which knobs are safe to turn. This is the part that pays for itself: without
  it the next person re-derives it, and the next person is usually you.
