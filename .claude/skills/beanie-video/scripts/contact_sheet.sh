#!/usr/bin/env bash
# Tile a clip into a single image so you can SEE it before deciding where to cut.
#
# You cannot pick shots from filenames and durations. Every good cut in a beanies
# video came from looking at a sheet, spotting the exact half-second where a kid's
# face turns to camera, then zooming in on that window at a higher sample rate.
#
# Workflow: coarse sheet over the whole clip (2fps) to find the moment, then a
# tight sheet over a 2-4s window (6-8fps) to pick frame-accurate in/out points.
#
# Usage: contact_sheet.sh <clip> <out.jpg> [fps] [cols] [rows] [start] [duration]
set -euo pipefail
CLIP="$1"; OUT="$2"; FPS="${3:-2}"; COLS="${4:-5}"; ROWS="${5:-5}"; START="${6:-}"; DUR="${7:-}"
SS=(); [ -n "$START" ] && SS=(-ss "$START")
TT=(); [ -n "$DUR" ]   && TT=(-t  "$DUR")
ffmpeg -v error -y "${SS[@]}" -i "$CLIP" "${TT[@]}" \
  -vf "fps=$FPS,scale=300:-1,tile=${COLS}x${ROWS}" -frames:v 1 "$OUT"
echo "$OUT  (${COLS}x${ROWS} tiles @ ${FPS}fps, starting ${START:-0}s)"
echo "tile n (1-indexed, reading left-to-right) is at t = ${START:-0} + (n-1)/$FPS seconds"
