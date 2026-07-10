#!/usr/bin/env bash
#
# Composite the raw promo capture into a store-ready 1920x1080 H.264 file.
#
#   bash scripts/promo-video/compose.sh
#
# Input : scripts/promo-video/.out/raw.webm + beats.json   (from `record.ts`)
# Output: scripts/promo-video/.out/promo-1080p.mp4
#
# What it does:
#   1. Trims the off-camera setup (login bypass + seeding) using `trimStartMs`
#      from beats.json, so the take opens on the nook.
#   2. Centres the phone capture on a Cloud White (#F8F9FA) 1920x1080 canvas.
#   3. Encodes H.264 / yuv420p / faststart — what stores and browsers want.
#
# Optional: drop a transparent PNG phone bezel at scripts/promo-video/frame.png
# (1920x1080, with the screen area cut out) and it is overlaid automatically.
# Without it you get a clean, unframed centred composition.
#
# The beat marks in beats.json are relative to VIDEO start; after trimming,
# subtract trimStartMs to get their position in the composed file. They are the
# cut points for whatever narrative greg writes on top.
set -euo pipefail

OUT="scripts/promo-video/.out"
RAW="$OUT/raw.webm"
BEATS="$OUT/beats.json"
FRAME="scripts/promo-video/frame.png"
DEST="$OUT/promo-1080p.mp4"

CANVAS_W=1920
CANVAS_H=1080
MAX_PHONE_H=960 # leaves a 60px margin top/bottom on the canvas

[ -f "$RAW" ] || { echo "error: $RAW not found — run the recorder first:"; echo "  npx playwright test -c playwright.video.config.ts"; exit 1; }
[ -f "$BEATS" ] || { echo "error: $BEATS not found"; exit 1; }
command -v ffmpeg >/dev/null || { echo "error: ffmpeg not installed"; exit 1; }

# Seconds to trim off the front (the setup that happens off-camera).
TRIM_S=$(node -p "(require('./$BEATS').trimStartMs / 1000).toFixed(3)")
echo "trimming ${TRIM_S}s of setup off the front"

# Never upscale. Playwright clamps its video to ~392x726 no matter what
# `video.size` / `deviceScaleFactor` say (verified 2026-07-10), so blowing the
# phone up to fill the canvas just yields a soft image. Composite at the source's
# native height, capped so it still fits the canvas.
SRC_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$RAW")
PHONE_H=$(( SRC_H < MAX_PHONE_H ? SRC_H : MAX_PHONE_H ))
[ "$PHONE_H" -lt "$MAX_PHONE_H" ] \
  && echo "phone height ${PHONE_H}px (native — not upscaling a ${SRC_H}px source)" \
  || echo "phone height ${PHONE_H}px (capped to canvas)"

if [ -f "$FRAME" ]; then
  echo "using phone bezel: $FRAME"
  ffmpeg -y -loglevel warning -stats \
    -ss "$TRIM_S" -i "$RAW" \
    -f lavfi -i "color=c=0xF8F9FA:s=${CANVAS_W}x${CANVAS_H}:r=30" \
    -i "$FRAME" \
    -filter_complex "\
      [0:v]scale=-2:${PHONE_H},setsar=1[phone];\
      [1:v][phone]overlay=(W-w)/2:(H-h)/2:shortest=1[body];\
      [body][2:v]overlay=0:0,format=yuv420p[out]" \
    -map "[out]" -an \
    -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart \
    "$DEST"
else
  echo "no $FRAME — composing unframed (drop a transparent 1920x1080 bezel there to add one)"
  ffmpeg -y -loglevel warning -stats \
    -ss "$TRIM_S" -i "$RAW" \
    -f lavfi -i "color=c=0xF8F9FA:s=${CANVAS_W}x${CANVAS_H}:r=30" \
    -filter_complex "\
      [0:v]scale=-2:${PHONE_H},setsar=1[phone];\
      [1:v][phone]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[out]" \
    -map "[out]" -an \
    -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -movflags +faststart \
    "$DEST"
fi

echo
echo "composed: $DEST"
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,codec_name \
  -of default=noprint_wrappers=1 "$DEST"
echo
echo "beat marks, relative to the composed file:"
node -e "
  const b = require('./$BEATS');
  for (const x of b.beats) {
    const s = (x.atMs - b.trimStartMs) / 1000;
    console.log('  ' + x.name.padEnd(14) + (s < 0 ? '(setup)' : s.toFixed(2) + 's'));
  }
"
