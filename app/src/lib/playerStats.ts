// Each player's season numbers for NOLA DFC Manager (tools/manager/manager.ts stats): minutes, starts and
// positions, and goals, assists, shots and cards, from every place a game was recorded.
//
//   lineups     the film library's games with a lineup (lineups.json): who played where, and for how long
//   scorekeeper the stat logs kept on this site: every named shot, goal and card, and the lineup in advanced mode
//   Ollie       Ollie Sports' player stats (advanced games): playing time, goals, assists, shots, cards
//
// The same game is often in more than one, so games are matched by date (and opponent, when a day has two)
// and each game's numbers come from one source only: time from the lineup, else the scorekeeper, else Ollie;
// goals and shots from the scorekeeper, else Ollie. The film's breakdowns name moments by position, not by
// player, so they don't count goals.
import type { KeepEntry, Lineups, OllieGame, OlliePlayers, PublicGame as Game, Roster } from "../schema";
import { halfLengths, lineupFor, playLineup, type HalfLengths, type Stint } from "./lineup";
import { replay, toLineup } from "./keeplog";

type Kind = "lineup" | "keeper" | "ollie";
interface TimeLine { seconds: number; started: boolean | null; positions: Map<string, number> }
interface EventLine { goals: number; assists: number; shots: number; onTarget: number; yellow: number; red: number }

/** One game as one source recorded it, by roster name. */
export interface SourceGame {
  kind: Kind;
  date: string;
  opponent: string;
  time?: { available: number; players: Map<string, TimeLine> };
  events?: Map<string, EventLine>;
}

/** A player's season, as the manager stores it (player_season_stats.stats). */
export interface SeasonStats {
  games: number;           // games they played in, of those with a lineup, playing time or named stats
  minutes: number;
  available: number;       // minutes in the games with time recorded
  timedGames: number;      // games with time recorded (minutes, starts and positions are out of these)
  starts: number;
  positions: { pos: string; minutes: number }[];
  goals: number; assists: number; shots: number; onTarget: number; yellow: number; red: number;
  eventGames: number;      // games with named stats (goals, assists, shots and cards are out of these)
  sources: Kind[];
}

const emptyEvents = (): EventLine => ({ goals: 0, assists: 0, shots: 0, onTarget: 0, yellow: 0, red: 0 });
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => new Set(fold(s).split(" ").filter(w => w.length >= 3 && !/^\d+$/.test(w)));

/** The manager's season for a date: July to June, "2025-2026" (useSoccerYear in the manager). */
export function managerSeason(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const start = m >= 7 ? y : y - 1;
  return `${start}-${start + 1}`;
}

function timeFrom(stints: Stint[], len: HalfLengths, starters: Set<string>): SourceGame["time"] {
  const players = new Map<string, TimeLine>();
  for (const s of stints) {
    const p = players.get(s.player) ?? { seconds: 0, started: starters.has(s.player), positions: new Map() };
    p.seconds += s.to - s.from;
    p.positions.set(s.pos, (p.positions.get(s.pos) ?? 0) + s.to - s.from);
    players.set(s.player, p);
  }
  return { available: len[1] + len[2], players };
}

/** The library's games that have a lineup. */
export function fromLibrary(games: Game[], lineups: Lineups | null): SourceGame[] {
  return games.flatMap(g => {
    const r = lineupFor(lineups, g.slug);
    if (!r) return [];
    const len = halfLengths(g);
    return [{ kind: "lineup" as const, date: g.date, opponent: g.opponent, time: timeFrom(playLineup(r.lineup, len).stints, len, new Set(r.lineup.start.map(s => s.player))) }];
  });
}

/** The scorekeeper's games: named stats always, time when the lineup was kept (advanced mode). */
export function fromKeeper(logs: KeepEntry[][]): SourceGame[] {
  return logs.flatMap(entries => {
    const s = replay(entries);
    if (!s.setup || s.phase === "pre") return [];
    const events = new Map<string, EventLine>();
    const line = (name: string) => { const l = events.get(name) ?? emptyEvents(); events.set(name, l); return l; };
    for (const e of s.feed) {
      if (e.k !== "ev" || e.t !== "D" || e.og) continue;
      if (e.type === "Goal" && e.player) { const l = line(e.player); l.goals++; l.shots++; l.onTarget++; }
      if (e.type === "Goal" && e.assist) line(e.assist).assists++;
      if (e.type === "Shot" && e.player) {
        const l = line(e.player); l.shots++;
        if (e.on || e.result === "saved" || e.result === "caught") l.onTarget++;
      }
      if (e.type === "Yellow" && e.player) line(e.player).yellow++;
      if (e.type === "Red" && e.player) line(e.player).red++;
    }
    const g: SourceGame = { kind: "keeper", date: s.setup.date, opponent: s.setup.opponent };
    if (s.setup.level !== "beginner") g.events = events;
    if (s.setup.level !== "beginner" && s.setup.start.length) {
      const half = s.setup.halfMin * 60;
      const len: HalfLengths = { 1: s.ends[1] ?? half, 2: s.ends[2] ?? half };
      g.time = timeFrom(playLineup(toLineup(s), len).stints, len, new Set(s.setup.start.map(x => x.player)));
    }
    return g.events || g.time ? [g] : [];
  });
}

/** Finds a roster name for an Ollie player: the same name, else first and last name, else the shirt number. */
export function rosterMatcher(roster: Roster) {
  const byName = new Map(roster.players.map(p => [fold(p.name), p.name]));
  const firstLast = (s: string) => { const w = fold(s).split(" "); return w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : w[0]; };
  const byFirstLast = new Map(roster.players.map(p => [firstLast(p.name), p.name]));
  return (name: string, number: string | null): string | null =>
    byName.get(fold(name)) ?? byFirstLast.get(firstLast(name))
    ?? (number != null && /^\d+$/.test(number) ? roster.players.find(p => p.number === Number(number))?.name ?? null : null);
}

/** Ollie's games with player stats. Players it can't place on the roster are left out (and returned). */
export function fromOllie(history: OllieGame[], players: OlliePlayers, roster: Roster): { games: SourceGame[]; unknown: string[] } {
  const match = rosterMatcher(roster);
  const unknown = new Set<string>();
  const games = history.flatMap(g => {
    const list = players.games[g.id];
    if (!list?.length) return [];
    const time = new Map<string, TimeLine>(), events = new Map<string, EventLine>();
    for (const p of list) {
      const name = match(p.name, p.number);
      if (!name) { unknown.add(p.name); continue; }
      const st = p.stats;
      if (st.pPlayingTimeMS) time.set(name, { seconds: Math.round(st.pPlayingTimeMS / 1000), started: null, positions: new Map() });
      events.set(name, {
        goals: st.pGoals ?? 0, assists: st.pAssists ?? 0, shots: st.pShots ?? 0, onTarget: st.pShotsOnTarget ?? 0,
        yellow: st.pYellowCards ?? 0, red: st.pRedCards ?? 0,
      });
    }
    const available = Math.max(0, ...[...time.values()].map(t => t.seconds));
    const out: SourceGame = { kind: "ollie", date: g.date, opponent: g.opponent, events };
    if (time.size) out.time = { available, players: time };
    return [out];
  });
  return { games, unknown: [...unknown].sort() };
}

/** Puts the sources' games together: one entry per real game, with every source that recorded it. */
export function sameGames(all: SourceGame[]): SourceGame[][] {
  const clusters: SourceGame[][] = [];
  for (const g of all) {
    const day = clusters.filter(c => c[0].date === g.date && !c.some(x => x.kind === g.kind));
    const named = day.filter(c => c.some(x => [...words(x.opponent)].some(w => words(g.opponent).has(w))));
    const sameDay = clusters.filter(c => c[0].date === g.date);
    const home = named.length === 1 ? named[0] : sameDay.length === 1 && day.length === 1 ? day[0] : null;
    if (home) home.push(g); else clusters.push([g]);
  }
  return clusters;
}

const pick = <T,>(c: SourceGame[], order: Kind[], has: (g: SourceGame) => T | undefined) => {
  for (const k of order) { const g = c.find(x => x.kind === k); const v = g && has(g); if (v) return { kind: k, v }; }
  return null;
};

/**
 * Each player's numbers, by manager season: { season → { name → stats } }. Every roster player gets a line
 * for each season with games, so "out of" (timedGames, eventGames, available) counts the games they missed.
 */
export function seasonStats(all: SourceGame[], rosterNames: string[]): Map<string, Map<string, SeasonStats>> {
  const out = new Map<string, Map<string, SeasonStats>>();
  const clusters = sameGames(all);
  const line = (bySeason: Map<string, SeasonStats>, name: string) => {
    if (!bySeason.has(name)) bySeason.set(name, {
      games: 0, minutes: 0, available: 0, timedGames: 0, starts: 0, positions: [],
      goals: 0, assists: 0, shots: 0, onTarget: 0, yellow: 0, red: 0, eventGames: 0, sources: [],
    });
  };
  for (const c of clusters) {
    const season = managerSeason(c[0].date);
    if (!out.has(season)) { out.set(season, new Map()); for (const n of rosterNames) line(out.get(season)!, n); }
  }
  for (const c of clusters) {
    const bySeason = out.get(managerSeason(c[0].date))!;
    const time = pick(c, ["lineup", "keeper", "ollie"], g => g.time);
    const ev = pick(c, ["keeper", "ollie"], g => g.events);
    for (const name of [...(time?.v.players.keys() ?? []), ...(ev?.v.keys() ?? [])]) line(bySeason, name);
    for (const [name, s] of bySeason) {
      const t = time?.v.players.get(name), e = ev?.v.get(name);
      if (time) { s.timedGames++; s.available += Math.round(time.v.available / 60); }
      if (ev) s.eventGames++;
      if ((t && t.seconds > 0) || (e && Object.values(e).some(v => v > 0))) s.games++;
      if (t) {
        s.minutes += t.seconds / 60;
        if (t.started) s.starts++;
        for (const [pos, sec] of t.positions) {
          const p = s.positions.find(x => x.pos === pos);
          if (p) p.minutes += sec / 60; else s.positions.push({ pos, minutes: sec / 60 });
        }
      }
      if (e) for (const k of ["goals", "assists", "shots", "onTarget", "yellow", "red"] as const) s[k] += e[k];
      for (const k of [time?.kind, ev?.kind]) if (k && (t || e) && !s.sources.includes(k)) s.sources.push(k);
    }
  }
  for (const bySeason of out.values()) for (const s of bySeason.values()) {
    s.minutes = Math.round(s.minutes);
    s.positions = s.positions.map(p => ({ pos: p.pos, minutes: Math.round(p.minutes) })).filter(p => p.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  }
  return out;
}
