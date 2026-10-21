// A game's lineup as a timeline: who was at which position from when to when.
// Times are seconds of play from kickoff, with the second half starting where the first half's tape ends.
import type { Lineup, Lineups, PublicGame as Game } from "../schema";
import { couldPlay } from "./positions";
import { sec } from "./time";

export interface Stint { player: string; pos: string; from: number; to: number }
export type HalfLengths = { 1: number; 2: number };

export const halfLengths = (g: Pick<Game, "video">): HalfLengths => ({ 1: sec(g.video.halfLength[1]), 2: sec(g.video.halfLength[2]) });
export const playSec = (len: HalfLengths, h: 1 | 2, c: string) => (h === 1 ? 0 : len[1]) + sec(c);

/** Replays the starters and changes. Problems (a sub for someone not on, a change after the half ends…)
 *  are returned rather than thrown, so the validator can report them and the app can still show the rest. */
export function playLineup(l: Lineup, len: HalfLengths): { stints: Stint[]; errors: string[] } {
  const errors: string[] = [], stints: Stint[] = [];
  const on = new Map<string, { pos: string; from: number }>();
  const close = (player: string, t: number) => {
    const s = on.get(player)!;
    if (t > s.from) stints.push({ player, pos: s.pos, from: s.from, to: t });
    on.delete(player);
  };
  for (const s of l.start) {
    if (on.has(s.player)) errors.push(`start: ${s.player} is listed twice`);
    on.set(s.player, { pos: s.pos, from: 0 });
  }
  let last = 0;
  l.changes.forEach((ch, i) => {
    const where = `changes.${i} (${ch.h}H ${ch.c})`;
    if (sec(ch.c) > len[ch.h]) errors.push(`${where}: after the end of the half`);
    const t = playSec(len, ch.h, ch.c);
    if (t < last) errors.push(`${where}: out of time order`);
    last = Math.max(last, t);
    if ("off" in ch) {
      const off = on.get(ch.off);
      if (!off) { errors.push(`${where}: ${ch.off} isn't on the field`); return; }
      if (on.has(ch.on)) { errors.push(`${where}: ${ch.on} is already on the field`); return; }
      close(ch.off, t);
      on.set(ch.on, { pos: ch.pos ?? off.pos, from: t });
    } else {
      if (!on.has(ch.player)) { errors.push(`${where}: ${ch.player} isn't on the field`); return; }
      close(ch.player, t);
      on.set(ch.player, { pos: ch.pos, from: t });
    }
  });
  const end = len[1] + len[2];
  for (const p of [...on.keys()]) close(p, end);
  return { stints: stints.sort((a, b) => a.from - b.from), errors };
}

export const hasLineup = (l: Lineup | undefined | null): l is Lineup => !!l && l.start.length > 0;

/** A game's lineup with the default starters filled in. A game is an estimate when it says so, or,
 *  when it doesn't say, if it falls back on the default starters; `"estimated": false` confirms them. */
export function lineupFor(all: Lineups | null, slug: string): { lineup: Lineup; estimated: boolean } | null {
  const own = all?.games[slug];
  if (own?.start.length) return { lineup: own, estimated: !!own.estimated };
  const start = all?.default?.start;
  if (!start?.length) return null;
  return { lineup: { start, changes: own?.changes ?? [] }, estimated: own?.estimated ?? true };
}

/** Seconds each player was on the field. */
export function secondsOn(stints: Stint[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of stints) m.set(s.player, (m.get(s.player) ?? 0) + s.to - s.from);
  return m;
}

/** Positions a player held, in the order they first held them. */
export const positionsOf = (stints: Stint[], player: string) => [...new Set(stints.filter(s => s.player === player).map(s => s.pos))];

/** Who was at (or could be called) the named position at a moment of play. */
export const whoAt = (stints: Stint[], named: string, t: number) =>
  stints.filter(s => s.from <= t && t < s.to && couldPlay(named, s.pos));

/** Everyone who played the named position at some point, with their seconds there. */
export function whoPlayed(stints: Stint[], named: string): { player: string; seconds: number }[] {
  const m = new Map<string, number>();
  for (const s of stints) if (couldPlay(named, s.pos)) m.set(s.player, (m.get(s.player) ?? 0) + s.to - s.from);
  return [...m].map(([player, seconds]) => ({ player, seconds })).sort((a, b) => b.seconds - a.seconds);
}

export const minutes = (s: number) => Math.round(s / 60);
