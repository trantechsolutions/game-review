// The shape of one game's data file (private/data/games/<slug>.json) and of the game list.
// Every piece of prose is a Text: { en, es }. Prose may use a tiny inline markup that
// RichText renders: **bold**, *italic*, `mono`. No HTML is ever rendered from data.
import { z } from "zod";
import { POSITIONS } from "./lib/positions";

export const Text = z.object({ en: z.string().min(1), es: z.string().min(1) }).strict();
export type Text = z.infer<typeof Text>;

const Clock = z.string().regex(/^\d{1,3}:\d{2}$/, "mm:ss");
export const Team = z.enum(["D", "O", "N"]); // DFC, opponent, neutral (whistles)
export type Team = z.infer<typeof Team>;
export const Priority = z.enum(["high", "med", "low"]);
export type Priority = z.infer<typeof Priority>;

export const EVENT_TYPES = [
  "Kickoff", "Half time", "Full time", "Restart",
  "Goal", "Shot", "Save", "Turnover", "Ball win", "Pass", "Run",
  "Cross", "Clearance",
  "Corner", "Throw-in", "Illegal throw-in", "Goal kick", "Free kick", "Penalty", "Offside", "Foul", "Handball", "Yellow", "Red", "Sub",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const GameEvent = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  h: z.union([z.literal(1), z.literal(2)]),
  c: Clock,                       // clock within the half
  t: Team,
  y: z.enum(EVENT_TYPES),
  d: Text,
  on: z.boolean().optional(),     // shot on target
  f: Text.optional(),             // source note, shown in italics
  key: z.boolean().optional(),    // outlined in the match report
}).strict();
export type GameEvent = z.infer<typeof GameEvent>;

const Half = z.object({ title: Text, meta: Text }).strict();

const ReportHalf = z.object({
  eyebrow: Text, title: Text, pills: z.array(Text),
  // Each phase lists event ids; an object form rewords the event (d) or its chip (label) for the report only.
  phases: z.array(z.object({
    title: Text, range: Text, read: Text,
    events: z.array(z.union([z.string(), z.object({ id: z.string(), d: Text.optional(), label: Text.optional() }).strict()])).min(1),
  }).strict()).min(1),
}).strict();

const StatTable = z.object({
  title: Text.nullable(),
  unit: z.string().optional(),     // e.g. "%" for possession rows; per-row below wins
  rows: z.array(z.object({ label: Text, us: z.number(), them: z.number(), unit: z.string().optional() }).strict()).min(1),
}).strict();

const ReportClip = z.object({ t: Team, what: Text, file: z.string(), at: z.string() }).strict();

// What a unit-review improvement works on. Labels live in i18n.tsx (area_<name>).
export const IMPROVEMENT_AREAS = [
  "marking", "reading-play", "body-shape", "formation", "positioning", "communication",
  "pressing", "transition", "first-touch", "passing", "decision-making", "finishing", "set-pieces",
] as const;
export type ImprovementArea = (typeof IMPROVEMENT_AREAS)[number];

const Point = z.object({ text: Text, ev: z.array(z.string()) }).strict();

const UnitReview = z.object({
  unit: z.enum(["defense", "midfield", "attack"]),
  positions: z.string(),           // e.g. "GK · LB · LCB · RCB · RB"
  summary: Text,
  positives: z.array(Point).min(1),
  negatives: z.array(Point).min(1),
  improvements: z.array(z.object({
    area: z.enum(IMPROVEMENT_AREAS),
    title: Text,
    detail: Text,                  // what to do and how to coach it
    ev: z.array(z.string()),       // the moments it comes from, "1H 12:54"
  }).strict()).min(1),
}).strict();

export const HIGHLIGHT_TAGS = ["Goal", "Conceded", "Save", "Chance", "Build-up", "Defending", "Card", "Set piece"] as const;

export const Game = z.object({
  slug: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string(),                 // kickoff "13:30", or "" when unknown
  opponent: z.string(),             // short name used in labels and on the scoreboard
  home: z.boolean().nullable(),     // null when not recorded
  competition: Text,                // long line under the play-by-play score
  listContext: Text,                // the short line in the game list
  score: z.object({ us: z.number(), them: z.number(), htUs: z.number(), htThem: z.number() }).strict(),
  goals: z.array(z.object({ t: Team, label: Text }).strict()),   // the scorer strip, e.g. "**ST** 16'"

  video: z.object({
    kickoff: z.object({ 1: z.number(), 2: z.number() }).strict(),  // seconds into the full-game video
    halfLength: z.object({ 1: Clock, 2: Clock }).strict(),
    // How the "Game" minute column counts: "elapsed" = whole minutes played, "running" = the
    // minute in progress (Ollie's timeline), null = column hidden.
    minute: z.enum(["elapsed", "running"]).nullable(),
    workingClips: z.object({ step: z.number(), len: z.number(), count: z.number(), prefix: z.string() }).strict(),
  }).strict(),

  halves: z.tuple([Half, Half]),
  events: z.array(GameEvent).min(1),
  playByPlayFooter: z.array(Text),

  report: z.object({
    eyebrow: Text,                  // "Full time · ..."
    scorers: z.object({ us: Text, them: Text }).strict(),
    board: z.array(Text),           // the strip under the score
    story: z.object({ eyebrow: Text, title: Text, lede: Text, legendNote: Text.optional() }).strict(),
    halves: z.tuple([ReportHalf, ReportHalf]),
    numbers: z.object({ eyebrow: Text, title: Text, sub: Text.optional(), tables: z.array(StatTable).min(1) }).strict(),
    takeaways: z.object({
      eyebrow: Text, title: Text,
      decidedTitle: Text, decided: z.array(z.object({ title: Text, tag: Text.optional(), body: Text }).strict()),
      workTitle: Text, work: z.array(z.object({ title: Text, tag: Text.optional(), body: Text }).strict()),
    }).strict(),
    clips: z.object({ eyebrow: Text, title: Text, sub: Text, items: z.array(ReportClip) }).strict(),
    footer: z.array(Text),
  }).strict(),

  coaches: z.object({
    eyebrow: Text,
    title: Text, titleAccent: Text.nullable(),  // titleAccent is the coloured tail of the title
    intro: Text,
    meta: z.array(Text),
    priorities: z.object({ eyebrow: Text, title: Text, items: z.array(z.object({ title: Text, body: Text }).strict()).min(1) }).strict(),
    thirds: z.object({
      eyebrow: Text, title: Text, sub: Text,
      zones: z.array(z.object({ name: Text, title: Text, pri: Priority, text: Text, counts: z.array(Text) }).strict()).length(3),
      blocks: z.array(z.object({
        name: Text, title: Text, intro: Text, keep: z.array(Text),
        // area: what the fix works on, so the season overview can rank recurring themes.
        fixes: z.array(z.object({ pri: Priority, area: z.enum(IMPROVEMENT_AREAS), title: Text, body: Text, coach: Text.optional(), ev: z.array(z.string()) }).strict()),
      }).strict()).length(3),
    }).strict(),
    units: z.object({
      eyebrow: Text, title: Text, sub: Text,
      items: z.array(z.object({
        name: Text, pos: z.string(), verdict: Text,
        items: z.array(z.object({ pri: Priority, text: Text, ev: z.array(z.string()) }).strict()),
      }).strict()).min(1),
    }).strict(),
    plan: z.object({
      eyebrow: Text, title: Text, sub: Text,
      sessions: z.array(z.object({ slot: Text, duration: Text, title: Text, items: z.array(Text), fixes: Text.optional() }).strict()),
    }).strict(),
    clips: z.object({
      eyebrow: Text, title: Text, sub: Text,
      rows: z.array(z.object({ topic: Text, moment: Text, file: z.string(), at: z.string(), unit: Text }).strict()),
    }).strict(),
    footer: z.array(Text),
  }).strict(),

  // One review per unit, in this order: defense, midfield, attack.
  unitReviews: z.object({
    intro: Text,
    units: z.tuple([UnitReview, UnitReview, UnitReview]),
  }).strict().refine(r => r.units.map(u => u.unit).join() === "defense,midfield,attack", "units must be defense, midfield, attack"),

  highlights: z.object({
    source: z.string(),             // full-game video on the coach's PC; never published
    clips: z.array(z.object({
      id: z.string().regex(/^[a-z0-9-]+$/),
      label: Text,
      tag: z.enum(HIGHLIGHT_TAGS),
      start: z.string(), end: z.string(),
    }).strict()),
  }).strict(),
}).strict();
export type Game = z.infer<typeof Game>;

// What is published: the team password opens the game file without the coaches' breakdown; the
// coach password opens the breakdown, which is its own file.
export const PublicGame = Game.omit({ coaches: true });
export type PublicGame = z.infer<typeof PublicGame>;
export const CoachContent = z.object({ coaches: Game.shape.coaches }).strict();

// The squad (private/data/roster.json), sealed with the coach-password key like the breakdown.
// Positions are acronyms, first choice first; the coaches' breakdown uses them to suggest who
// could have made a play.
export const Roster = z.object({
  players: z.array(z.object({
    name: z.string().min(1),
    number: z.number().int().nonnegative().nullable().optional(),
    positions: z.array(z.enum(Object.keys(POSITIONS) as [string, ...string[]])),
    managerId: z.string().uuid().optional(), // the player in NOLA DFC Manager (tools/manager/manager.ts roster)
  }).strict()),
}).strict();
export type Roster = z.infer<typeof Roster>;

// Who played where (private/data/lineups.json), sealed with the coach-password key like the roster.
// Players are named exactly as in the roster. A game with no starters listed has no lineup yet.
const Pos = z.enum(Object.keys(POSITIONS) as [string, ...string[]]);
export const LineupChange = z.union([
  // A substitution: `on` takes `off`'s position unless `pos` says otherwise.
  z.object({ h: z.union([z.literal(1), z.literal(2)]), c: Clock, off: z.string().min(1), on: z.string().min(1), pos: Pos.optional() }).strict(),
  // A player already on the field moves to another position.
  z.object({ h: z.union([z.literal(1), z.literal(2)]), c: Clock, player: z.string().min(1), pos: Pos }).strict(),
]);
export type LineupChange = z.infer<typeof LineupChange>;
const Starters = z.array(z.object({ pos: Pos, player: z.string().min(1) }).strict());
export const Lineup = z.object({
  start: Starters,                  // empty: the default starters, if there are any
  changes: z.array(LineupChange),
  estimated: z.boolean().optional(), // worked out from the tape, not from the coach's sheet
}).strict();
export type Lineup = z.infer<typeof Lineup>;
// `default` is the usual starting lineup, used for any game that doesn't list its own starters.
export const Lineups = z.object({ default: z.object({ start: Starters }).strict().optional(), games: z.record(z.string(), Lineup) }).strict();
export type Lineups = z.infer<typeof Lineups>;

// The scorekeeper's squad list (built from roster.json without anything else), sealed with the
// scorekeeper-password key. `us` is our short team name, which the public app code never holds.
// A game in the team's schedule (NOLA DFC Manager; lib/schedule.ts). A tournament is one row for all its games.
export const ScheduledGame = z.object({
  eventId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string(),                 // kickoff "17:00", where the team plays
  title: z.string(),                // as the calendar has it
  opponent: z.string(),             // read from the title; "" when it can't tell
  home: z.boolean().nullable(),     // false when the title says "@"; otherwise not known
  location: z.string(),
  tournament: z.boolean(),
}).strict();
export type ScheduledGame = z.infer<typeof ScheduledGame>;

export const KeeperRoster = z.object({
  us: z.string(),
  players: Roster.shape.players,
  schedule: z.array(ScheduledGame).optional(),
}).strict();
export type KeeperRoster = z.infer<typeof KeeperRoster>;

// A scorekeeper's stat log: one entry per tap, append-only. Undo appends a "void" naming the entry it
// cancels, so logs from two phones merge by id. Times are the half and the clock in it, as in a game file;
// x/y is where on the pitch, 0–100 with us attacking to the right (y = 0 is our left touchline).
export const KEEP_TYPES = [
  "Kickoff", "Pass", "Ball win", "Turnover", "Cross", "Clearance",
  "Goal", "Shot", "Save", "Foul", "Handball", "Offside", "Yellow", "Red",
  "Throw-in", "Illegal throw-in", "Corner", "Goal kick", "Free kick", "Penalty",
] as const;
export type KeepType = (typeof KEEP_TYPES)[number];
const Half12 = z.union([z.literal(1), z.literal(2)]);
export const KeepSetup = z.object({
  slug: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string(),                 // kickoff "13:30", or ""
  opponent: z.string().min(1),
  home: z.boolean().nullable(),
  format: z.number().int().min(1).max(11), // players a side: 7 for 7v7
  formation: z.string().optional(),         // "4-4-2"; keeplog.ts SHAPES
  side: z.enum(["left", "right"]).optional(), // where our goal is in the first half, as the scorekeeper sees it
  halfMin: z.number().int().min(1).max(60),
  stopClock: z.boolean().optional(),        // the clock counts down and stops for goals, cards and subs
  level: z.enum(["beginner", "advanced"]).optional(), // beginner: team stats only, no lineup
  start: Starters,
  eventId: z.string().uuid().optional(),     // the manager's schedule entry it was set up from
}).strict();
export type KeepSetup = z.infer<typeof KeepSetup>;
const Coord = z.number().min(0).max(100);
const EntryBase = { id: z.string().regex(/^[a-z0-9-]{8,40}$/), at: z.number() };
export const KeepEntry = z.discriminatedUnion("k", [
  z.object({ ...EntryBase, k: z.literal("setup"), setup: KeepSetup }).strict(),
  // The clock reads `c` at this moment and is running (or stopped) from here on.
  z.object({ ...EntryBase, k: z.literal("clock"), h: Half12, c: Clock, run: z.boolean() }).strict(),
  z.object({ ...EntryBase, k: z.literal("end"), h: Half12, c: Clock }).strict(),
  z.object({
    ...EntryBase, k: z.literal("ev"), h: Half12, c: Clock, type: z.enum(KEEP_TYPES), t: z.enum(["D", "O"]),
    player: z.string().min(1).optional(),    // ours, by roster name (for an own goal by us, t is "O")
    opp: z.enum(["gk", "pl"]).optional(),    // theirs: their goalkeeper or one of their players
    to: z.string().min(1).optional(),        // a pass's receiver
    cross: z.boolean().optional(),           // a pass or a lost ball that was a cross
    via: z.enum(["pass", "cross", "long"]).optional(), // how a corner or goal kick was played
    on: z.boolean().optional(),              // a shot on target
    result: z.enum(["goal", "saved", "caught", "blocked", "off", "post"]).optional(), // a shot's outcome
    goal: z.tuple([z.number().min(-1).max(2), z.number().min(-1).max(2)]).optional(), // where on the goal: 0–1 post to post, 0–1 ground to bar
    assist: z.string().min(1).optional(),    // a goal's assist, ours
    og: z.boolean().optional(),              // an own goal
    x: Coord.optional(), y: Coord.optional(), // where: the shot was taken, the ball went out
  }).strict(),
  z.object({ ...EntryBase, k: z.literal("sub"), h: Half12, c: Clock, off: z.string().min(1), on: z.string().min(1), pos: Pos.optional() }).strict(),
  z.object({ ...EntryBase, k: z.literal("move"), h: Half12, c: Clock, player: z.string().min(1), pos: Pos }).strict(),
  z.object({ ...EntryBase, k: z.literal("void"), ref: z.string() }).strict(),
]);
export type KeepEntry = z.infer<typeof KeepEntry>;

// Ollie Sports history (tools/ollie/pull.ts → private/data/ollie/), sealed with the team key; player stats name
// players, so they are sealed with the coach-password key. Stat keys are Ollie's own (keeplog-free).
const StatMap = z.record(z.string(), z.number());
const SidePair = z.object({ own: StatMap, opp: StatMap }).strict();
export const OllieGame = z.object({
  id: z.string(),
  team: z.string(),                    // the Ollie team it was recorded for
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string(),
  opponent: z.string(),
  home: z.boolean().nullable(),
  us: z.number(), them: z.number(),
  statMode: z.string().nullable(),     // Ollie's "beginner" (team only) or "advanced" (players too)
  inApp: z.string().nullable(),        // the library game it is, when the library has it
  stats: SidePair.nullable(),          // the whole game
  halves: z.object({ first: SidePair.nullable(), second: SidePair.nullable() }).strict(),
}).strict();
export type OllieGame = z.infer<typeof OllieGame>;
export const OllieHistory = z.object({ pulledAt: z.string(), games: z.array(OllieGame) }).strict();
export type OllieHistory = z.infer<typeof OllieHistory>;
export const OlliePlayers = z.object({
  games: z.record(z.string(), z.array(z.object({ name: z.string(), number: z.string().nullable(), stats: StatMap }).strict())),
}).strict();
export type OlliePlayers = z.infer<typeof OlliePlayers>;

// The decrypted manifest: the game list plus where each encrypted file lives.
export const Manifest = z.object({
  us: z.string(),                   // our short team name; kept out of the public app code
  team: Text,
  games: z.array(z.object({
    slug: z.string(), date: z.string(), time: z.string(), opponent: z.string(),
    us: z.number(), them: z.number(), context: Text, file: z.string(),
    coachFile: z.string(),          // the coaches' breakdown, sealed with the coach-password key
  }).strict()),
  clips: z.record(z.string(), z.object({ file: z.string(), bytes: z.number() }).strict()), // "<slug>/<clip id>"
  rosterFile: z.string().optional(), // the roster, sealed with the coach-password key
  lineupsFile: z.string().optional(), // the lineups, sealed with the coach-password key
  ollieFile: z.string().optional(),   // Ollie Sports game history (team stats)
  olliePlayersFile: z.string().optional(), // its player stats, sealed with the coach-password key
}).strict();
export type Manifest = z.infer<typeof Manifest>;
