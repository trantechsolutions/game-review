"""Cut the highlight clips listed in private/highlights.json and write each game's highlights page.

Runs on the PC that holds the full-game videos (they are never committed).
    python tools/make_highlights.py            # NVIDIA GPU encode (h264_nvenc)
    python tools/make_highlights.py --cpu      # libx264 if there is no NVIDIA GPU
    python tools/make_highlights.py --force    # re-cut clips that already exist
    python tools/make_highlights.py --game 2026-10-10-hfc
"""
import argparse, html, json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "private" / "highlights.json"
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

PAGE = """<title>{title} Highlights</title>
<meta name="description" content="Key moments from {title}, {date}.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Public+Sans:wght@400;600;700&family=JetBrains+Mono:wght@500&display=swap">
<style>
  /* Layout: scoreboard strip, then a two-up grid of clips in match order. Same palette as the match reports. */
  :root {{
    color-scheme: dark;
    --bg: #000000; --surface: #0b1117; --line: #22303c; --line-strong: #3a4a57;
    --ink: #ffffff; --muted: #9fb0be; --dfc: #acd3f2; --opp: #c7a566; --on-accent: #000000;
    --display: "Big Shoulders Display", "Arial Narrow", Impact, sans-serif;
    --body: "Public Sans", "Segoe UI", system-ui, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, Consolas, monospace;
  }}
  @media (prefers-color-scheme: light) {{
    :root:not([data-theme="dark"]) {{ color-scheme: light; --bg: #ffffff; --surface: #f3f8fc; --line: #d3e1ec; --line-strong: #a9bccb; --ink: #000000; --muted: #4a5864; }}
  }}
  :root[data-theme="light"] {{ color-scheme: light; --bg: #ffffff; --surface: #f3f8fc; --line: #d3e1ec; --line-strong: #a9bccb; --ink: #000000; --muted: #4a5864; }}
  * {{ box-sizing: border-box; }}
  body {{ background: var(--bg); color: var(--ink); font: 400 1rem/1.55 var(--body); padding-inline: clamp(16px, 4vw, 48px); padding-block: 0 64px; }}
  .wrap {{ max-width: 1120px; margin-inline: auto; }}
  h1, h2 {{ margin: 0; text-wrap: balance; }}
  p {{ margin: 0; }}
  a {{ color: inherit; }}
  :focus-visible {{ outline: 2px solid var(--dfc); outline-offset: 3px; }}
  .eyebrow {{ font: 600 0.75rem/1 var(--body); letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }}
  header.strip {{ background: #000000; color: #ffffff; margin-inline: calc(-1 * clamp(16px, 4vw, 48px)); padding: clamp(24px, 4vw, 40px) clamp(16px, 4vw, 48px); border-bottom: 1px solid #2a3642; }}
  header.strip .wrap {{ display: grid; gap: 12px; }}
  header.strip .eyebrow {{ color: #9fb0be; }}
  .strip h1 {{ font: 900 clamp(2.2rem, 7vw, 4rem)/0.9 var(--display); text-transform: uppercase; }}
  .strip a {{ color: #acd3f2; font-size: 0.9rem; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 20px; padding-top: clamp(24px, 4vw, 40px); }}
  figure {{ margin: 0; display: grid; gap: 10px; min-width: 0; }}
  .frame {{ position: relative; aspect-ratio: 16 / 9; max-width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; display: grid; place-items: center; }}
  .frame video {{ width: 100%; height: 100%; display: block; background: #000000; }}
  .frame button {{ position: absolute; inset: 0; margin: auto; width: max-content; height: max-content; font: 600 0.9rem/1 var(--body); padding: 13px 18px; border-radius: 999px; border: 1px solid var(--line-strong); background: var(--bg); color: var(--ink); cursor: pointer; }}
  .frame button:hover {{ border-color: var(--ink); }}
  figcaption {{ display: grid; gap: 4px; }}
  .meta {{ display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: center; font: 500 0.78rem/1.3 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }}
  .tag {{ font: 700 0.68rem/1 var(--body); letter-spacing: 0.08em; text-transform: uppercase; padding: 4px 6px; border-radius: 3px; color: var(--on-accent); background: var(--dfc); }}
  .tag.Conceded {{ background: var(--opp); }}
  .tag.Save, .tag.Build-up {{ background: var(--line-strong); color: var(--ink); }}
  .label {{ font-weight: 600; }}
</style>

<header class="strip">
  <div class="wrap">
    <span class="eyebrow">Highlights · {date}</span>
    <h1>{title}</h1>
    <p><a href="../../index.html">All games</a> · <a href="play-by-play.html">Play-by-play</a> · <a href="coaches-breakdown.html">Coaches' breakdown</a> · <a href="match-report.html">Match report</a></p>
  </div>
</header>

<main class="wrap">
  <div class="grid">
{figures}
  </div>
</main>
"""

FIG = """    <figure>
      <div class="frame">
        <video controls playsinline preload="none" data-enc-src="clips/{id}.mp4" aria-label="{label}"></video>
        <button type="button" data-load>Load clip · {mb} MB</button>
      </div>
      <figcaption>
        <p class="meta"><span class="tag {tag}">{tag}</span><span>Full video {start}–{end}</span><span>{dur}</span></p>
        <p class="label">{label}</p>
      </figcaption>
    </figure>"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--game")
    a = ap.parse_args()
    games = json.loads(CONFIG.read_text(encoding="utf-8"))["games"]
    for g in games:
        if a.game and g["slug"] != a.game:
            continue
        gdir = ROOT / "private" / "site" / "games" / g["slug"]
        cdir = gdir / "clips"
        cdir.mkdir(parents=True, exist_ok=True)
        src = Path(g["source"])
        figs = []
        for c in g["clips"]:
            out = cdir / f"{c['id']}.mp4"
            s, e = secs(c["start"]), secs(c["end"])
            if e <= s:
                sys.exit(f"{g['slug']}/{c['id']}: end is before start")
            if a.force or not out.exists():
                if not src.exists():
                    sys.exit(f"Source video not found: {src}")
                print(f"cutting {g['slug']}/{out.name} ({c['start']}–{c['end']})")
                encode(src, s, e - s, out, a.cpu)
            size = out.stat().st_size
            if size > MAX_BYTES:
                sys.exit(f"{out} is {size / 1e6:.0f} MB; shorten the clip so it stays under GitHub's 100 MB limit")
            figs.append(FIG.format(id=c["id"], label=html.escape(c["label"]), tag=html.escape(c["tag"]),
                                   start=c["start"], end=c["end"], dur=mmss(e - s), mb=max(1, round(size / 1e6))))
        keep = {f"{c['id']}.mp4" for c in g["clips"]}
        for stale in cdir.glob("*.mp4"):
            if stale.name not in keep:
                print(f"removing clip no longer listed: {stale.name}")
                stale.unlink()
        (gdir / "highlights.html").write_text(
            PAGE.format(title=html.escape(g["title"]), date=html.escape(g["date"]), figures="\n".join(figs)), encoding="utf-8")
        print(f"wrote {g['slug']}/highlights.html")

if __name__ == "__main__":
    main()
