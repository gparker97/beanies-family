# ffmpeg craft for beanies videos

Recipes and traps. The traps matter more than the recipes: two of them produce a
plausible-looking file that is silently wrong, which is far worse than an error.

These traps share a shape worth internalising: **none of them return a non-zero exit
code.** ffmpeg reports success and writes a valid file that is wrong. The only defence is
to pull frames out of the result and look at them - which is why the workflow has a verify
step and a contact sheet of the finished cut, not just a duration check.

## Contents

- [Traps that produce a silently wrong result](#traps-that-produce-a-silently-wrong-result)
- [The segment chain](#the-segment-chain)
- [Retiming (slow motion)](#retiming-slow-motion)
- [Push-ins](#push-ins)
- [Concat and grade](#concat-and-grade)
- [Framing plate composite](#framing-plate-composite)
- [Watermark overlay](#watermark-overlay)
- [Full worked build](#full-worked-build)

## Traps that produce a silently wrong result

### `fps` must come before `setpts`, not after

On ffmpeg 4.2, `trim,setpts=PTS-STARTPTS,fps=30` stuffs the segment back out to the full
source length. A 0.75s trim becomes 5.45s of frames and your 5s montage renders as 42s.

```
WRONG:  [0:v]trim=start=4.70:end=5.45,setpts=PTS-STARTPTS,fps=30,scale=1080:1920[a]
RIGHT:  [0:v]trim=start=4.70:end=5.45,fps=30,setpts=PTS-STARTPTS,scale=1080:1920[a]
```

There is no warning. Check the output duration against the sum of your segment lengths
after every build.

### Animated `scale` breaks the filter graph

`scale=w='1080*Z(t)':h='1920*Z(t)':eval=frame` produces a variable-size stream and ffmpeg
fails with `Error reinitializing filters! Failed to inject frame into filter network`.
Use `zoompan` for anything that changes zoom over time - it takes a fixed output size.

### Motion interpolation warps faces intermittently

`minterpolate=mi_mode=mci` gives smoother slow motion than frame duplication on most
frames, then smears a face into abstraction on the fastest ones. Because it fails on a
handful of frames it passes any spot-check and ships broken. Use gentle ratios
(0.68x-0.75x) with plain frame duplication instead.

### `fade=t=out` keeps painting after it finishes

A fade-out does not stop at the end of its `st`+`d` window - it holds its target colour
for the rest of the stream. Put a global fade-to-white before a later segment and that
segment renders flat white, with no error and a perfectly valid file. Apply a fade inside
the segment it belongs to, not to the concatenated stream.

### A still image input is one frame at pts 0

`-i logo.png` decodes as a single frame timestamped 0. Any expression keyed on time - an
alpha fade with `st=0.5`, an enable window - sees only that one timestamp, so the overlay
either freezes at its starting value or never appears. Use `-loop 1 -i logo.png` when the
overlay needs to animate or persist across a timeline.

### Pillow lies about WebP frame durations

`im.info["duration"]` reads 0 for every frame of an animated WebP even when the container
is correct. Do not conclude a file is broken from that number - parse the ANMF chunks
(`scripts/verify_output.py` does).

## The segment chain

Every shot goes through the same shape:

```
[<input>:v]trim=start=<in>:end=<out>,fps=30,setpts=(PTS-STARTPTS)/<speed>,
           crop=<cw>:<ch>:0:<offset>,scale=<bw>:<bh>,setsar=1[<label>];
```

- `fps=30` normalises sources shot at different rates. It goes **before** `setpts`.
- `setpts=PTS-STARTPTS` for full speed; `(PTS-STARTPTS)/0.70` for 70% speed.
- `crop` takes the per-shot window; omit for full-bleed.
- `setsar=1` prevents an aspect mismatch from stopping `concat`.

Screen time for a segment is `(out - in) / speed`.

## Retiming (slow motion)

`setpts=(PTS-STARTPTS)/0.70` plays at 70% speed. Frames are duplicated at encode time by
`-r 30`; ffmpeg reports this as `dup=N` which is expected, not a warning.

Below about 0.6x the judder becomes visible, because the underlying unique-frame rate
drops to `30 x speed`. 0.68-0.75 is the usable band for handheld footage: clearly slow
motion, still smooth.

## Push-ins

`zoompan` with a fixed output size. The zoom expression uses `on` (output frame number):

```bash
U="min(on/28,1)"                                    # 28 = segment frames - 1
Z="(1+0.9*(3*pow($U,2)-2*pow($U,3)))"               # smoothstep 1.0 -> 1.9
PUSH="zoompan=z='$Z':x='clip(CX-IW/(2*$Z),0,iw-iw/$Z)':y='clip(CY-IH/(2*$Z),0,ih-ih/$Z)':d=1:s=WxH:fps=30"
```

`CX,CY` is the point to zoom about and `IW,IH` are the dimensions of the frame reaching
zoompan. **If you crop before the push-in, those coordinates are in the cropped frame** -
a target at y=955 in the source becomes y=955-218=737 after `crop=1080:1485:0:218`. This
is the easiest thing to get wrong and it shows up as a push-in drifting off its subject.

The smoothstep (`3u²-2u³`) eases in and out. A linear ramp reads mechanical.

Check whether the camera drifts across the shot before anchoring: over ~1s of handheld
footage the drift is often ~20px, small enough that a fixed anchor beats tracking.

## Concat and grade

```
[a][b][c][d]concat=n=4:v=1:a=0[cat];
[cat]eq=contrast=1.07:saturation=1.24:gamma=1.02,
     curves=r='...':g='...':b='...',
     unsharp=5:5:0.5:5:5:0.0,
     vignette=PI/5.2,format=yuv420p[out]
```

Grade **after** the concat, once. Grading per-segment means every future tweak has to be
applied N times and any drift between them shows as a jump at the cut.

`concat` needs matching dimensions and SAR on every input.

## Framing plate composite

Generate the plate with `scripts/make_frame_plate.py` - it prints the exact
`scale`/`pad` line for its geometry. Then:

```
...,vignette=PI/3.6,pad=1080:1920:60:170:color=0xF8F9FA[framed];
[framed][<plate>:v]overlay=0:0:format=auto,format=yuv420p[out]
```

Video underneath, plate on top. The plate is opaque everywhere except its feathered hole,
so it hides everything outside the frame and the video only has to cover the hole.

## Watermark overlay

```
[<logo>:v]format=rgba,colorchannelmixer=aa=0.92[lg];
[0:v][lg]overlay=x=38:y=38:format=auto,format=yuv420p[out]
```

`colorchannelmixer=aa=` sets opacity. 0.92 for a scrim lockup, 0.78 for a bare one over
footage, 1.0 for a bare one on a flat brand ground.

If the watermark needs to fade or appear only over part of the timeline, the PNG input
needs `-loop 1` - see the still-image trap above.

Bottom centre: `x=(main_w-overlay_w)/2:y=main_h-overlay_h-<margin>`.

## Full worked build

The v3 celebration loop, trimmed to three shots for readability:

```bash
#!/usr/bin/env bash
set -e
S="$1"; cd "$S/src"
BW=960; BH=1320; CW=1080; CH=1485      # oval video box, and the source window

U="min(on/28,1)"
Z="(1+0.9*(3*pow($U,2)-2*pow($U,3)))"
PUSH="zoompan=z='$Z':x='clip(640-1080/(2*$Z),0,iw-iw/$Z)':y='clip(737-1485/(2*$Z),0,ih-ih/$Z)':d=1:s=${BW}x${BH}:fps=30"

FC=""
FC="${FC}[0:v]trim=start=4.70:end=5.45,fps=30,setpts=PTS-STARTPTS,crop=${CW}:${CH}:0:285,scale=${BW}:${BH},setsar=1[a];"
FC="${FC}[2:v]trim=start=8.62:end=9.58,fps=30,setpts=PTS-STARTPTS,crop=${CW}:${CH}:0:218,${PUSH},setsar=1[b];"
FC="${FC}[1:v]trim=start=1.90:end=2.72,fps=30,setpts=(PTS-STARTPTS)/0.70,crop=${CW}:${CH}:0:0,scale=${BW}:${BH},setsar=1[c];"
FC="${FC}[a][b][c]concat=n=3:v=1:a=0[cat];"
FC="${FC}[cat]eq=contrast=1.07:saturation=1.24:gamma=1.02,"
FC="${FC}curves=r='0/0.02 0.25/0.265 0.75/0.795 1/0.985':g='0/0.015 0.5/0.5 1/0.982':b='0/0.042 0.25/0.238 0.75/0.735 1/0.962',"
FC="${FC}unsharp=5:5:0.5:5:5:0.0,vignette=PI/3.6,"
FC="${FC}pad=1080:1920:60:170:color=0xF8F9FA[framed];"
FC="${FC}[framed][4:v]overlay=0:0:format=auto,format=yuv420p[out]"

ffmpeg -v error -stats -y -i CLIP_A.mp4 -i CLIP_B.mp4 -i CLIP_C.mp4 -i CLIP_D.mp4 -i "$S/frame_plate.png" \
  -filter_complex "$FC" -map "[out]" \
  -c:v libx264 -profile:v high -crf 17 -preset slow -pix_fmt yuv420p \
  -movflags +faststart -r 30 -an "$S/out/cut.mp4"
```

Keeping the whole build in one script means retiming a beat is a one-line edit and a
re-run, which is what makes review cycles cheap.
