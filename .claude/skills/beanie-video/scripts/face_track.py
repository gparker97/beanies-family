#!/usr/bin/env python3
"""Find faces in a cut, for two different jobs.

  --mode offsets   Report where faces actually sit in each shot, so you can pick a
                   per-shot vertical crop offset. A framed preset crops a window out
                   of each source frame; one global offset guillotines heads in the
                   shots where the subject sits high. This measures instead of guessing.

  --mode overlay   Composite a beanie over confident face detections. Only do this
                   when asked - covering faces removes most of what makes family
                   footage work. The confidence gate is what keeps it landing on
                   genuinely front-on faces and off the backs of heads.

Detection is YuNet (OpenCV DNN). Haar cascades were tried on this footage and were
unusable: they stuck beanies to tablets, walls and floors while missing real faces.
The model is fetched once and cached; opencv-python-headless<5 is required because
OpenCV 5 dropped the bundled cascades and changed the API surface.

Usage:
  face_track.py cut.mp4 --mode offsets --shots "a:0:0.75,b:0.75:1.72"
  face_track.py cut.mp4 --mode overlay --out covered.mp4 --sticker bean_head.png
"""
import argparse, os, subprocess, sys, urllib.request

MODEL_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
             "face_detection_yunet/face_detection_yunet_2023mar.onnx")
CACHE = os.path.expanduser("~/.cache/beanie-video")


def model_path():
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, "yunet.onnx")
    if not os.path.exists(p) or os.path.getsize(p) < 100_000:
        print(f"fetching YuNet model -> {p}", file=sys.stderr)
        urllib.request.urlretrieve(MODEL_URL, p)
    return p


def load(src):
    import cv2
    cap = cv2.VideoCapture(src)
    W, H = int(cap.get(3)), int(cap.get(4))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    return frames, W, H, fps


def detect(frames, W, H, conf, ds=2):
    import cv2
    dw, dh = W // ds, H // ds
    yn = cv2.FaceDetectorYN.create(model_path(), "", (dw, dh),
                                   score_threshold=0.5, nms_threshold=0.3, top_k=50)
    out = [None] * len(frames)
    for i, f in enumerate(frames):
        _, faces = yn.detect(cv2.resize(f, (dw, dh)))
        if faces is None:
            continue
        best = None
        for r in faces:
            if r[-1] < conf:
                continue
            if best is None or r[2] * r[3] > best[2] * best[3]:
                best = r
        if best is not None:
            out[i] = ((best[0] + best[2] / 2) * ds, (best[1] + best[3] / 2) * ds,
                      best[2] * ds, best[3] * ds)
    return out


def runs(d):
    out, s = [], None
    for i, v in enumerate(d):
        if v is not None and s is None:
            s = i
        elif v is None and s is not None:
            out.append((s, i - 1)); s = None
    if s is not None:
        out.append((s, len(d) - 1))
    return out


def smooth(det, maxgap, minrun, window):
    r = runs(det)
    for (_, b1), (a2, _) in zip(r, r[1:]):
        gap = a2 - b1 - 1
        if 0 < gap <= maxgap:
            p, q = det[b1], det[a2]
            for k in range(1, gap + 1):
                t = k / (gap + 1.0)
                det[b1 + k] = tuple(p[j] + (q[j] - p[j]) * t for j in range(4))
    for a, b in runs(det):
        if b - a + 1 < minrun:
            for i in range(a, b + 1):
                det[i] = None
    sm = list(det)
    for a, b in runs(det):
        for i in range(a, b + 1):
            lo, hi = max(a, i - window // 2), min(b, i + window // 2)
            win = [det[k] for k in range(lo, hi + 1)]
            sm[i] = tuple(sum(v[j] for v in win) / len(win) for j in range(4))
    return sm


def mode_offsets(args):
    frames, W, H, fps = load(args.src)
    det = detect(frames, W, H, args.conf)
    shots = []
    for spec in args.shots.split(","):
        name, t0, t1 = spec.split(":")
        shots.append((name, float(t0), float(t1)))
    print(f"source {W}x{H} @{fps:.2f}fps, crop window height {args.crop_h}, "
          f"target face at {args.face_at:.0%} of the window\n")
    rows = []
    for name, t0, t1 in shots:
        n_frames = max(1, int(t1 * fps) - int(t0 * fps))
        hits = [det[i] for i in range(int(t0 * fps), min(int(t1 * fps), len(frames)))
                if det[i] is not None]
        if not hits:
            rows.append((name, 0, None, None, None, 0.0))
            continue
        ys = sorted(h[1] for h in hits)
        ws = sorted(h[2] for h in hits)
        med, fw = ys[len(ys) // 2], ws[len(ws) // 2]
        off = max(0, min(int(round(med - args.crop_h * args.face_at)), H - args.crop_h))
        rows.append((name, len(hits), med, fw, off, len(hits) / n_frames))

    # A face much smaller than the biggest face in the cut is usually a bystander -
    # a sibling on the sofa, a face on a screen - not the subject of that shot.
    # The 0.35 threshold is a rule of thumb tuned so that a subject genuinely standing
    # back from the camera still passes, while a face in the background does not.
    # If it misjudges your footage, trust the contact sheet over this number.
    biggest = max([r[3] for r in rows if r[3]], default=0)

    print(f"{'shot':<18} {'faces':>6} {'median y':>10} {'face w':>7} {'crop y':>8}  note")
    for name, n, med, fw, off, hit in rows:
        if med is None:
            print(f"{name:<18} {0:>6} {'-':>10} {'-':>7} {'-':>8}  "
                  f"no face - frame this one by eye")
            continue
        note = ""
        if fw / W < 0.09:
            note = f"face is {fw/W:.0%} of frame width - probably a bystander or a face on screen"
        elif biggest and fw / biggest < 0.35:
            note = (f"face is {fw/biggest:.0%} the size of the largest in this cut - "
                    f"likely a bystander, not the subject")
        elif hit < 0.35:
            note = f"only {hit:.0%} of frames - weak, check by eye"
        elif off in (0, H - args.crop_h):
            note = "clamped to the edge of the frame"
        print(f"{name:<18} {n:>6} {med:>10.1f} {fw:>7.0f} {off:>8}  {note}")

    print("\nOffsets are clamped to [0, source_height - crop_height]; a clamped shot just "
          "means the window is already as far as it can go.\n"
          "Treat these as a starting point, not an answer. A low hit rate usually means the "
          "detector locked onto something incidental - a sibling in the background, or faces "
          "drawn on a screen - so override those by eye. Shots with no face at all (backs of "
          "heads, a tablet close-up) need you to decide what the subject actually is: for a "
          "screen, centre the screen; for a raised arm, keep the arm in frame.")


def mode_overlay(args):
    import cv2, numpy as np
    from PIL import Image
    frames, W, H, fps = load(args.src)
    det = smooth(detect(frames, W, H, args.conf), args.maxgap, args.minrun, args.window)
    cov = sum(d is not None for d in det)
    print(f"{len(frames)} frames; beanie covers {cov} ({cov*100//len(frames)}%)")
    for a, b in runs(det):
        print(f"  covered {a/fps:.2f}s -> {b/fps:.2f}s")
    bean = Image.open(args.sticker).convert("RGBA")
    ar = bean.width / bean.height
    p = subprocess.Popen(
        ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{W}x{H}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-crf", "17",
         "-preset", "medium", "-pix_fmt", "yuv420p", "-an", args.out], stdin=subprocess.PIPE)
    for i, f in enumerate(frames):
        d = det[i]
        if d is not None:
            cx, cy, w, _ = d
            bw = int(round(w * args.scale)); bh = int(round(bw / ar))
            if bw > 8:
                b = bean.resize((bw, bh), Image.LANCZOS)
                base = Image.fromarray(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).convert("RGBA")
                base.alpha_composite(b, (int(round(cx - bw / 2)), int(round(cy - bh * 0.55))))
                f = cv2.cvtColor(np.array(base.convert("RGB")), cv2.COLOR_RGB2BGR)
        p.stdin.write(f.tobytes())
    p.stdin.close(); p.wait()
    print("wrote", args.out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--mode", choices=["offsets", "overlay"], required=True)
    ap.add_argument("--conf", type=float, default=0.78,
                    help="0.60 is right for measuring positions; 0.78 for covering faces")
    ap.add_argument("--shots", help="offsets mode: name:start:end,name:start:end")
    ap.add_argument("--crop-h", type=int, default=1485, help="offsets mode: crop window height")
    ap.add_argument("--face-at", type=float, default=0.36,
                    help="offsets mode: where in the window the face should sit")
    ap.add_argument("--out", help="overlay mode: output mp4")
    ap.add_argument("--sticker", help="overlay mode: transparent PNG to composite")
    ap.add_argument("--scale", type=float, default=1.38, help="overlay mode: sticker width / face width")
    ap.add_argument("--maxgap", type=int, default=12)
    ap.add_argument("--minrun", type=int, default=5)
    ap.add_argument("--window", type=int, default=7)
    a = ap.parse_args()
    if a.mode == "offsets":
        if not a.shots:
            sys.exit("--shots is required for offsets mode")
        if a.conf == 0.78:
            a.conf = 0.60
        mode_offsets(a)
    else:
        if not (a.out and a.sticker):
            sys.exit("--out and --sticker are required for overlay mode")
        mode_overlay(a)
