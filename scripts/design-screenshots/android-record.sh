#!/usr/bin/env bash
# Clean Android screen recording for marketing/blog use.
#
# Why not the built-in Quick Settings recorder: it bakes a 3-2-1 countdown, a red
# recording dot and a "tap to stop" chip into the video. `adb shell screenrecord`
# captures the screen and nothing else.
#
# The status bar is the other thing that ruins a marketing capture — a carrier name,
# 41% battery, a Slack notification sliding in mid-take. Android's built-in demo mode
# fixes it to a full battery, full signal and a clock you choose, which is exactly what
# every app-store screenshot you have ever seen is using.
#
#   ./scripts/design-screenshots/android-record.sh start   # clean bar + show taps, then record
#   ./scripts/design-screenshots/android-record.sh stop    # restore the phone to normal
#
# Limits worth knowing: screenrecord caps at 3 minutes, stops if the device rotates,
# and records no audio. All fine for a share-flow demo.
set -euo pipefail

CLOCK="${CLOCK:-0900}"
OUT="${OUT:-share-to-recipe-raw.mp4}"
DEV="/sdcard/beanies-capture.mp4"

need_device() {
  if ! adb get-state >/dev/null 2>&1; then
    echo "No device. Plug the phone in, unlock it, and accept the USB-debugging prompt." >&2
    exit 1
  fi
}

demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }

case "${1:-start}" in
  start)
    need_device

    # A clean status bar.
    adb shell settings put global sysui_demo_allowed 1
    demo enter
    demo clock -e hhmm "$CLOCK"
    demo battery -e level 100 -e plugged false
    demo network -e wifi show -e level 4
    demo network -e mobile show -e datatype none -e level 4
    demo notifications -e visible false

    # Show taps. Without this the viewer cannot see the finger land on the share
    # target, which is the single most important beat in a share-flow demo — the
    # video otherwise looks like the app opened by itself.
    adb shell settings put system show_touches 1

    echo "Phone is camera-ready. Recording — perform the flow, then press Ctrl-C."
    trap 'echo; echo "Pulling…"; sleep 2; adb pull "$DEV" "$OUT" >/dev/null && echo "Saved $OUT"' INT
    adb shell screenrecord --bit-rate 12000000 "$DEV" || true
    ;;

  stop)
    need_device
    demo exit
    adb shell settings put system show_touches 0
    adb shell settings put global sysui_demo_allowed 0
    adb shell rm -f "$DEV" || true
    echo "Phone restored."
    ;;

  *)
    echo "usage: $0 {start|stop}" >&2
    exit 2
    ;;
esac
