// The shape of one game's data file (private/data/games/<slug>.json) and of the game list.
// Every piece of prose is a Text: { en, es }. Prose may use a tiny inline markup that
// RichText renders: **bold**, *italic*, `mono`. No HTML is ever rendered from data.
import { z } from "zod";

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
  "Corner", "Throw-in", "Free kick", "Foul", "Yellow", "Red", "Sub",
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
        fixes: z.array(z.object({ pri: Priority, title: Text, body: Text, coach: Text.optional(), ev: z.array(z.string()) }).strict()),
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
}).strict();
export type Manifest = z.infer<typeof Manifest>;
