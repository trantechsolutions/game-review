// A scorekeeper's stat log replayed: the clock, who is on, who has the ball, the score and every logged
// moment, plus the two exports the coach's PC needs (the game's lineup, and the moments and numbers for the
// breakdown). Pure, so the live screen, tools/keeper/keeper.ts and the tests share it.
import type { KeepEntry, KeepSetup, KeepType, Lineup, Text } from "../schema";
import { SPOT } from "./positions";
import { sec } from "./time";

// ---------- Formations ----------

/** One spot in a formation: its position and where it sits (x from our goal line, y from our left touchline). */
export type Slot = [pos: string, x: number, y: number];
export interface Shape { id: string; slots: Slot[] }

const GK: Slot = ["GK", 6, 50];
const BACK4: Slot[] = [["LB", 22, 14], ["LCB", 20, 38], ["RCB", 20, 62], ["RB", 22, 86]];
const BACK3: Slot[] = [["LCB", 21, 26], ["CB", 19, 50], ["RCB", 21, 74]];
const BACK2: Slot[] = [["LCB", 22, 34], ["RCB", 22, 66]];
const MID4: Slot[] = [["LM", 48, 12], ["LCM", 44, 38], ["RCM", 44, 62], ["RM", 48, 88]];

/** The formations each format offers, the usual one first. Every spot can still be changed at setup. */
export const SHAPES: Record<number, Shape[]> = {
  11: [
    { id: "4-4-2", slots: [GK, ...BACK4, ...MID4, ["LS", 74, 38], ["RS", 74, 62]] },
    { id: "4-3-3", slots: [GK, ...BACK4, ["LCM", 44, 30], ["CM", 40, 50], ["RCM", 44, 70], ["LW", 70, 14], ["ST", 78, 50], ["RW", 70, 86]] },
    { id: "4-2-3-1", slots: [GK, ...BACK4, ["LCM", 38, 38], ["RCM", 38, 62], ["LW", 60, 14], ["CM", 60, 50], ["RW", 60, 86], ["ST", 78, 50]] },
    { id: "4-1-4-1", slots: [GK, ...BACK4, ["CM", 34, 50], ["LM", 54, 12], ["LCM", 52, 38], ["RCM", 52, 62], ["RM", 54, 88], ["ST", 78, 50]] },
    { id: "4-4-1-1", slots: [GK, ...BACK4, ...MID4, ["FW", 64, 50], ["ST", 80, 50]] },
    { id: "3-5-2", slots: [GK, ...BACK3, ["LM", 46, 10], ["LCM", 42, 34], ["CM", 52, 50], ["RCM", 42, 66], ["RM", 46, 90], ["LS", 74, 38], ["RS", 74, 62]] },
    { id: "3-4-3", slots: [GK, ...BACK3, ...MID4, ["LW", 70, 16], ["ST", 78, 50], ["RW", 70, 84]] },
    { id: "5-4-1", slots: [GK, ["LB", 28, 10], ["LCB", 20, 30], ["CB", 18, 50], ["RCB", 20, 70], ["RB", 28, 90], ...MID4, ["ST", 76, 50]] },
  ],
  10: [
    { id: "4-4-1", slots: [GK, ...BACK4, ...MID4, ["ST", 74, 50]] },
    { id: "4-3-2", slots: [GK, ...BACK4, ["LCM", 44, 30], ["CM", 42, 50], ["RCM", 44, 70], ["LS", 72, 38], ["RS", 72, 62]] },
    { id: "3-4-2", slots: [GK, ...BACK3, ...MID4, ["LS", 72, 38], ["RS", 72, 62]] },
  ],
  9: [
    { id: "3-3-2", slots: [GK, ...BACK3, ["LM", 46, 16], ["CM", 44, 50], ["RM", 46, 84], ["LS", 72, 38], ["RS", 72, 62]] },
    { id: "3-2-3", slots: [GK, ...BACK3, ["LCM", 42, 38], ["RCM", 42, 62], ["LW", 70, 16], ["ST", 76, 50], ["RW", 70, 84]] },
    { id: "4-3-1", slots: [GK, ...BACK4, ["LCM", 44, 30], ["CM", 44, 50], ["RCM", 44, 70], ["ST", 74, 50]] },
    { id: "3-4-1", slots: [GK, ...BACK3, ...MID4, ["ST", 74, 50]] },
  ],
  8: [
    { id: "3-3-1", slots: [GK, ...BACK3, ["LM", 46, 16], ["CM", 44, 50], ["RM", 46, 84], ["ST", 74, 50]] },
    { id: "3-2-2", slots: [GK, ...BACK3, ["LCM", 42, 38], ["RCM", 42, 62], ["LS", 72, 38], ["RS", 72, 62]] },
    { id: "2-3-2", slots: [GK, ...BACK2, ["LM", 46, 16], ["CM", 44, 50], ["RM", 46, 84], ["LS", 72, 38], ["RS", 72, 62]] },
  ],
  7: [
    { id: "2-3-1", slots: [GK, ...BACK2, ["LM", 46, 14], ["CM", 44, 50], ["RM", 46, 86], ["ST", 74, 50]] },
    { id: "3-2-1", slots: [GK, ...BACK3, ["LCM", 44, 36], ["RCM", 44, 64], ["ST", 72, 50]] },
    { id: "3-1-2", slots: [GK, ...BACK3, ["CM", 42, 50], ["LS", 70, 36], ["RS", 70, 64]] },
    { id: "2-1-2-1", slots: [GK, ...BACK2, ["CM", 36, 50], ["LM", 54, 18], ["RM", 54, 82], ["ST", 74, 50]] },
  ],
  6: [
    { id: "2-2-1", slots: [GK, ["LCB", 24, 32], ["RCB", 24, 68], ["LM", 48, 26], ["RM", 48, 74], ["ST", 72, 50]] },
    { id: "3-1-1", slots: [GK, ...BACK3, ["CM", 46, 50], ["ST", 72, 50]] },
    { id: "2-1-2", slots: [GK, ["LCB", 24, 32], ["RCB", 24, 68], ["CM", 44, 50], ["LS", 70, 36], ["RS", 70, 64]] },
  ],
  5: [
    { id: "2-1-1", slots: [GK, ["LB", 26, 30], ["RB", 26, 70], ["CM", 46, 50], ["ST", 70, 50]] },
    { id: "1-2-1", slots: [GK, ["CB", 24, 50], ["LM", 46, 24], ["RM", 46, 76], ["ST", 70, 50]] },
    { id: "2-2", slots: [GK, ["LCB", 28, 32], ["RCB", 28, 68], ["LS", 64, 34], ["RS", 64, 66]] },
  ],
  4: [
    { id: "1-2-1", slots: [["CB", 24, 50], ["LM", 48, 22], ["RM", 48, 78], ["ST", 72, 50]] },
    { id: "GK 2-1", slots: [GK, ["LCB", 28, 34], ["RCB", 28, 66], ["ST", 66, 50]] },
    { id: "GK 1-2", slots: [GK, ["CB", 28, 50], ["LS", 62, 30], ["RS", 62, 70]] },
  ],
  3: [
    { id: "1-2", slots: [["CB", 28, 50], ["LW", 62, 24], ["RW", 62, 76]] },
    { id: "2-1", slots: [["LCB", 30, 30], ["RCB", 30, 70], ["ST", 66, 50]] },
    { id: "GK 1-1", slots: [GK, ["CB", 30, 50], ["ST", 66, 50]] },
  ],
  2: [
    { id: "1-1", slots: [["CB", 30, 50], ["FW", 66, 50]] },
    { id: "GK 1", slots: [GK, ["FW", 60, 50]] },
  ],
  1: [{ id: "1", slots: [["FW", 50, 50]] }],
};

export const shapeOf = (format: number, id?: string) => SHAPES[format].find(s => s.id === id) ?? SHAPES[format][0];

/** Where each player on the field stands: their formation spot when the shape has their position, else the
 *  usual spot for it; two at the same spot are nudged apart. */
export function placeAll<T extends { pos: string }>(on: T[], setup: Pick<KeepSetup, "format" | "formation"> | null): (T & { x: number; y: number })[] {
  const slots = setup ? [...shapeOf(setup.format, setup.formation).slots] : [];
  const taken = new Map<string, number>();
  return on.map(o => {
    const i = slots.findIndex(s => s[0] === o.pos);
    let [x, y] = i >= 0 ? [slots[i][1], slots[i][2]] : SPOT[o.pos] ?? [50, 50];
    if (i >= 0) slots.splice(i, 1);
    const key = `${x},${y}`, n = taken.get(key) ?? 0;
    taken.set(key, n + 1);
    if (n) { x += n * 7; y += n * 4; }
    return { ...o, x, y };
  });
}

// ---------- The log ----------

/** "12:05" from seconds, the clock format of game files. */
export const clockStr = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export const newId = () => crypto.randomUUID();

export type Side = "D" | "O";
export type Ev = Extract<KeepEntry, { k: "ev" }> & { pos?: string; toPos?: string };
export type Change = Extract<KeepEntry, { k: "sub" | "move" }>;
export type FeedItem = Ev | Change;
export type EvFields = Omit<Extract<KeepEntry, { k: "ev" }>, "id" | "at" | "k" | "h" | "c">;

export type Phase = "pre" | "live" | "break" | "done";

/** Whoever is on the ball: one of ours (by name; none in beginner mode), or theirs. */
export type Actor = { t: "D"; player?: string } | { t: "O"; opp: "gk" | "pl" };

export interface Ball {
  holder: Actor | null;
  /** The ball was just played (a cross, a clearance, a restart, a shot that wasn't held) and the next
   *  touch decides who has it. */
  loose: { kind: "cross" | "clear" | "restart" | "shot"; t: Side; player?: string } | null;
  /** A kickoff is due: by this side, or either at the start of a half. */
  kickoff: Side | "any" | null;
  /** Our passes in a row. */
  chain: number;
}

export interface KeepState {
  setup: KeepSetup | null;
  /** The clock reads `base` seconds at `since` (wall time, ms) and runs from there; `since` null = stopped. */
  clock: { h: 1 | 2; base: number; since: number | null };
  phase: Phase;
  /** Where each half ended on the clock, once it has. */
  ends: { 1?: number; 2?: number };
  on: { player: string; pos: string }[];
  score: { us: number; them: number };
  ball: Ball;
  /** Seconds each side had the ball, by the clock. */
  possession: { us: number; them: number };
  /** Moments, substitutions and position changes still standing (not undone), oldest first. */
  feed: FeedItem[];
  errors: string[];
}

/** Seconds on the clock at wall time `now`. */
export const clockAt = (c: KeepState["clock"], now: number) =>
  Math.max(0, Math.floor(c.base + (c.since != null ? (now - c.since) / 1000 : 0)));

/** Entries in the order they happened; ties (same millisecond, two phones) break by id so every device agrees. */
export const ordered = (entries: KeepEntry[]) => [...entries].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

const actorOf = (e: Ev): Actor => (e.t === "D" ? { t: "D", player: e.player } : { t: "O", opp: e.opp ?? "pl" });
const RESTARTS: KeepType[] = ["Throw-in", "Corner", "Goal kick", "Free kick", "Penalty"];

/** What a logged moment does to the ball. */
function moveBall(b: Ball, e: Ev, ourGk: string | undefined): Ball {
  const other: Side = e.t === "D" ? "O" : "D";
  switch (e.type) {
    case "Kickoff": return { holder: actorOf(e), loose: null, kickoff: null, chain: 0 };
    // Ours name the receiver (or none, for "My Team"); theirs say which of their pills got it.
    case "Pass": return { holder: e.t === "D" ? { t: "D", player: e.to } : { t: "O", opp: e.opp ?? "pl" }, loose: null, kickoff: null, chain: b.chain + 1 };
    case "Ball win": return { holder: actorOf(e), loose: null, kickoff: null, chain: 0 };
    case "Turnover": return { holder: other === "O" ? { t: "O", opp: "pl" } : { t: "D" }, loose: null, kickoff: null, chain: 0 };
    case "Cross": return { holder: null, loose: { kind: "cross", t: e.t, player: e.player }, kickoff: null, chain: b.chain };
    case "Clearance": return { holder: null, loose: { kind: "clear", t: e.t, player: e.player }, kickoff: null, chain: 0 };
    case "Goal": return { holder: null, loose: null, kickoff: other, chain: 0 };
    case "Save": return { holder: e.t === "D" ? { t: "D", player: e.player } : { t: "O", opp: "gk" }, loose: null, kickoff: null, chain: 0 };
    case "Shot":
      if (e.result === "saved" || e.result === "caught") {
        return { holder: e.t === "D" ? { t: "O", opp: "gk" } : { t: "D", player: ourGk }, loose: null, kickoff: null, chain: 0 };
      }
      return { holder: null, loose: { kind: "shot", t: e.t, player: e.player }, kickoff: null, chain: 0 };
    case "Foul": case "Handball": case "Offside": return { holder: null, loose: null, kickoff: null, chain: 0 };
    default:
      // A corner crossed in plays like any cross: the next touch decides whether it found someone.
      if (RESTARTS.includes(e.type)) return { holder: null, loose: { kind: e.via === "cross" ? "cross" : "restart", t: e.t, player: e.player }, kickoff: null, chain: 0 };
      return b; // cards, an illegal throw-in (the other side's throw-in follows)
  }
}

/** Whose ball it is for the possession count: the holder, or whoever last played it. */
const sideOf = (b: Ball): Side | null => b.holder?.t ?? b.loose?.t ?? null;

export function replay(entries: KeepEntry[]): KeepState {
  const all = ordered(entries);
  const voided = new Set(all.flatMap(e => (e.k === "void" ? [e.ref] : [])));
  const live = all.filter(e => e.k !== "void" && !voided.has(e.id));
  const setup = [...live].reverse().find(e => e.k === "setup")?.setup ?? null;
  const s: KeepState = {
    setup, clock: { h: 1, base: 0, since: null }, phase: "pre", ends: {},
    on: setup ? setup.start.map(x => ({ ...x })) : [], score: { us: 0, them: 0 },
    ball: { holder: null, loose: null, kickoff: "any", chain: 0 }, possession: { us: 0, them: 0 }, feed: [], errors: [],
  };
  const where = (e: { h: 1 | 2; c: string }) => `${e.h}H ${e.c}`;
  const half1 = () => s.ends[1] ?? (setup?.halfMin ?? 30) * 60;
  const playAt = (h: 1 | 2, c: string) => (h === 1 ? 0 : half1()) + sec(c);
  let last: number | null = null;
  const tally = (t: number) => {
    const side = sideOf(s.ball);
    if (last != null && side && t > last) s.possession[side === "D" ? "us" : "them"] += t - last;
    last = t;
  };
  const posOf = (name?: string) => (name ? s.on.find(x => x.player === name)?.pos : undefined);
  for (const e of live) {
    switch (e.k) {
      case "setup": break;
      case "clock":
        if (s.phase === "break" && e.h === 2) last = null;
        s.clock = { h: e.h, base: sec(e.c), since: e.run ? e.at : null };
        if (s.phase === "pre" || (s.phase === "break" && e.h === 2)) s.phase = "live";
        break;
      case "end":
        tally(playAt(e.h, e.c));
        s.ends[e.h] = sec(e.c);
        s.clock = { h: e.h, base: sec(e.c), since: null };
        s.phase = e.h === 1 ? "break" : "done";
        s.ball = { holder: null, loose: null, kickoff: e.h === 1 ? "any" : null, chain: 0 };
        break;
      case "ev": {
        const pos = posOf(e.player);
        if (e.player && !pos && setup?.level !== "beginner") s.errors.push(`${where(e)}: ${e.player} isn't on the field`);
        tally(playAt(e.h, e.c));
        if (e.type === "Goal") s.score[e.t === "D" ? "us" : "them"]++;
        s.feed.push({ ...e, pos, toPos: posOf(e.to) });
        s.ball = moveBall(s.ball, { ...e }, s.on.find(x => x.pos === "GK")?.player);
        break;
      }
      case "sub": {
        const off = s.on.find(x => x.player === e.off);
        if (!off) { s.errors.push(`${where(e)}: ${e.off} isn't on the field`); break; }
        if (s.on.some(x => x.player === e.on)) { s.errors.push(`${where(e)}: ${e.on} is already on the field`); break; }
        s.on = s.on.map(x => (x === off ? { player: e.on, pos: e.pos ?? off.pos } : x));
        if (s.ball.holder?.t === "D" && s.ball.holder.player === e.off) s.ball = { ...s.ball, holder: { t: "D" } };
        s.feed.push(e);
        break;
      }
      case "move": {
        const p = s.on.find(x => x.player === e.player);
        if (!p) { s.errors.push(`${where(e)}: ${e.player} isn't on the field`); break; }
        p.pos = e.pos;
        s.feed.push(e);
        break;
      }
    }
  }
  return s;
}

/** What tapping someone means right now: the kickoff, a pass (ours, or theirs when they are tapped again),
 *  winning the ball, losing it, or nothing (tapping our player who already has it). */
export function tapEvent(s: KeepState, a: Actor): EvFields | null {
  const b = s.ball;
  const who = a.t === "D" ? { t: "D" as const, ...(a.player ? { player: a.player } : {}) } : { t: "O" as const, opp: a.opp };
  if (b.kickoff && (b.kickoff === "any" || b.kickoff === a.t)) return { type: "Kickoff", ...who };
  if (a.t === "D") {
    const h = b.holder;
    if (h?.t === "D") {
      if (a.player && h.player === a.player) return null;
      return { type: "Pass", t: "D", ...(h.player ? { player: h.player } : {}), ...(a.player ? { to: a.player } : {}) };
    }
    if (b.loose?.t === "D" && (b.loose.kind === "cross" || b.loose.kind === "restart")) {
      return { type: "Pass", t: "D", ...(b.loose.player ? { player: b.loose.player } : {}), ...(a.player ? { to: a.player } : {}), ...(b.loose.kind === "cross" ? { cross: true } : {}) };
    }
    return { type: "Ball win", ...who };
  }
  // Tapping them again while they have it: one of their passes found a teammate.
  if (b.holder?.t === "O") return { type: "Pass", t: "O", opp: a.opp };
  if (b.loose?.t === "O" && (b.loose.kind === "cross" || b.loose.kind === "restart")) {
    return { type: "Pass", t: "O", opp: a.opp, ...(b.loose.kind === "cross" ? { cross: true } : {}) };
  }
  if (b.holder?.t === "D") return { type: "Turnover", t: "D", ...(b.holder.player ? { player: b.holder.player } : {}) };
  if (b.loose?.t === "D" && (b.loose.kind === "cross" || b.loose.kind === "restart")) {
    return { type: "Turnover", t: "D", ...(b.loose.player ? { player: b.loose.player } : {}), ...(b.loose.kind === "cross" ? { cross: true } : {}) };
  }
  return { type: "Ball win", ...who };
}

/** The restart for the line the ball crossed, given who takes it. We attack x = 100. */
export function restartFor(edge: "touch" | "ours" | "theirs", taker: Side): KeepType {
  if (edge === "touch") return "Throw-in";
  if (edge === "theirs") return taker === "D" ? "Corner" : "Goal kick";
  return taker === "D" ? "Goal kick" : "Corner";
}

/** The newest moment, substitution or position change that can still be undone. */
export const lastUndoable = (s: KeepState) => s.feed[s.feed.length - 1] ?? null;

/** The game's lineup in lineups.json form. */
export function toLineup(s: KeepState): Lineup {
  return {
    start: s.setup?.start ?? [],
    changes: s.feed.flatMap((e): Lineup["changes"] => {
      if (e.k === "sub") return [{ h: e.h, c: e.c, off: e.off, on: e.on, ...(e.pos ? { pos: e.pos } : {}) }];
      if (e.k === "move") return [{ h: e.h, c: e.c, player: e.player, pos: e.pos }];
      return [];
    }),
  };
}

// ---------- The export for the breakdown: moments named by position, and the numbers ----------

const isShot = (e: Ev) => e.type === "Goal" || e.type === "Shot";
const onTarget = (e: Ev) => (e.type === "Goal" && !e.og) || (e.type === "Shot" && (e.on || e.result === "saved" || e.result === "caught"));
const STAT_ROWS: [Text, (e: Ev) => boolean][] = [
  [{ en: "Goals", es: "Goles" }, e => e.type === "Goal"],
  [{ en: "Shots", es: "Tiros" }, e => isShot(e) && !e.og],
  [{ en: "On target", es: "A puerta" }, onTarget],
  [{ en: "Blocked shots", es: "Tiros bloqueados" }, e => e.type === "Shot" && e.result === "blocked"],
  [{ en: "Saves", es: "Paradas" }, e => e.type === "Save"],
  [{ en: "Passes", es: "Pases" }, e => e.type === "Pass" && !e.cross],
  [{ en: "Crosses", es: "Centros" }, e => e.type === "Cross" || e.via === "cross"],
  [{ en: "Crosses completed", es: "Centros completados" }, e => e.type === "Pass" && !!e.cross],
  [{ en: "Clearances", es: "Despejes" }, e => e.type === "Clearance"],
  [{ en: "Ball wins", es: "Recuperaciones" }, e => e.type === "Ball win"],
  [{ en: "Gave ball away", es: "Balones perdidos" }, e => e.type === "Turnover"],
  [{ en: "Fouls", es: "Faltas" }, e => e.type === "Foul"],
  [{ en: "Handballs", es: "Manos" }, e => e.type === "Handball"],
  [{ en: "Offsides", es: "Fueras de juego" }, e => e.type === "Offside"],
  [{ en: "Corners", es: "Córners" }, e => e.type === "Corner"],
  [{ en: "Throw-ins", es: "Saques de banda" }, e => e.type === "Throw-in"],
  [{ en: "Goal kicks", es: "Saques de puerta" }, e => e.type === "Goal kick"],
  [{ en: "Free kicks", es: "Tiros libres" }, e => e.type === "Free kick"],
  [{ en: "Penalties", es: "Penaltis" }, e => e.type === "Penalty"],
  [{ en: "Yellow cards", es: "Amarillas" }, e => e.type === "Yellow"],
  [{ en: "Red cards", es: "Rojas" }, e => e.type === "Red"],
];

export function stats(s: KeepState) {
  const evs = s.feed.filter((e): e is Ev => e.k === "ev");
  // A save is the keeper's: count our saves from their shots on target that our keeper stopped, and theirs from ours.
  const saves = (side: Side) => evs.filter(e => e.type === "Save" ? e.t === side : e.type === "Shot" && e.t !== side && (e.result === "saved" || e.result === "caught")).length;
  const rows = STAT_ROWS.map(([label, f]) => ({
    label, us: evs.filter(e => e.t === "D" && f(e)).length, them: evs.filter(e => e.t === "O" && f(e)).length, unit: undefined as string | undefined,
  }));
  const save = rows.find(r => r.label.en === "Saves")!;
  save.us = saves("D"); save.them = saves("O");
  const total = s.possession.us + s.possession.them;
  if (total) rows.splice(1, 0, { label: { en: "Possession", es: "Posesión" }, us: Math.round((s.possession.us / total) * 100), them: 100 - Math.round((s.possession.us / total) * 100), unit: "%" });
  return rows;
}

/** A moment's description by position only, in both languages, as game files are written. */
export function describe(e: Ev, us: string, opponent: string): Text {
  const team = e.t === "D" ? us : opponent;
  const pos = (p: string | undefined, fallback: string) => (p ? `**${p}**` : fallback);
  const who: Text = e.t === "D"
    ? { en: pos(e.pos, us), es: pos(e.pos, us) }
    : e.opp === "gk" ? { en: `the ${opponent} **GK**`, es: `el **GK** de ${opponent}` } : { en: opponent, es: opponent };
  if (e.og) {
    const by = e.t === "D" ? (e.opp === "gk" ? `the ${opponent} **GK**` : opponent) : pos(e.pos, us);
    const byEs = e.t === "D" ? (e.opp === "gk" ? `el **GK** de ${opponent}` : opponent) : pos(e.pos, us);
    return { en: `Own goal by ${by}; ${team} score.`, es: `Gol en propia puerta de ${byEs}; marca ${team}.` };
  }
  if (RESTARTS.includes(e.type)) {
    const es = { "Throw-in": "Saque de banda", Corner: "Córner", "Goal kick": "Saque de puerta", "Free kick": "Tiro libre", Penalty: "Penalti" }[e.type as string];
    const how = { pass: [", played short", ", en corto"], cross: [", crossed in", ", al área"], long: [", kicked long", ", en largo"] }[e.via ?? "pass"];
    const [hen, hes] = e.via ? how : ["", ""];
    return { en: `${e.type} to ${team}${hen}.`, es: `${es} para ${team}${hes}.` };
  }
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
  const to = e.to ? pos(e.toPos, us) : null;
  const where = e.goal && (e.type === "Goal" || e.type === "Shot") ? goalZone(e.goal) : null;
  const [en, es] = ({
    Kickoff: [`${cap(who.en)} kicks off.`, `Saca de centro ${who.es}.`],
    Pass: e.t === "O" ? (e.cross ? [`${opponent} cross finds a teammate.`, `Centro de ${opponent} que encuentra a un compañero.`] : [`${opponent} pass.`, `Pase de ${opponent}.`])
      : e.cross ? [`${cap(who.en)} crosses to ${to ?? "a teammate"}.`, `Centro de ${who.es} para ${to ?? "un compañero"}.`]
      : [`${cap(who.en)} passes to ${to ?? "a teammate"}.`, `Pase de ${who.es} a ${to ?? "un compañero"}.`],
    "Ball win": [`${cap(who.en)} wins the ball.`, `Recupera ${who.es}.`],
    Turnover: e.cross ? [`${cap(who.en)}'s cross is lost.`, `Se pierde el centro de ${who.es}.`] : [`${cap(who.en)} loses the ball.`, `Pierde el balón ${who.es}.`],
    Cross: [`${cap(who.en)} crosses.`, `Centro de ${who.es}.`],
    Clearance: [`${cap(who.en)} clears.`, `Despeja ${who.es}.`],
    Goal: [`${cap(who.en)} scores${where ? `, ${where.en}` : ""}.`, `Gol de ${who.es}${where ? `, ${where.es}` : ""}.`],
    Shot: e.result === "blocked" ? [`${cap(who.en)}'s shot is blocked.`, `Tiro de ${who.es} bloqueado.`]
      : e.result === "saved" ? [`${cap(who.en)} shot on target${where ? `, ${where.en}` : ""}; the keeper blocks it.`, `Tiro a puerta de ${who.es}${where ? `, ${where.es}` : ""}; el portero lo rechaza.`]
      : e.result === "caught" ? [`${cap(who.en)} shot on target${where ? `, ${where.en}` : ""}; the keeper holds it.`, `Tiro a puerta de ${who.es}${where ? `, ${where.es}` : ""}; el portero lo atrapa.`]
      : e.result === "post" ? [`${cap(who.en)} hits the woodwork.`, `${cap(who.es)} estrella el balón en el palo.`]
      : e.on ? [`${cap(who.en)} shot on target.`, `Tiro a puerta de ${who.es}.`]
      : [`${cap(who.en)} shot off target${where ? `, ${where.en}` : ""}.`, `Tiro fuera de ${who.es}${where ? `, ${where.es}` : ""}.`],
    Save: [`Save by ${who.en}.`, `Parada de ${who.es}.`],
    Foul: [`Foul by ${who.en}.`, `Falta de ${who.es}.`],
    Handball: [`Handball by ${who.en}.`, `Mano de ${who.es}.`],
    Offside: [`${cap(who.en)} caught offside.`, `Fuera de juego de ${who.es}.`],
    Yellow: [`Yellow card for ${who.en}.`, `Amarilla para ${who.es}.`],
    Red: [`Red card for ${who.en}.`, `Roja para ${who.es}.`],
    "Illegal throw-in": [`Illegal throw-in by ${who.en}.`, `Saque de banda mal hecho de ${who.es}.`],
  } as Partial<Record<KeepType, [string, string]>>)[e.type]!;
  return { en, es: es.replace(/\bde el\b/g, "del") };
}

/** "top left corner", "wide right"… from a spot on the goal (0–1 post to post, 0–1 ground to bar). */
export function goalZone([u, v]: [number, number]): Text {
  if (u < 0 || u > 1 || v > 1) {
    if (v > 1 && u >= 0 && u <= 1) return { en: "over the bar", es: "por encima del larguero" };
    return u < 0.5 ? { en: "wide left", es: "desviado por la izquierda" } : { en: "wide right", es: "desviado por la derecha" };
  }
  const col = u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2, row = v > 0.5 ? 0 : 1;
  const en = [["top left corner", "top middle", "top right corner"], ["bottom left corner", "low and central", "bottom right corner"]][row][col];
  const es = [["escuadra izquierda", "arriba al centro", "escuadra derecha"], ["abajo a la izquierda", "abajo al centro", "abajo a la derecha"]][row][col];
  return { en, es };
}

/** Everything the breakdown needs from the log. Names stay in `player`; `d` names positions only.
 *  Written to private/data/raw/<slug>-live.json, which never leaves the coach's PC. */
export function toRaw(s: KeepState, us: string) {
  const st = s.setup;
  if (!st) throw new Error("no setup in this log");
  const len = (h: 1 | 2) => clockStr(s.ends[h] ?? st.halfMin * 60);
  const evs = s.feed.filter((e): e is Ev => e.k === "ev");
  return {
    slug: st.slug, source: "scorekeeper",
    date: st.date, time: st.time, opponent: st.opponent, home: st.home, format: `${st.format}v${st.format}`,
    formation: st.formation ?? null, level: st.level ?? "advanced",
    finished: s.phase === "done",
    score: s.score,
    halfLength: { 1: len(1), 2: len(2) },
    stats: stats(s).map(r => (r.unit ? r : { label: r.label, us: r.us, them: r.them })),
    // The shot map: where each shot was taken from (x along the pitch to their goal, y across), where it went.
    shots: evs.filter(isShot).map(e => ({
      h: e.h, c: e.c, t: e.t, ...(e.pos ? { pos: e.pos } : {}), result: e.type === "Goal" ? "goal" : e.result ?? (e.on ? "on" : "off"),
      ...(e.x != null && e.y != null ? { from: [Math.round(e.x), Math.round(e.y)] } : {}), ...(e.goal ? { goal: e.goal } : {}),
      ...(e.og ? { og: true } : {}),
    })),
    events: evs.map(e => ({
      h: e.h, c: e.c, t: e.t, y: e.type,
      ...(e.on != null ? { on: e.on } : {}), ...(e.result ? { result: e.result } : {}), ...(e.cross ? { cross: true } : {}), ...(e.via ? { via: e.via } : {}), ...(e.og ? { og: true } : {}),
      ...(e.pos ? { pos: e.pos } : {}), ...(e.player ? { player: e.player } : {}), ...(e.opp ? { opp: e.opp } : {}),
      ...(e.to ? { to: e.to, toPos: e.toPos } : {}), ...(e.assist ? { assist: e.assist } : {}),
      ...(e.x != null && e.y != null ? { xy: [Math.round(e.x), Math.round(e.y)] } : {}), ...(e.goal ? { goal: e.goal } : {}),
      d: describe(e, us, st.opponent),
    })),
    lineup: toLineup(s),
    errors: s.errors,
  };
}

/** "2026-10-25-brsc-black" from the date and opponent. */
export const slugFor = (date: string, opponent: string) =>
  `${date}-${opponent.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game"}`;
