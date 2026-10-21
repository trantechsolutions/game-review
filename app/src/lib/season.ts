// Season totals across every game: results, when goals come and the shot numbers (from the public
// game files), and recurring themes (from the coaches' breakdowns, coach password only).
import { IMPROVEMENT_AREAS, type ImprovementArea, type Priority, type Game, type PublicGame } from "../schema";
import { sec } from "./time";

export type Result = "W" | "D" | "L";
export const result = (us: number, them: number): Result => (us > them ? "W" : us < them ? "L" : "D");

type Pair = [us: number, them: number];

export interface GameLine {
  slug: string; date: string; opponent: string; home: boolean | null;
  us: number; them: number; htUs: number; htThem: number; result: Result;
  shots: Pair | null; onTarget: Pair | null; possession: Pair | null;
}

// Stat tables are written per game with free-text labels ("Shots on goal", "On target", "Possession %"),
// so rows are matched by their English label. The first match wins: the first table is the full game.
const STAT: Record<"shots" | "onTarget" | "possession", RegExp> = {
  shots: /^shots$/i,
  onTarget: /\bon (goal|target)\b/i,
  possession: /possession/i,
};

export function statOf(g: PublicGame, kind: keyof typeof STAT): Pair | null {
  for (const tb of g.report.numbers.tables) {
    const r = tb.rows.find(r => STAT[kind].test(r.label.en.trim()));
    if (r) return [r.us, r.them];
  }
  return null;
}

export function gameLine(g: PublicGame): GameLine {
  const { us, them, htUs, htThem } = g.score;
  return {
    slug: g.slug, date: g.date, opponent: g.opponent, home: g.home,
    us, them, htUs, htThem, result: result(us, them),
    shots: statOf(g, "shots"), onTarget: statOf(g, "onTarget"), possession: statOf(g, "possession"),
  };
}

/** Goal-timing windows within each half, by the half's clock. */
export const WINDOWS = [[0, 10], [10, 20], [20, null]] as const;
const windowOf = (c: string) => Math.min(Math.floor(sec(c) / 600), WINDOWS.length - 1);

export const RECENT = 5;

export interface Season {
  lines: GameLine[];                    // oldest first
  record: Record<Result, number> & { gf: number; ga: number; cleanSheets: number; blanks: number };
  /** Goals for and against per half and window: timing[half - 1][window]. */
  timing: Pair[][];
  /** Final results grouped by the half-time state. */
  fromHalfTime: Record<"ahead" | "level" | "behind", Record<Result, number>>;
  /** Opponents met more than once, each with its games oldest first. */
  repeats: { opponent: string; lines: GameLine[] }[];
  /** Averages over the games that recorded the stat. */
  avg: { shots: Pair | null; onTarget: Pair | null; possession: Pair | null };
}

export function season(games: PublicGame[]): Season {
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));
  const lines = sorted.map(gameLine);

  const record = { W: 0, D: 0, L: 0, gf: 0, ga: 0, cleanSheets: 0, blanks: 0 };
  const zero = (): Record<Result, number> => ({ W: 0, D: 0, L: 0 });
  const fromHalfTime = { ahead: zero(), level: zero(), behind: zero() };
  for (const l of lines) {
    record[l.result]++;
    record.gf += l.us; record.ga += l.them;
    if (l.them === 0) record.cleanSheets++;
    if (l.us === 0) record.blanks++;
    fromHalfTime[l.htUs > l.htThem ? "ahead" : l.htUs < l.htThem ? "behind" : "level"][l.result]++;
  }

  const timing: Pair[][] = [1, 2].map(() => WINDOWS.map((): Pair => [0, 0]));
  for (const g of sorted) for (const e of g.events) {
    if (e.y !== "Goal" || e.t === "N") continue;
    timing[e.h - 1][windowOf(e.c)][e.t === "D" ? 0 : 1]++;
  }

  const byOpp = new Map<string, GameLine[]>();
  for (const l of lines) byOpp.set(l.opponent, [...(byOpp.get(l.opponent) ?? []), l]);
  const repeats = [...byOpp].filter(([, ls]) => ls.length > 1).map(([opponent, lines]) => ({ opponent, lines }));

  const mean = (k: "shots" | "onTarget" | "possession"): Pair | null => {
    const xs = lines.map(l => l[k]).filter((p): p is Pair => p !== null);
    if (!xs.length) return null;
    const r = (n: number) => Math.round((n / xs.length) * 10) / 10;
    return [r(xs.reduce((s, p) => s + p[0], 0)), r(xs.reduce((s, p) => s + p[1], 0))];
  };

  return { lines, record, timing, fromHalfTime, repeats, avg: { shots: mean("shots"), onTarget: mean("onTarget"), possession: mean("possession") } };
}

export interface Theme {
  area: ImprovementArea;
  highGames: number;                    // games with a high-priority fix in this area
  games: number;                        // games with any fix in this area
  recentHigh: number;                   // of the last RECENT games, how many had a high-priority fix here
  fixes: Record<Priority, number>;
  thirds: [defensive: number, middle: number, attacking: number]; // fixes per third of the field
}

/** Recurring themes from the coaches' breakdowns: what the high-priority fixes keep coming back to.
 *  Ranked by games with a high-priority fix, then by weighted fixes (high 3, medium 2, low 1). */
export function themes(games: { date: string; coaches: Game["coaches"] }[]): Theme[] {
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date));
  const recentFrom = Math.max(0, sorted.length - RECENT);
  const weight = (t: Theme) => t.fixes.high * 3 + t.fixes.med * 2 + t.fixes.low;
  return IMPROVEMENT_AREAS.map((area): Theme => {
    const th: Theme = { area, highGames: 0, games: 0, recentHigh: 0, fixes: { high: 0, med: 0, low: 0 }, thirds: [0, 0, 0] };
    sorted.forEach((g, i) => {
      let any = false, high = false;
      g.coaches.thirds.blocks.forEach((b, third) => b.fixes.forEach(f => {
        if (f.area !== area) return;
        any = true; high ||= f.pri === "high";
        th.fixes[f.pri]++; th.thirds[third]++;
      }));
      if (any) th.games++;
      if (high) { th.highGames++; if (i >= recentFrom) th.recentHigh++; }
    });
    return th;
  }).filter(t => t.games > 0).sort((a, b) => b.highGames - a.highGames || weight(b) - weight(a) || b.recentHigh - a.recentHigh);
}
