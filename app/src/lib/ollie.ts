// Ollie Sports game history: the games Ollie recorded (tools/ollie/pull.ts), shown in the app's own style.
// Stat keys are Ollie's (tShots = team shots, pGoals = player goals…); percentages come as 0–1 and times in ms.
import type { Text } from "../schema";

export type StatMap = Record<string, number>;

/** Team stats worth showing, in order, with how to print them. */
export const TEAM_STATS: [key: string, label: Text, kind?: "pct"][] = [
  ["tGoals", { en: "Goals", es: "Goles" }],
  ["tPossessionPerc", { en: "Possession", es: "Posesión" }, "pct"],
  ["tShots", { en: "Shots", es: "Tiros" }],
  ["tShotsOnTarget", { en: "Shots on goal", es: "Tiros a puerta" }],
  ["tShotsOnTargetPerc", { en: "Shots on goal %", es: "% a puerta" }, "pct"],
  ["tShotFinishingPerc", { en: "Finishing", es: "Definición" }, "pct"],
  ["tPossessions", { en: "Possessions", es: "Posesiones" }],
  ["tPossessionsWithShotChance", { en: "Possessions ending in a shot", es: "Posesiones con tiro" }],
  ["tCompletedPasses", { en: "Completed passes", es: "Pases completados" }],
  ["tAvgPassesPerPoss", { en: "Passes per possession", es: "Pases por posesión" }],
  ["tLongestPassingChain", { en: "Longest passing chain", es: "Cadena de pases más larga" }],
  ["tTouches", { en: "Touches", es: "Toques" }],
  ["tSuccessRateWithBallPerc", { en: "Success with the ball", es: "Acierto con balón" }, "pct"],
  ["tRecoveries", { en: "Ball wins", es: "Recuperaciones" }],
  ["tTurnovers", { en: "Gave ball away", es: "Balones perdidos" }],
  ["tCrosses", { en: "Crosses", es: "Centros" }],
  ["tSuccessfulCrosses", { en: "Crosses completed", es: "Centros completados" }],
  ["tCornerKicks", { en: "Corners", es: "Córners" }],
  ["tSuccessfulCornerKicks", { en: "Corners completed", es: "Córners completados" }],
  ["tFreeKicks", { en: "Free kicks", es: "Tiros libres" }],
  ["tGoalKicks", { en: "Goal kicks", es: "Saques de puerta" }],
  ["tSuccessfulGoalKicks", { en: "Goal kicks kept", es: "Saques de puerta conservados" }],
  ["tThrowIns", { en: "Throw-ins", es: "Saques de banda" }],
  ["tSuccessfulThrowIns", { en: "Throw-ins kept", es: "Saques de banda conservados" }],
  ["tSaves", { en: "Saves", es: "Paradas" }],
  ["tGoalieCatches", { en: "Keeper catches", es: "Blocajes del portero" }],
  ["tFouls", { en: "Fouls", es: "Faltas" }],
  ["tHandballs", { en: "Handballs", es: "Manos" }],
  ["tOffsides", { en: "Offsides", es: "Fueras de juego" }],
  ["tPenaltyKicksAttempted", { en: "Penalties taken", es: "Penaltis lanzados" }],
  ["tPenaltyKicksScored", { en: "Penalties scored", es: "Penaltis marcados" }],
  ["tYellowCards", { en: "Yellow cards", es: "Amarillas" }],
  ["tRedCards", { en: "Red cards", es: "Rojas" }],
];

/** Player stats for the coach-only table. */
export const PLAYER_STATS: [key: string, label: Text, kind?: "min" | "pct"][] = [
  ["pPlayingTimeMS", { en: "Min", es: "Min" }, "min"],
  ["pGoals", { en: "Goals", es: "Goles" }],
  ["pAssists", { en: "Assists", es: "Asist." }],
  ["pShots", { en: "Shots", es: "Tiros" }],
  ["pShotsOnTarget", { en: "On goal", es: "A puerta" }],
  ["pCompletedPasses", { en: "Passes", es: "Pases" }],
  ["pKeyPasses", { en: "Key passes", es: "Pases clave" }],
  ["pTouches", { en: "Touches", es: "Toques" }],
  ["pRecoveries", { en: "Ball wins", es: "Recup." }],
  ["pTurnovers", { en: "Lost", es: "Pérdidas" }],
  ["pCrosses", { en: "Crosses", es: "Centros" }],
  ["pShotsSaved", { en: "Saves", es: "Paradas" }],
  ["pYellowCards", { en: "YC", es: "TA" }],
  ["pRedCards", { en: "RC", es: "TR" }],
];

export const fmtStat = (v: number | undefined, kind?: "pct" | "min", locale = "en-GB") => {
  if (v == null || Number.isNaN(v)) return "—";
  if (kind === "pct") return `${Math.round(v * 100)}%`;
  if (kind === "min") return String(Math.round(v / 60000));
  return v.toLocaleString(locale, { maximumFractionDigits: 1 });
};

/** Football seasons run August to July: "2025–26". */
export function seasonOf(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  const start = m >= 8 ? y : y - 1;
  return `${start}–${String((start + 1) % 100).padStart(2, "0")}`;
}

const tokens = (s: string) => new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w)));

export interface AppGameRef { slug: string; date: string; opponent: string; us: number; them: number }
export interface OllieGameRef { id: string; date: string; opponent: string; us: number; them: number }

/** Which library game (if any) each Ollie game is: same date, then the same score or a shared opponent word,
 *  and failing both, the only game that day on each side. Each library game is matched once. */
export function matchInApp(ollie: OllieGameRef[], app: AppGameRef[]): Map<string, string> {
  const out = new Map<string, string>(), used = new Set<string>();
  const byDate = (d: string, list: { date: string }[]) => list.filter(x => x.date === d);
  for (const pass of ["score+name", "score", "name", "only"] as const) {
    for (const o of ollie) {
      if (out.has(o.id)) continue;
      const cands = (byDate(o.date, app) as AppGameRef[]).filter(a => !used.has(a.slug));
      const sameScore = (a: AppGameRef) => a.us === o.us && a.them === o.them;
      const sharesName = (a: AppGameRef) => [...tokens(a.opponent)].some(w => tokens(o.opponent).has(w));
      const hit = pass === "score+name" ? cands.find(a => sameScore(a) && sharesName(a))
        : pass === "score" ? (cands.filter(sameScore).length === 1 ? cands.find(sameScore) : undefined)
        : pass === "name" ? (cands.filter(sharesName).length === 1 ? cands.find(sharesName) : undefined)
        : cands.length === 1 && byDate(o.date, ollie).length === 1 ? cands[0] : undefined;
      if (hit) { out.set(o.id, hit.slug); used.add(hit.slug); }
    }
  }
  return out;
}

export interface WDLRecord { n: number; W: number; D: number; L: number; gf: number; ga: number; cleanSheets: number }
export interface Summary extends WDLRecord {
  /** Per-game averages over the games that have stats: [ours, theirs]. */
  avg: { possession: [number, number] | null; shots: [number, number] | null; onGoal: [number, number] | null };
  venue: { home: WDLRecord; away: WDLRecord; unknown: WDLRecord };
}

const emptyRecord = (): WDLRecord => ({ n: 0, W: 0, D: 0, L: 0, gf: 0, ga: 0, cleanSheets: 0 });
const add = (r: WDLRecord, g: { us: number; them: number }) => { r.n++; r[resultOf(g.us, g.them)]++; r.gf += g.us; r.ga += g.them; if (!g.them) r.cleanSheets++; };

/** The record, averages and venue split for a set of games. */
export function summarize(games: { us: number; them: number; home: boolean | null; stats: { own: StatMap; opp: StatMap } | null }[]): Summary {
  const s: Summary = { ...emptyRecord(), avg: { possession: null, shots: null, onGoal: null }, venue: { home: emptyRecord(), away: emptyRecord(), unknown: emptyRecord() } };
  for (const g of games) { add(s, g); add(s.venue[g.home == null ? "unknown" : g.home ? "home" : "away"], g); }
  // Each average counts only the games that recorded it (team-only games may have no possession, say).
  const mean = (key: string): [number, number] | null => {
    const had = games.filter(g => g.stats && ((g.stats.own[key] ?? 0) || (g.stats.opp[key] ?? 0)));
    return had.length ? [had.reduce((a, g) => a + (g.stats!.own[key] ?? 0), 0) / had.length, had.reduce((a, g) => a + (g.stats!.opp[key] ?? 0), 0) / had.length] : null;
  };
  s.avg = { possession: mean("tPossessionPerc"), shots: mean("tShots"), onGoal: mean("tShotsOnTarget") };
  return s;
}

export const resultOf = (us: number, them: number) => (us > them ? "W" : us < them ? "L" : "D") as "W" | "D" | "L";
