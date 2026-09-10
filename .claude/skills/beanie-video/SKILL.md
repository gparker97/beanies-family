---
name: beanie-video
description: >-
  Cut, brand and deliver beanies.family videos, GIFs and looping clips from raw family
  footage. Use this WHENEVER greg wants to make, edit, cut, assemble, brand or resize a
  video, clip, reel, loop, montage, GIF or animation from footage he has shot - phrases
  like "make a video from these clips", "can you cut together something short", "turn
  this into a gif", "make a loop of the kids using the app", "add the logo to this
  video", "make this fit Substack / TikTok / Reels / Shorts", "compress this video",
  "the gif is too big", or "grab the good bits out of these clips". Also use it when he
  asks to re-cut, retime, re-grade, re-frame or re-export an existing beanies video, or
  to add slow motion, a push-in, a photo-frame treatment or a watermark. Trigger even if
  he never says "video" - a request to do something with clips, footage, raw videos, or
  anything in Marketing/Video IS this skill. Covers shot selection, the ffmpeg craft,
  the branded look presets, and getting under platform file-size caps without wrecking
  the picture.
---

# beanie-video

Turning raw family footage into something on-brand and finished. The hard parts are not
the ffmpeg incantations - they are picking the right two seconds out of ninety, framing
each shot so nobody's head is cut off, and getting under a file-size cap without paying
for it out of the faces.

## Where things live

- **Raw footage**: `~/gdrive-gparker97/Projects/beanies.family/Marketing/Video/Raw Videos/`
- **Everything else**: its own folder at
  `~/gdrive-gparker97/Projects/beanies.family/Marketing/Video/<project-slug>/`

  One folder per project, and that includes tests, experiments and review copies - not
  only finished work. Never leave a loose file at the `Video/` root. A video project is
  never a single file: it is a master, a web export, a GIF or WebP, the build script and
  a README, and those only make sense kept together. Name the folder for the piece
  (`celebration-loop-v3`), and start a new one rather than overwriting when a version
  changes enough to be worth comparing against.
- **Never the repo.** Rendered video is a file artefact, not code. It goes to Drive
  (see the Google Drive rule in `CLAUDE.md`). This skill and its scripts are the only
  part that belongs in git.

**Verify the mount before reading or writing**, with `findmnt /home/greg/gdrive-gparker97`
and not with `ls`. When rclone is not running, that path is an ordinary empty local
directory: writes appear to succeed and never reach Drive.

## The workflow

### 1. Probe the clips

```bash
scripts/probe_clips.sh "<raw videos dir>"
```

Phone footage lies about its frame rate: a clip can report `r_frame_rate` of 120/1 while
carrying 30fps of frames. Every trim time you write is wrong if you trust that number.
The script computes the real rate and shouts when they disagree. It also reminds you that
ffmpeg auto-rotates on decode, so a stream listed as 1920x1080 gives you 1080x1920 frames
- and all your crop maths must use the decoded size.

### 2. Look at the footage

You cannot pick shots from filenames. Build contact sheets:

```bash
scripts/contact_sheet.sh CLIP sheet.jpg 2 5 5            # coarse pass over a whole clip
scripts/contact_sheet.sh CLIP zoom.jpg 6 6 4 4.5 4       # tight pass on a 4s window
```

Read the sheet, find the moment, then re-sheet that window at 6-8fps to pick
frame-accurate in/out points. Two passes is almost always enough.

Look for beats, not clips. A usable beat is a second or less: a tap landing, a face
turning to camera, an arm going up. Most of a two-minute clip is a child concentrating,
which is worth nothing on screen.

### 3. Propose a shot list before building

Write it out - source, in, out, speed, what the beat is - and show it. This is the cheap
moment to disagree about the edit, before anything is rendered. Structure it as a story:

- **Open on the doing**, not the celebrating. A tap, a hand on the screen. It gives the
  celebration something to be about.
- **Show the app doing its part.** A push-in on the screen where the confetti fires is
  what makes it a product video rather than a home video.
- **Escalate.** Small gesture, bigger gesture, biggest reaction.
- **End on the strongest face and start on something quiet.** For a loop, the energy drop
  between the last frame and the first IS the seam - no crossfade needed.
- **Hard cuts.** Crossfades make a short montage feel hesitant.

Length: 5-8s for a loop. Every shot earns its place; if a beat is only there because a
particular kid should feature, keep it but cut it short.

### 4. Frame each shot

Any preset that is not full-bleed crops a window out of each source frame, so each shot
needs its own vertical offset. One global offset guillotines heads in the shots where the
subject stands high in frame.

```bash
scripts/face_track.py cut.mp4 --mode offsets --crop-h 1485 \
  --shots "a-tap:0:0.75,b-push:0.75:1.72,c-laugh:1.72:2.9"
```

It reports where faces actually sit and suggests an offset per shot, and flags the ones
you should not trust: a face that is tiny relative to the others is a sibling in the
background or a face drawn on a screen, not the subject. Override those by eye - for a
tablet close-up, centre the screen; for a raised arm, keep the arm in frame.

### 5. Build

Write a `build.sh` that renders from the raw sources in one ffmpeg invocation, so any beat
can be retimed by changing one number and re-running. Read `references/ffmpeg-craft.md`
before writing the filter graph - it has the retiming, push-in and concat recipes plus
the version traps that will silently produce a wrong-length or warped video.

Pick a look from `references/presets.md`.

### 6. Verify

```bash
scripts/verify_output.py out.mp4 out.gif out.webp --frames-out /tmp/check
```

Durations should match the master across every deliverable, the loop flag should be set,
and the last frame should be the beat you meant to end on. Then actually look at a contact
sheet of the finished cut.

This step is not ceremony. Every ffmpeg trap in `references/ffmpeg-craft.md` produces a
valid file and a zero exit code - a segment stuffed to the wrong length, a fade that
paints a later shot flat, a watermark frozen invisible. None of them announce themselves.
Looking at frames is the only thing that catches them.

### 7. Deliver

Formats and size budgets are in `references/delivery.md`. When a GIF has to fit a cap,
`scripts/make_gif.py --max-bytes` gives things up in the order that costs the picture
least: grain, then frame rate, then width, and never colour depth. Write a `README.md` next to the
files with the shot list (source, in, out, speed, crop offset), the look settings, and any
decision that cost you time to reach. The next person to touch this is you in three months
with none of the context.

## Shot selection: what makes a beat usable

- **A face turning to camera beats any amount of action from behind.** Back-of-head shots
  read as filler even when the gesture is clear.
- **Motion blur is fine. Confusion is not.** A blurry face mid-laugh works. A frame where
  you cannot tell what you are looking at does not, however sharp it is.
- **Keep a weak beat short.** If a shot has to be in the video for reasons beyond its
  quality, half a second reads as pace. Two seconds reads as a mistake.
- **The tablet screen is a character.** Beats where the app visibly responds - confetti,
  a modal, a list completing - are the ones that make this marketing rather than a family
  album, and they usually need a push-in to be legible.

## Slow motion

Slow the celebrations, leave the taps at full speed. 0.68x-0.75x reads clearly as slow
motion while staying judder-free with plain frame duplication.

**Do not reach for motion interpolation.** `minterpolate=mi_mode=mci` looks better on most
frames and then catastrophically smears a face on the fastest ones - and because it fails
intermittently, it survives spot-checks and ships broken. If you ever do try it, check the
single fastest-moving frame of every slowed shot before believing it.

## Colour

The house grade, applied once after the concat so it is consistent across shots:

```
eq=contrast=1.07:saturation=1.24:gamma=1.02,
curves=r='0/0.02 0.25/0.265 0.75/0.795 1/0.985':g='0/0.015 0.5/0.5 1/0.982':b='0/0.042 0.25/0.238 0.75/0.735 1/0.962',
unsharp=5:5:0.5:5:5:0.0,
vignette=PI/5.2
```

Warm highlights, slightly cool shadows, gentle contrast. Vignette goes to `PI/3.6` inside
a framed preset, where the edges are meant to fall away into the mount.

Raw phone footage is flat and reads as unfinished; this is a light touch, not a look.

## Branding

Build the watermark with `scripts/make_logo_lockup.py`. Placement follows from what is
behind it, and getting this wrong is the most common way a video looks amateur:

- **On a flat brand ground** (the cream area of a framed preset): `--style bare`, bottom
  centre. Nothing behind it, so it needs no help.
- **Over live footage**: `--style scrim`, top left. Two reasons. Bottom-right is where
  TikTok, Reels and Shorts put the action rail and caption block, so a watermark there gets
  covered. And a bare logo over unpredictable footage disappears - Deep Slate on a dark
  background has almost no contrast - so it needs the cream pill behind it.

The beanies hold hands and the arrow is never rotated. Brand rules live in
`.claude/skills/beanies-theme/SKILL.md`; this skill does not restate them.

## Covering faces with a beanie

`scripts/face_track.py --mode overlay` tracks faces and composites a beanie over them.

**Only do this when asked.** The shots worth covering are the shots the edit is built
around, so covering them removes most of what makes the video work. It is the right call
when footage is going somewhere public and the kids' faces should not - and that is greg's
decision to make, not a default to apply.

## Reference files

- `references/ffmpeg-craft.md` - filter-graph recipes and the version traps. **Read this
  before writing any filter graph**; two of the traps produce a silently wrong result.
- `references/presets.md` - the named looks with exact numbers, and how to add one.
- `references/delivery.md` - output formats, platform specs, and fitting size caps.

## Scripts

| script | what it is for |
|---|---|
| `probe_clips.sh` | real frame rates, durations, rotation warnings |
| `contact_sheet.sh` | tile a clip so you can see it and pick cut points |
| `face_track.py` | per-shot crop offsets (`--mode offsets`); beanie-over-faces (`--mode overlay`) |
| `make_logo_lockup.py` | watermark lockup, bare or on a scrim |
| `make_frame_plate.py` | oval/circle framing plate with a feathered hole |
| `make_gif.py` | GIF, with a byte-budget search that gives up the right things first |
| `make_webp.py` | animated WebP with correct frame durations |
| `verify_output.py` | frames, durations, loop flags, first/last frame dumps |

Python scripts need `pillow`, `numpy`, and for `face_track.py`,
`opencv-python-headless<5` (OpenCV 5 removed the APIs it uses). Install with
`pip3 install --user "opencv-python-headless<5" pillow numpy`.

## Extending this

This is a technical foundation with one worked look, not a finished brand video system.
As the guidelines firm up, the things most likely to want adding are: named presets for
square and landscape delivery, an opening/closing stinger (there is one at
`Marketing/Video/stinger-v1/`), text/caption treatments, and music. Keep new looks as
presets in `references/presets.md` with their numbers written down, so a video can be
rebuilt months later and match.
