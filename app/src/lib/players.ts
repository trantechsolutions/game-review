// Per-player season numbers from the lineups: minutes, starts, positions, and the logged moments that
// name a position while the player held it.
import type { GameEvent, Lineups, PublicGame as Game } from "../schema";
import { halfLengths, lineupFor, playLineup, playSec, whoAt, type Stint } from "./lineup";
import { splitPositions } from "./positions";

export interface PlayerGame {
  slug: string; date: string; opponent: string;
  seconds: number; available: number; started: boolean;
  estimated: boolean;                     // the lineup is a best guess (default starters or worked out from tape)
  positions: string[];                    // in the order first held
  moments: { e: GameEvent; pos: string }[]; // events naming a position the player held at that moment
}

export interface PlayerSeason {
  name: string;
  games: PlayerGame[];                    // games with a lineup where the player got on, oldest first
  recorded: number;                       // games with a lineup
  estimatedSlugs: Set<string>;            // of those, the ones that are estimates
  seconds: number; available: number; starts: number;
  positions: { pos: string; seconds: number }[]; // most played first
}

/** Position acronyms named in an event's English text. */
const named = (e: GameEvent) => [...new Set(splitPositions(e.d.en, "en").flatMap(p => (typeof p === "string" ? [] : [p.key])))];

export function playerSeasons(names: string[], games: Game[], lineups: Lineups | null): PlayerSeason[] {
  const played = [...games].sort((a, b) => a.date.localeCompare(b.date)).flatMap(g => {
    const r = lineupFor(lineups, g.slug);
    if (!r) return [];
    const len = halfLengths(g);
    return [{ g, len, stints: playLineup(r.lineup, len).stints, starters: new Set(r.lineup.start.map(s => s.player)), estimated: r.estimated }];
  });

  return names.map((name): PlayerSeason => {
    const pg: PlayerGame[] = [];
    const posSec = new Map<string, number>();
    for (const { g, len, stints, starters, estimated } of played) {
      const mine = stints.filter(s => s.player === name);
      if (!mine.length) continue;
      for (const s of mine) posSec.set(s.pos, (posSec.get(s.pos) ?? 0) + s.to - s.from);
      // Whistles (kickoff, half time) describe both teams' set-up, so they aren't anyone's moment.
      const moments = g.events.flatMap(e => {
        if (e.t === "N") return [];
        const t = playSec(len, e.h, e.c);
        const pos = named(e).find(k => whoAt(stints, k, t).some((s: Stint) => s.player === name));
        return pos ? [{ e, pos }] : [];
      });
      pg.push({
        slug: g.slug, date: g.date, opponent: g.opponent,
        seconds: mine.reduce((a, s) => a + s.to - s.from, 0), available: len[1] + len[2],
        started: starters.has(name), estimated, positions: [...new Set(mine.map(s => s.pos))], moments,
      });
    }
    return {
      name, games: pg, recorded: played.length, estimatedSlugs: new Set(played.filter(x => x.estimated).map(x => x.g.slug)),
      seconds: pg.reduce((a, x) => a + x.seconds, 0),
      available: played.reduce((a, x) => a + x.len[1] + x.len[2], 0),
      starts: pg.filter(x => x.started).length,
      positions: [...posSec].map(([pos, seconds]) => ({ pos, seconds })).sort((a, b) => b.seconds - a.seconds),
    };
  });
}
