// A small, made-up game that satisfies the schema. Used by tests only.
import type { Game } from "../schema";

const T = (en: string) => ({ en, es: `ES ${en}` });

export function fixtureGame(over: Partial<Game> = {}): Game {
  return {
    slug: "2026-01-02-test-fc",
    date: "2026-01-02", time: "10:00", opponent: "Test FC", home: true,
    competition: T("Friendly"), listContext: T("Friendly · Home"),
    score: { us: 1, them: 0, htUs: 0, htThem: 0 },
    goals: [{ t: "D", label: T("**ST** 40'") }],
    video: {
      kickoff: { 1: 276, 2: 2531 }, halfLength: { 1: "30:20", 2: "30:20" },
      minute: "running", workingClips: { step: 290, len: 300, count: 16, prefix: "clip" },
    },
    halves: [{ title: T("First half"), meta: T("meta") }, { title: T("Second half"), meta: T("meta") }],
    events: [
      { id: "1-000", h: 1, c: "0:00", t: "N", y: "Kickoff", d: T("Kickoff") },
      { id: "2-1000", h: 2, c: "10:00", t: "D", y: "Goal", d: T("Goal. 1–0.") },
    ],
    playByPlayFooter: [T("footer")],
    report: {
      eyebrow: T("Full time"), scorers: { us: T("ST 40'"), them: T("none") }, board: [T("Half time **0–0**")],
      story: { eyebrow: T("Story"), title: T("Title"), lede: T("Lede") },
      halves: [
        { eyebrow: T("e"), title: T("t"), pills: [T("p")], phases: [{ title: T("t"), range: T("0:00 – 0:00"), read: T("r"), events: ["1-000"] }] },
        { eyebrow: T("e"), title: T("t"), pills: [T("p")], phases: [{ title: T("t"), range: T("10:00"), read: T("r"), events: [{ id: "2-1000", d: T("Reworded") }] }] },
      ],
      numbers: { eyebrow: T("e"), title: T("t"), tables: [{ title: null, rows: [{ label: T("Goals"), us: 1, them: 0 }] }] },
      takeaways: { eyebrow: T("e"), title: T("t"), decidedTitle: T("d"), decided: [], workTitle: T("w"), work: [] },
      clips: { eyebrow: T("e"), title: T("t"), sub: T("s"), items: [] },
      footer: [],
    },
    coaches: {
      eyebrow: T("e"), title: T("Title"), titleAccent: null, intro: T("Intro"), meta: [],
      priorities: { eyebrow: T("e"), title: T("t"), items: [{ title: T("t"), body: T("b") }] },
      thirds: {
        eyebrow: T("e"), title: T("t"), sub: T("s"),
        zones: [0, 1, 2].map(() => ({ name: T("n"), title: T("t"), pri: "high" as const, text: T("x"), counts: [] })),
        blocks: [0, 1, 2].map(() => ({ name: T("n"), title: T("t"), intro: T("i"), keep: [], fixes: [] })),
      },
      units: { eyebrow: T("e"), title: T("t"), sub: T("s"), items: [{ name: T("GK"), pos: "GK", verdict: T("v"), items: [] }] },
      plan: { eyebrow: T("e"), title: T("t"), sub: T("s"), sessions: [] },
      clips: { eyebrow: T("e"), title: T("t"), sub: T("s"), rows: [] },
      footer: [],
    },
    unitReviews: {
      intro: T("Intro"),
      units: (["defense", "midfield", "attack"] as const).map(unit => ({
        unit, positions: "GK", summary: T("Summary"),
        positives: [{ text: T("Good"), ev: ["1H 0:00"] }],
        negatives: [{ text: T("Bad"), ev: [] }],
        improvements: [{ area: "marking" as const, title: T("Mark"), detail: T("Detail"), ev: [] }],
      })) as unknown as Game["unitReviews"]["units"],
    },
    highlights: { source: "", clips: [{ id: "01-goal", label: T("Goal"), tag: "Goal", start: "45:00", end: "46:00" }] },
    ...over,
  };
}
