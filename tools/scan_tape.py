"""Finds the moments worth looking at in a full-game tape and renders them as contact sheets,
so a breakdown can be built from the video alone (no events log). Writes outside the repository.

    python tools/scan_tape.py cues   <video> [--out cues.json]
        Referee whistles (a narrow tone around 3-4.8 kHz) and crowd-noise peaks, in video time.
        Long whistles (>= 0.5 s) are usually kick-offs, restarts after a goal, and half/full time;
        short ones are fouls, cards and the ball going out. Crowd peaks sit on goals, big chances
        and saves. These are candidates, not events: confirm each one on the frames.
    python tools/scan_tape.py sheets <video> --out <dir> --at 20:28,43:28 [--before 10] [--after 20]
    python tools/scan_tape.py sheets <video> --out <dir> --from 4:30 --to 35:00
        Contact sheets: one frame every --every seconds (default 2), --cols x --rows per sheet
        (default 5 x 4), each frame stamped with its video time. --at makes one sheet per moment;
        --from/--to sweeps a range.
    python tools/scan_tape.py chunks <video> [--step 290] [--len 300]
        The five-minute working files the play-by-play's clip column points to, cut without
        re-encoding into <video folder>/clips/clip_NN_<mm-ss>_to_<mm-ss>.mp4. Prints the
        game file's video.workingClips.
"""
import argparse, json, shutil, subprocess, sys
from pathlib import Path

import numpy as np

SR, N, HOP = 16000, 2048, 800  # 50 ms analysis frames
FONT = Path("C:/Windows/Fonts/arial.ttf")


def secs(t):
    s = 0.0
    for p in str(t).split(":"):
        s = s * 60 + float(p)
    return s


def mmss(s):
    s = int(round(s))
    return f"{s // 60}:{s % 60:02d}"


def audio(video):
    raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video), "-vn", "-ac", "1",
                          "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768


def whistles(x):
    f = np.fft.rfftfreq(N, 1 / SR)
    band = (f >= 1500) & (f <= 5000)
    fb, win = f[band], np.hanning(N).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, N)[::HOP]
    peak, tone, share, level = [], [], [], []
    for i in range(0, len(frames), 4000):
        S = np.abs(np.fft.rfft(frames[i:i + 4000] * win, axis=1)) ** 2
        b = S[:, band]
        peak.append(fb[b.argmax(1)])
        tone.append(10 * np.log10(b.max(1) / (np.median(b, 1) + 1e-12)))
        share.append(b.sum(1) / (S.sum(1) + 1e-12))
        level.append(10 * np.log10(S.sum(1) + 1e-12))
    peak, tone, share, level = map(np.concatenate, (peak, tone, share, level))
    hit = (peak >= 3000) & (peak <= 4800) & (tone >= 38) & (share >= 0.9)
    t = np.arange(len(hit)) * HOP / SR
    runs, i = [], 0
    while i < len(hit):
        if not hit[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(hit) and (hit[j + 1] or (j + 2 < len(hit) and hit[j + 2])):
            j += 1
        if j - i + 1 >= 2:
            runs.append([t[i], t[j] + HOP / SR, float(tone[i:j + 1].max())])
        i = j + 1
    merged = []
    for a, b, s in runs:
        if merged and a - merged[-1][1] < 1.5:
            merged[-1][1], merged[-1][2] = b, max(merged[-1][2], s)
        else:
            merged.append([a, b, s])
    return [{"kind": "whistle", "at": mmss(a), "t": round(a, 1), "len": round(b - a, 1),
             "long": bool(b - a >= 0.5)} for a, b, s in merged]


def crowd(x, top=30):
    w = SR // 2
    r = x[:len(x) // w * w].reshape(-1, w)
    db = 10 * np.log10((r ** 2).mean(1) + 1e-12)
    k = 121  # one-minute rolling baseline
    base = np.median(np.lib.stride_tricks.sliding_window_view(np.pad(db, (k // 2, k // 2), mode="edge"), k), 1)
    lift = np.convolve(db - base, np.ones(6) / 6, mode="same")  # sustained over 3 s
    picked = []
    for i in np.argsort(-lift):
        if all(abs(i - j) * 0.5 > 20 for j in picked):
            picked.append(i)
        if len(picked) >= top:
            break
    return [{"kind": "crowd", "at": mmss(i * 0.5), "t": round(i * 0.5, 1), "lift": round(float(lift[i]), 1)}
            for i in sorted(picked)]


def cues(a):
    x = audio(a.video)
    out = sorted(whistles(x) + crowd(x), key=lambda c: c["t"])
    for c in out:
        tag = f"whistle {c['len']}s{' LONG' if c['long'] else ''}" if c["kind"] == "whistle" else f"crowd +{c['lift']} dB"
        print(f"{c['at']:>7}  {tag}")
    if a.out:
        Path(a.out).write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{sum(c['kind'] == 'whistle' for c in out)} whistles, {sum(c['kind'] == 'crowd' for c in out)} crowd peaks",
          file=sys.stderr)


def sheet(video, start, count, every, cols, rows, out, cwd):
    # drawtext needs a font path without a drive colon, so the font is copied next to the sheets.
    stamp = f"%{{pts\\:hms\\:{start:.2f}}}"
    vf = (f"fps=1/{every},scale=480:-2,drawtext=fontfile=arial.ttf:text='{stamp}':x=6:y=6:fontsize=26:"
          f"fontcolor=white:box=1:boxcolor=black@0.6,tile={cols}x{rows}")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.2f}", "-i", str(video),
                    "-t", f"{count * every:.2f}", "-vf", vf, "-frames:v", "1", "-q:v", "4", out.name],
                   cwd=cwd, check=True)


def sheets(a):
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if not (out / "arial.ttf").exists():
        shutil.copy(FONT, out / "arial.ttf")
    video = Path(a.video).resolve()
    per = a.cols * a.rows
    if a.at:
        for t in a.at.split(","):
            s = max(0.0, secs(t) - a.before)
            n = min(per, int((a.before + a.after) / a.every) + 1)
            f = out / f"at_{mmss(secs(t)).replace(':', '-')}.jpg"
            sheet(video, s, n, a.every, a.cols, a.rows, f, out)
            print(f)
    elif a.start is not None and a.to is not None:
        s, end = secs(a.start), secs(a.to)
        while s < end:
            f = out / f"sweep_{mmss(s).replace(':', '-')}.jpg"
            sheet(video, s, per, a.every, a.cols, a.rows, f, out)
            print(f)
            s += per * a.every
    else:
        sys.exit("sheets needs --at, or --from and --to")


def chunks(a):
    video = Path(a.video).resolve()
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(video)],
                               capture_output=True, text=True, check=True).stdout)
    out = video.parent / "clips"
    out.mkdir(exist_ok=True)
    count = int(dur // a.step) + (1 if dur % a.step > 1 else 0)
    for i in range(count):
        s = i * a.step
        e = min(s + a.len, dur)
        f = out / f"clip_{i + 1:02d}_{mmss(s).zfill(5).replace(':', '-')}_to_{mmss(e).zfill(5).replace(':', '-')}.mp4"
        if not f.exists():
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(s), "-i", str(video),
                            "-t", str(e - s), "-c", "copy", str(f)], check=True)
        print(f)
    print(json.dumps({"step": a.step, "len": a.len, "count": count, "prefix": "clip"}))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cues")
    c.add_argument("video")
    c.add_argument("--out")
    s = sub.add_parser("sheets")
    s.add_argument("video")
    s.add_argument("--out", required=True)
    s.add_argument("--at")
    s.add_argument("--from", dest="start")
    s.add_argument("--to")
    s.add_argument("--before", type=float, default=10)
    s.add_argument("--after", type=float, default=20)
    s.add_argument("--every", type=float, default=2)
    s.add_argument("--cols", type=int, default=5)
    s.add_argument("--rows", type=int, default=4)
    k = sub.add_parser("chunks")
    k.add_argument("video")
    k.add_argument("--step", type=int, default=290)
    k.add_argument("--len", type=int, default=300)
    a = ap.parse_args()
    {"cues": cues, "sheets": sheets, "chunks": chunks}[a.cmd](a)


if __name__ == "__main__":
    main()
