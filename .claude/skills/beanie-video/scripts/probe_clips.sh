#!/usr/bin/env bash
# Probe a folder (or list) of clips for the facts that actually change how you cut them.
#
# The one that bites: r_frame_rate lies on phone footage. A clip shot in slo-mo can
# report 120/1 while carrying 30fps worth of frames. avg_frame_rate (nb_frames/duration)
# is the truth. Get this wrong and every trim time in your shot list is off.
#
# Usage: probe_clips.sh <dir-or-file> [more files...]
set -euo pipefail

probe_one() {
  local f="$1"
  local w h dur nbf r avg codec
  w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$f")
  h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$f")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  nbf=$(ffprobe -v error -select_streams v:0 -show_entries stream=nb_frames -of csv=p=0 "$f")
  r=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$f")
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f")
  avg=$(awk -v n="${nbf:-0}" -v d="${dur:-1}" 'BEGIN{ if (d>0) printf "%.2f", n/d; else print "?" }')
  local flag=""
  awk -v a="$avg" -v rr="$r" 'BEGIN{split(rr,p,"/"); r=(p[2]?p[1]/p[2]:p[1]); exit !(r > a*1.5)}' \
    && flag="  <-- r_frame_rate ($r) DISAGREES with real rate; trust ${avg}fps"
  printf "%-46s %sx%-5s %6.2fs  %5s frames  real %sfps  [%s]%s\n" \
    "$(basename "$f")" "$w" "$h" "${dur:-0}" "${nbf:-?}" "$avg" "$codec" "$flag"
}

for target in "$@"; do
  if [ -d "$target" ]; then
    while IFS= read -r f; do probe_one "$f"; done \
      < <(find "$target" -maxdepth 1 -type f \( -iname '*.mp4' -o -iname '*.mov' -o -iname '*.m4v' \) | sort)
  else
    probe_one "$target"
  fi
done

cat <<'NOTE'

Reminder: ffmpeg auto-rotates on decode, so a 1920x1080 stream with a rotation matrix
decodes as 1080x1920. Confirm with one extracted frame before doing any crop maths:
  ffmpeg -ss 1 -i CLIP -frames:v 1 /tmp/f.png && python3 -c "from PIL import Image;print(Image.open('/tmp/f.png').size)"
NOTE
