#!/usr/bin/env python3
"""Verify a delivered video/GIF/WebP actually contains what you think it does.

Deliverables get truncated, lose their loop flag, or end on the wrong frame, and none
of that is visible from a file listing. Check before you hand over a link.

The WebP trap this exists to avoid: Pillow's `im.info["duration"]` reports 0 for every
frame of an animated WebP even when the container carries correct durations. Reading
that number and concluding the file is broken sends you re-encoding a file that was
fine all along. This script parses the ANMF chunks in the RIFF container instead,
which is authoritative.

Usage:
  verify_output.py out.mp4 out.gif out.webp
  verify_output.py out.webp --frames-out /tmp/check   # also write first/last frame PNGs
"""
import argparse, os, struct, subprocess, sys


def webp_info(path):
    """Parse frame count / per-frame durations / loop count from the RIFF container."""
    d = open(path, "rb").read()
    if d[:4] != b"RIFF" or d[8:12] != b"WEBP":
        raise ValueError("not a WebP file")
    off, loops, durs = 12, None, []
    while off + 8 <= len(d):
        fourcc = d[off:off + 4]
        size = struct.unpack("<I", d[off + 4:off + 8])[0]
        body = d[off + 8:off + 8 + size]
        if fourcc == b"ANIM" and len(body) >= 6:
            loops = struct.unpack("<H", body[4:6])[0]
        elif fourcc == b"ANMF" and len(body) >= 15:
            durs.append(body[12] | (body[13] << 8) | (body[14] << 16))
        off += 8 + size + (size & 1)
    return {"frames": len(durs), "total_ms": sum(durs),
            "durations": sorted(set(durs)), "loops": loops}


def pil_info(path):
    from PIL import Image
    im = Image.open(path)
    n = getattr(im, "n_frames", 1)
    tot = 0
    for i in range(n):
        im.seek(i)
        tot += im.info.get("duration", 0)
    return {"size": im.size, "frames": n, "total_ms": tot, "loop": im.info.get("loop")}


def probe_video(path):
    def q(entries, stream=True):
        cmd = ["ffprobe", "-v", "error"]
        if stream:
            cmd += ["-select_streams", "v:0"]
        cmd += ["-show_entries", entries, "-of", "csv=p=0", path]
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    wh = q("stream=width,height")
    return {"size": wh, "frames": q("stream=nb_frames"),
            "duration": q("format=duration", stream=False)}


def dump_frames(path, outdir, tag):
    os.makedirs(outdir, exist_ok=True)
    ext = os.path.splitext(path)[1].lower()
    if ext in (".gif", ".webp"):
        from PIL import Image
        im = Image.open(path)
        for label, idx in (("first", 0), ("last", getattr(im, "n_frames", 1) - 1)):
            im.seek(idx)
            p = os.path.join(outdir, f"{tag}_{label}.png")
            im.convert("RGB").save(p)
            print(f"      {label} frame -> {p}")
    else:
        for label, args in (("first", ["-ss", "0"]), ("last", ["-sseof", "-0.1"])):
            p = os.path.join(outdir, f"{tag}_{label}.png")
            subprocess.run(["ffmpeg", "-v", "error", "-y"] + args +
                           ["-i", path, "-update", "1", "-frames:v", "1", p], check=False)
            if os.path.exists(p):
                print(f"      {label} frame -> {p}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--frames-out", default=None,
                    help="write first/last frame PNGs here so you can eyeball the ends")
    a = ap.parse_args()
    bad = False
    for f in a.files:
        ext = os.path.splitext(f)[1].lower()
        n = os.path.getsize(f)
        print(f"\n{os.path.basename(f)}   {n:,} bytes ({n/1e6:.2f} MB)")
        try:
            if ext == ".webp":
                w = webp_info(f)
                p = pil_info(f)
                loop_txt = "infinite" if w["loops"] == 0 else f"{w['loops']}x"
                print(f"   {p['size'][0]}x{p['size'][1]}  {w['frames']} frames  "
                      f"{w['total_ms']/1000:.2f}s  loop={loop_txt}")
                print(f"   per-frame ms (from ANMF chunks): {w['durations']}")
                if w["total_ms"] == 0:
                    print("   PROBLEM: frames carry no duration - players will race or stall")
                    bad = True
                if p["total_ms"] == 0 and w["total_ms"] > 0:
                    print("   (Pillow reports 0ms here; that is the known Pillow quirk, "
                          "not a fault in the file)")
            elif ext == ".gif":
                p = pil_info(f)
                loop_txt = "infinite" if p["loop"] == 0 else f"{p['loop']}x"
                print(f"   {p['size'][0]}x{p['size'][1]}  {p['frames']} frames  "
                      f"{p['total_ms']/1000:.2f}s  loop={loop_txt}")
                if p["loop"] is None:
                    print("   PROBLEM: no loop flag - this will play once and stop")
                    bad = True
            else:
                v = probe_video(f)
                print(f"   {v['size']}  {v['frames']} frames  {float(v['duration'] or 0):.2f}s")
            if a.frames_out:
                dump_frames(f, a.frames_out, os.path.splitext(os.path.basename(f))[0])
        except Exception as e:
            print(f"   FAILED to read: {e}")
            bad = True
    print("\nCompare the durations across your deliverables - they should all match the "
          "master. Then look at the last frame: a loop that ends on the wrong beat is the "
          "most common thing to ship by accident.")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
