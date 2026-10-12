"""Cut the highlight clips listed in each game's data file (highlights.clips in
private/data/games/<slug>.json) from that game's full-game video (highlights.source).

Runs on the PC that holds the full-game videos (they are never committed). Clips go to
private/clips/<slug>/<id>.mp4; the app shows them from the game file, so no page is written.
    python tools/make_highlights.py            # NVIDIA GPU encode (h264_nvenc)
    python tools/make_highlights.py --cpu      # libx264 if there is no NVIDIA GPU
    python tools/make_highlights.py --force    # re-cut clips that already exist
    python tools/make_highlights.py --game YYYY-MM-DD-opponent
"""
import argparse, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GAMES = ROOT / "private" / "data" / "games"
CLIPS = ROOT / "private" / "clips"
MAX_BYTES = 95 * 1024 * 1024  # GitHub rejects files over 100 MB

def secs(t):
    parts = [int(p) for p in t.split(":")]
    s = 0
    for p in parts:
        s = s * 60 + p
    return s

def mmss(s):
    return f"{s // 60:02d}:{s % 60:02d}"

def encode(src, start, dur, out, cpu):
    video = (["-c:v", "libx264", "-preset", "medium", "-crf", "26", "-maxrate", "2500k", "-bufsize", "5000k"] if cpu else
             ["-c:v", "h264_nvenc", "-preset", "p6", "-rc", "vbr", "-cq", "29", "-b:v", "1600k", "-maxrate", "2500k", "-bufsize", "5000k"])
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start), "-i", str(src), "-t", str(dur),
           "-vf", "scale=-2:720", "-pix_fmt", "yuv420p", *video, "-c:a", "aac", "-b:a", "96k", "-ac", "2",
           "-movflags", "+faststart", str(out)]
    subprocess.run(cmd, check=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--game")
    a = ap.parse_args()
    for f in sorted(GAMES.glob("*.json")):
        g = json.loads(f.read_text(encoding="utf-8"))
        if a.game and g["slug"] != a.game:
            continue
        hl = g["highlights"]
        cdir = CLIPS / g["slug"]
        cdir.mkdir(parents=True, exist_ok=True)
        src = Path(hl["source"])
        for c in hl["clips"]:
            out = cdir / f"{c['id']}.mp4"
            s, e = secs(c["start"]), secs(c["end"])
            if e <= s:
                sys.exit(f"{g['slug']}/{c['id']}: end is before start")
            if a.force or not out.exists():
                if not src.exists():
                    sys.exit(f"Source video not found: {src}")
                print(f"cutting {g['slug']}/{out.name} ({c['start']}–{c['end']}, {mmss(e - s)})")
                encode(src, s, e - s, out, a.cpu)
            size = out.stat().st_size
            if size > MAX_BYTES:
                sys.exit(f"{out} is {size / 1e6:.0f} MB; shorten the clip so it stays under GitHub's 100 MB limit")
        keep = {f"{c['id']}.mp4" for c in hl["clips"]}
        for stale in cdir.glob("*.mp4"):
            if stale.name not in keep:
                print(f"removing clip no longer listed: {stale.name}")
                stale.unlink()
        print(f"{g['slug']}: {len(hl['clips'])} clips ready")

if __name__ == "__main__":
    main()
