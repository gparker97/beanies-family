# Promo soundtrack

`track.mp3` is the promo bed, mounted by `<Audio>` in `Promo.tsx`. Its level is a
pure function of frame — see `promo/audio.ts`.

## What is committed here

Derived from greg's `beanies intro demo.mp3` (2026-07-10): trimmed to the first 37s,
embedded cover art stripped, re-encoded to 160 kbps / 48 kHz stereo (3.5 MB → 724 KB).

**The source track is a flat bed.** Its RMS sits between −15.2 and −16.4 dB end to end,
with no build anywhere. The outro swell is therefore synthesised in the volume curve,
not taken from the arrangement — which is why it lands exactly on the outro pill and the
celebrating beanies rather than wherever the music happened to peak.

## If the track is ever replaced

| Requirement    | Value                                                                       |
| -------------- | --------------------------------------------------------------------------- |
| Path           | `promo/audio/track.mp3` (imported, not `staticFile`d — see `Promo.tsx`)      |
| Format         | mp3. Strip cover art (`-vn`), or ffmpeg muxing gets confused                 |
| Length         | **≥ 36s.** The cut is 35.95s. Shorter means a loop seam or dead air          |
| Tone           | warm, unhurried, acoustic. Not corporate-uplift, not a hard EDM build        |
| Swell          | not required — `audio.ts` supplies the outro lift regardless                 |

## Timing map (for picking a track that fits the cut)

At 30fps, from `Promo.tsx`:

| Beat              | Starts  | Ends    |
| ----------------- | ------- | ------- |
| Intro             | 0.0s    | 3.6s    |
| Scenes 1–6        | 2.7s    | 30.9s   |
| Outro             | 30.9s   | 35.95s  |
| Outro pill lands  | ~32.4s  |         |
| Celebrating beans | ~32.9s  |         |

Treatment (greg's call, 2026-07-10): **full level from the very first frame**, then a
**gentle fall over the last 2.5s to a floor, never to silence.** Fading up at the start
made the music sound like it wandered in late; fading out to zero at the end draws
attention to the mix when the last thing the viewer should notice is the beanies.
Implemented as `volume={(frame) => musicVolume(...)}` on `<Audio>`; Remotion muxes it
into the H.264 render, no ffmpeg step. Measured on the rendered mp4: audible from 0s,
≈ −22 dB bed, easing to ≈ −25.7 dB by the final frame.

## Licensing — read before choosing

The Play Store promo slot is a **YouTube URL**, so the track has to survive YouTube's
Content ID. An unlicensed or improperly-cleared track gets the video muted, claimed, or
region-blocked — attached to the store listing, on a listing users see.

- Keep the licence receipt / clearance certificate outside the repo (Notion).
- Note the source and licence in the wiring commit message.
- Free-tier libraries (e.g. Uppbeat) usually require an attribution credit. If the track
  needs credit, it goes in the YouTube description, not on-screen.
