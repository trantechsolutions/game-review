import type { PublicGame as Game, GameEvent } from "../schema";

export const sec = (c: string) => c.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
export const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Seconds into the full-game video. */
export const videoSec = (g: Game, e: Pick<GameEvent, "h" | "c">) => g.video.kickoff[e.h] + sec(e.c);

/** Match clock across both halves, second half starting at 30:00 (or wherever the first half's regulation ends). */
const HALF = 30 * 60;
export const matchSec = (e: Pick<GameEvent, "h" | "c">) => (e.h === 1 ? 0 : HALF) + sec(e.c);

/** The "Game" column. "running" counts the minute in progress, as Ollie's timeline does. */
export function gameMinute(g: Game, e: Pick<GameEvent, "h" | "c">): number | null {
  if (!g.video.minute) return null;
  const s = matchSec(e);
  return Math.floor(s / 60) + (g.video.minute === "running" && sec(e.c) > 0 ? 1 : 0);
}

/** Which five-minute working clip holds a video time. Clips are `len` s long, starting every `step` s;
 *  in the overlap the earlier clip wins. */
export function workingClip(g: Game, v: number): { n: number; at: string; label: string } {
  const { step, len, count, prefix } = g.video.workingClips;
  let i = Math.min(Math.floor(v / step), count - 1);
  let off = v - i * step;
  if (off < len - step && i > 0) { i--; off += step; }
  return { n: i + 1, at: mmss(off), label: `${prefix}${String(i + 1).padStart(2, "0")}` };
}
