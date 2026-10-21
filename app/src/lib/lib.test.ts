import { describe, expect, it } from "vitest";
import { check, checkRoster } from "../../../tools/validate";
// @ts-expect-error plain JS module shared with the build
import { keysFrom, opaque, seal as nodeSeal } from "../../../tools/lib/seal.mjs";
import { Game } from "../schema";
import { aesKey, open, opaqueName } from "./crypto";
import { fixtureGame } from "./fixture";
import { parseMarkup, stripMarkup } from "./markup";
import { candidates, couldPlay, playerLabel, splitPositions } from "./positions";
import { deriveNotesKeys, keyHash, openNote, scopeFor, sealNote } from "./notesCrypto";
import { season, statOf, themes } from "./season";
import { lineupFor, playLineup, positionsOf, secondsOn, whoAt, whoPlayed } from "./lineup";
import { nameMoment } from "./naming";
import { playerSeasons } from "./players";
import { KeepEntry, KeeperRoster, type Lineup } from "../schema";
import { clockAt, clockStr, goalZone, ordered, placeAll, replay, restartFor, SHAPES, slugFor, stats, tapEvent, toLineup, toRaw, type Ev, type EvFields } from "./keeplog";
import { deriveKeeperKeys, keeperScope, KEEPER_ROSTER_PATH, openEntry, sealEntry } from "./keeperCrypto";
import { parseVoice, runVoice, words } from "./voice";
import { gameMinute, mmss, videoSec, workingClip } from "./time";

describe("time", () => {
  const g = fixtureGame();

  it("matches an old play-by-play (kickoffs 04:36 / 42:11, 290 s step)", () => {
    // 1H 15:52 goal: video 20:28, clip05 @ 01:08, game minute 16'
    const goal = { h: 1 as const, c: "15:52" };
    expect(mmss(videoSec(g, goal))).toBe("20:28");
    expect(workingClip(g, videoSec(g, goal))).toMatchObject({ label: "clip05", at: "01:08" });
    expect(gameMinute(g, goal)).toBe(16);
    // 2H 1:17 goal: video 43:28, clip09 @ 04:48, game minute 32'
    const second = { h: 2 as const, c: "1:17" };
    expect(mmss(videoSec(g, second))).toBe("43:28");
    expect(workingClip(g, videoSec(g, second))).toMatchObject({ label: "clip09", at: "04:48" });
    expect(gameMinute(g, second)).toBe(32);
  });

  it("prefers the earlier clip in the overlap", () => {
    expect(workingClip(g, 295)).toMatchObject({ n: 1, at: "04:55" }); // 5 s into clip 2's overlap
    expect(workingClip(g, 300)).toMatchObject({ n: 2, at: "00:10" });
  });

  it("counts elapsed minutes, running minutes, or none", () => {
    const e = { h: 2 as const, c: "0:59" };
    expect(gameMinute(fixtureGame({ video: { ...g.video, minute: "elapsed" } }), e)).toBe(30);
    expect(gameMinute(g, e)).toBe(31);
    expect(gameMinute(fixtureGame({ video: { ...g.video, minute: null } }), e)).toBeNull();
  });
});

describe("position acronyms", () => {
  it("finds whole acronyms (and plurals) with their full names, and nothing inside other words", () => {
    expect(splitPositions("LCB to the LM; STs press. ALM xST", "en")).toEqual([
      { abbr: "LCB", key: "LCB", title: "Left centre-back" }, " to the ", { abbr: "LM", key: "LM", title: "Left midfielder" }, "; ",
      { abbr: "STs", key: "ST", title: "Striker" }, " press. ALM xST",
    ]);
    expect(splitPositions("el GK", "es")).toEqual(["el ", { abbr: "GK", key: "GK", title: "Portero" }]);
  });
});

describe("roster candidates", () => {
  const players = [
    { name: "Ana", number: 4, positions: ["RCB", "RB"] },
    { name: "Bea", number: 2, positions: ["LB", "LCB"] },
    { name: "Cal", number: 9, positions: ["ST"] },
    { name: "Dee", positions: ["CB", "CM"] },
    { name: "Eli", number: 11, positions: ["LM"] },
  ];
  const names = (pos: string) => candidates(pos, players).map(p => p.name);

  it("matches a general acronym to its sided spots and back", () => {
    expect(couldPlay("CB", "LCB")).toBe(true);
    expect(couldPlay("LCB", "CB")).toBe(true);
    expect(couldPlay("LCB", "RCB")).toBe(false);
    expect(couldPlay("LW", "LM")).toBe(true);
    expect(couldPlay("LW", "RM")).toBe(false);
    expect(couldPlay("FW", "ST")).toBe(true);
  });
  it("puts first-choice players ahead of the rest", () => {
    expect(names("CB")).toEqual(["Ana", "Dee", "Bea"]);
    expect(names("RCB")).toEqual(["Ana", "Dee"]);
    expect(names("CM")).toEqual(["Dee"]);
    expect(names("LW")).toEqual(["Eli"]);
    expect(names("GK")).toEqual([]);
  });
  it("labels players with their number when they have one", () => {
    expect(playerLabel(players[0])).toBe("#4 Ana");
    expect(playerLabel(players[3])).toBe("Dee");
  });
  it("splits plurals with the bare acronym as the key", () => {
    expect(splitPositions("both CBs", "en")[1]).toMatchObject({ abbr: "CBs", key: "CB" });
  });
  it("rejects unknown positions and duplicate numbers", () => {
    expect(checkRoster({ players: [{ name: "Ana", positions: ["Sweeper"] }] }).length).toBeGreaterThan(0);
    expect(checkRoster({ players: [{ name: "Ana", number: 4, positions: [] }, { name: "Bea", number: 4, positions: [] }] }))
      .toEqual(["players: duplicate number 4"]);
    expect(checkRoster({ players })).toEqual([]);
  });
});

describe("markup", () => {
  it("parses bold, italic and mono, and nothing else", () => {
    expect(parseMarkup("Half time **1–0** in `full_game.mp4`, *checked*.")).toEqual([
      { kind: "text", text: "Half time " }, { kind: "b", text: "1–0" }, { kind: "text", text: " in " },
      { kind: "mono", text: "full_game.mp4" }, { kind: "text", text: ", " }, { kind: "i", text: "checked" }, { kind: "text", text: "." },
    ]);
  });
  it("leaves HTML as text", () => {
    expect(stripMarkup("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
  it("doesn't treat a lone asterisk as italic", () => {
    expect(parseMarkup("5 * 3 = 15")).toEqual([{ kind: "text", text: "5 * 3 = 15" }]);
  });
});

describe("site crypto", () => {
  const kdf = { salt: "AAAAAAAAAAAAAAAAAAAAAA==", iterations: 1000 };
  it("the browser opens what the build sealed, at the name the build chose", async () => {
    const keys = keysFrom("correct horse battery staple", kdf);
    const plain = Buffer.from(JSON.stringify({ hello: "world" }));
    const sealed: Buffer = nodeSeal(keys, "manifest.json", plain);
    const raw = new Uint8Array(keys.key);
    expect(await opaqueName(raw, "manifest.json")).toBe(opaque(keys.nameKey, "manifest.json"));
    const out = await open(await aesKey(raw), new Uint8Array(sealed));
    expect(new TextDecoder().decode(out)).toBe('{"hello":"world"}');
  });
  it("the wrong key fails", async () => {
    const keys = keysFrom("right", kdf), wrong = keysFrom("wrong", kdf);
    const sealed: Buffer = nodeSeal(keys, "x", Buffer.from("secret"));
    await expect(open(await aesKey(new Uint8Array(wrong.key)), new Uint8Array(sealed))).rejects.toThrow();
  });
  it("is deterministic per content and changes when content changes", () => {
    const keys = keysFrom("pw", kdf);
    expect(nodeSeal(keys, "a", Buffer.from("x")).equals(nodeSeal(keys, "a", Buffer.from("x")))).toBe(true);
    expect(nodeSeal(keys, "a", Buffer.from("x")).subarray(0, 12).equals(nodeSeal(keys, "a", Buffer.from("y")).subarray(0, 12))).toBe(false);
  });
});

describe("notes crypto", () => {
  const kdf = { salt: "foq66j4u1iLA3WRLbh8m6g==", iterations: 1000 };
  it("derives the same keys from the same password, and different ones otherwise", async () => {
    const a = await deriveNotesKeys("coach pass", kdf), b = await deriveNotesKeys("coach pass", kdf), c = await deriveNotesKeys("other", kdf);
    expect(a.accessKey).toBe(b.accessKey);
    expect(a.accessKey).not.toBe(c.accessKey);
    expect(a.accessKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await keyHash(a.accessKey)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("round-trips a note and hides the game in the scope", async () => {
    const k = await deriveNotesKeys("coach pass", kdf);
    const body = { slug: "2026-01-02-test-fc", anchor: "event:2-1000", text: "Great finish", author: "Head coach" };
    const sealed = await sealNote(k.encRaw, body);
    expect(sealed).not.toContain("Great");
    expect(await openNote(k.encRaw, sealed)).toEqual(body);
    const s1 = await scopeFor(k.encRaw, body.slug);
    expect(s1).toMatch(/^[0-9a-f]{32}$/);
    expect(s1).not.toBe(await scopeFor(k.encRaw, "2026-01-03-other"));
    const other = await deriveNotesKeys("other", kdf);
    await expect(openNote(other.encRaw, sealed)).rejects.toThrow();
  });
});

describe("schema and validation", () => {
  it("accepts the fixture", () => {
    expect(Game.safeParse(fixtureGame()).success).toBe(true);
    expect(check(fixtureGame())).toEqual([]);
  });
  it("rejects missing Spanish", () => {
    const g = fixtureGame({ competition: { en: "Friendly", es: "" } });
    expect(check(g).join()).toMatch(/competition\.es/);
  });
  it("rejects a phase pointing at an unknown or other-half event", () => {
    const g = fixtureGame();
    g.report.halves[0].phases[0].events = ["nope", "2-1000"];
    const errs = check(g).join("\n");
    expect(errs).toMatch(/unknown event nope/);
    expect(errs).toMatch(/2-1000 is in the other half/);
  });
  it("flags Spanish copied from English", () => {
    const g = fixtureGame({ listContext: { en: "Came back from behind", es: "Came back from behind" } });
    expect(check(g).join()).toMatch(/listContext: Spanish is identical/);
  });
  it("rejects unit-review evidence that isn't a logged moment", () => {
    const g = fixtureGame();
    g.unitReviews.units[1].negatives[0].ev = ["2H 99:99"];
    expect(check(g).join()).toMatch(/unitReviews\.midfield: "2H 99:99" is not a logged event/);
  });
  it("rejects spelled-out positions but allows unit headings", () => {
    const g = fixtureGame();
    g.events[1].d = { en: "The keeper saves.", es: "El portero para." };
    g.coaches.units.items[0].name = { en: "Goalkeeper", es: "Portero" };
    const errs = check(g).join("\n");
    expect(errs).toMatch(/events\.1\.d\.en: write "keeper"/);
    expect(errs).toMatch(/events\.1\.d\.es: write "portero"/);
    expect(errs).not.toMatch(/units\.items\.0\.name/);
  });
  it("requires the three units in order", () => {
    const g = fixtureGame();
    g.unitReviews.units[0] = { ...g.unitReviews.units[0], unit: "attack" };
    expect(Game.safeParse(g).success).toBe(false);
  });
  it("rejects HTML-looking ids and unknown event types", () => {
    const g = fixtureGame();
    (g.events[1] as { y: string }).y = "Bicycle kick";
    expect(Game.safeParse(g).success).toBe(false);
  });
});

describe("season", () => {
  const T = (en: string) => ({ en, es: en });
  const withStats = (rows: [string, number, number][]) => {
    const g = fixtureGame();
    g.report.numbers.tables = [{ title: null, rows: rows.map(([l, us, them]) => ({ label: T(l), us, them })) }];
    return g;
  };

  it("finds shots, shots on target and possession under their different labels", () => {
    const g = withStats([["Goals", 1, 0], ["Shots", 12, 4], ["On goal", 9, 2], ["Possession %", 61, 39]]);
    expect(statOf(g, "shots")).toEqual([12, 4]);
    expect(statOf(g, "onTarget")).toEqual([9, 2]);
    expect(statOf(g, "possession")).toEqual([61, 39]);
    expect(statOf(withStats([["Shots on goal", 3, 1]]), "shots")).toBeNull(); // "Shots on goal" is not "Shots"
    expect(statOf(withStats([["Shots on goal", 3, 1]]), "onTarget")).toEqual([3, 1]);
  });

  it("totals the record, goal windows, half-time states and repeat opponents", () => {
    const a = fixtureGame(); // 1–0 win, level at half time, goal at 2H 10:00
    const b = fixtureGame({
      slug: "2026-01-09-test-fc", date: "2026-01-09", score: { us: 0, them: 2, htUs: 0, htThem: 1 },
      events: [
        { id: "1-500", h: 1, c: "5:00", t: "O", y: "Goal", d: T("0–1") },
        { id: "2-2500", h: 2, c: "25:00", t: "O", y: "Goal", d: T("0–2") },
      ],
    });
    const s = season([b, a]);
    expect(s.lines.map(l => l.slug)).toEqual([a.slug, b.slug]); // oldest first
    expect(s.record).toMatchObject({ W: 1, D: 0, L: 1, gf: 1, ga: 2, cleanSheets: 1, blanks: 1 });
    expect(s.timing[0]).toEqual([[0, 1], [0, 0], [0, 0]]);
    expect(s.timing[1]).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(s.fromHalfTime.level).toEqual({ W: 1, D: 0, L: 0 });
    expect(s.fromHalfTime.behind).toEqual({ W: 0, D: 0, L: 1 });
    expect(s.repeats).toHaveLength(1);
    expect(s.repeats[0].lines).toHaveLength(2);
  });

  it("ranks themes by games with a high-priority fix, counting each game once", () => {
    const fix = (pri: "high" | "med" | "low", area: "marking" | "finishing") => ({ pri, area, title: T("t"), body: T("b"), ev: [] });
    const withFixes = (date: string, perThird: ReturnType<typeof fix>[][]) => {
      const g = fixtureGame({ date });
      g.coaches.thirds.blocks.forEach((b, i) => { b.fixes = perThird[i] ?? []; });
      return { date, coaches: g.coaches };
    };
    const list = themes([
      withFixes("2026-01-01", [[fix("med", "marking"), fix("med", "marking")], [], [fix("low", "finishing")]]),
      withFixes("2026-01-02", [[fix("high", "finishing")], [], [fix("high", "finishing")]]),
    ]);
    expect(list.map(x => x.area)).toEqual(["finishing", "marking"]); // a high-priority game beats two medium fixes
    expect(list[0]).toMatchObject({ highGames: 1, games: 2, recentHigh: 1, fixes: { high: 2, med: 0, low: 1 }, thirds: [1, 0, 2] });
    expect(list[1]).toMatchObject({ highGames: 0, games: 1, fixes: { med: 2 }, thirds: [2, 0, 0] });
  });

  it("replays a lineup into stints, minutes and who was where", () => {
    const len = { 1: 1800, 2: 1800 };
    const l: Lineup = {
      start: [{ pos: "GK", player: "Ann" }, { pos: "LB", player: "Bea" }, { pos: "ST", player: "Cal" }],
      changes: [
        { h: 1, c: "20:00", off: "Bea", on: "Dee" },              // Dee takes LB
        { h: 2, c: "0:00", player: "Cal", pos: "LM" },             // Cal moves out wide
        { h: 2, c: "10:00", off: "Dee", on: "Bea", pos: "ST" },    // Bea back on, up front
      ],
    };
    const { stints, errors } = playLineup(l, len);
    expect(errors).toEqual([]);
    const on = secondsOn(stints);
    expect(on.get("Ann")).toBe(3600);
    expect(on.get("Bea")).toBe(1200 + 1200);
    expect(on.get("Dee")).toBe(600 + 600); // 1H 20:00 → 2H 10:00
    expect(positionsOf(stints, "Cal")).toEqual(["ST", "LM"]);
    expect(whoAt(stints, "FB", 1500).map(s => s.player)).toEqual(["Dee"]); // FB covers LB
    expect(whoPlayed(stints, "ST").map(p => p.player)).toEqual(["Cal", "Bea"]);
  });

  it("falls back on the default starters and marks that as an estimate", () => {
    const start = [{ pos: "GK", player: "Ann" }];
    const all = { default: { start }, games: {
      a: { start: [], changes: [{ h: 2 as const, c: "0:00", off: "Ann", on: "Bea" }] },
      b: { start: [{ pos: "GK", player: "Cal" }], changes: [] },
    } };
    expect(lineupFor(all, "a")).toMatchObject({ estimated: true, lineup: { start, changes: [{ on: "Bea" }] } });
    expect(lineupFor(all, "b")).toMatchObject({ estimated: false, lineup: { start: [{ player: "Cal" }] } });
    expect(lineupFor(all, "c")).toMatchObject({ estimated: true, lineup: { start, changes: [] } });
    expect(lineupFor({ games: {} }, "c")).toBeNull();
    // "estimated": false confirms the default starters for that game.
    expect(lineupFor({ ...all, games: { d: { start: [], changes: [], estimated: false } } }, "d")).toMatchObject({ estimated: false, lineup: { start } });
  });

  it("names the player at a position in a moment, but not theirs, plurals or ambiguous spots", () => {
    const stints = [
      { player: "Braxx Picado", pos: "GK", from: 0, to: 3600 },
      { player: "Liam Leon", pos: "LCB", from: 0, to: 3600 },
      { player: "Kayden Espana", pos: "RCB", from: 0, to: 3600 },
      { player: "Adam Aly", pos: "ST", from: 0, to: 1000 },
      { player: "Maxx Fejka", pos: "ST", from: 1000, to: 3600 },
    ];
    const n = (s: string, t = 500) => nameMoment(s, stints, t, "BRSC Black", p => p);
    expect(n("The ST shoots; the BRSC GK saves.")).toBe("Adam Aly shoots; the BRSC GK saves.");
    expect(n("The ST shoots.", 2000)).toBe("Maxx Fejka shoots.");
    expect(n("Pass from the **LCB** to our GK.")).toBe("Pass from **Liam Leon** to Braxx Picado.");
    expect(n("El balón llega al GK; el GK de BRSC no llega.")).toBe("El balón llega a Braxx Picado; el GK de BRSC no llega.");
    expect(n("Both CBs step up; the CB clears.")).toBe("Both CBs step up; the CB clears."); // plural, and CB is LCB or RCB
    expect(n("Their RB overlaps.")).toBe("Their RB overlaps.");
  });

  it("reports lineup changes that can't happen", () => {
    const len = { 1: 1800, 2: 1800 };
    const { errors } = playLineup({
      start: [{ pos: "GK", player: "Ann" }, { pos: "CB", player: "Ann" }],
      changes: [
        { h: 2, c: "5:00", off: "Zed", on: "Bea" },
        { h: 1, c: "10:00", player: "Ann", pos: "GK" },
        { h: 1, c: "31:00", off: "Ann", on: "Ann" },
      ],
    }, len);
    expect(errors.join("\n")).toMatch(/Ann is listed twice/);
    expect(errors.join("\n")).toMatch(/Zed isn't on the field/);
    expect(errors.join("\n")).toMatch(/out of time order/);
    expect(errors.join("\n")).toMatch(/after the end of the half/);
  });

  it("finds a player's moments by the position they held at the time", () => {
    const g = fixtureGame({
      events: [
        { id: "1-100", h: 1, c: "1:00", t: "D", y: "Shot", d: T("The **ST** shoots.") },
        { id: "2-100", h: 2, c: "1:00", t: "D", y: "Shot", d: T("The **ST** again.") },
      ],
    });
    const [cal, bea] = playerSeasons(["Cal", "Bea"], [g], { games: { [g.slug]: {
      start: [{ pos: "ST", player: "Cal" }],
      changes: [{ h: 1, c: "30:20", off: "Cal", on: "Bea" }],
    } } });
    expect(cal).toMatchObject({ starts: 1, recorded: 1 });
    expect(cal.games[0].moments.map(m => m.e.id)).toEqual(["1-100"]);
    expect(bea.games[0].moments.map(m => m.e.id)).toEqual(["2-100"]);
    expect(bea.games[0].started).toBe(false);
  });

  it("averages only over the games that recorded a stat", () => {
    const s = season([withStats([["Shots", 10, 2]]), { ...withStats([["Goals", 1, 0]]), slug: "2026-01-03-x", date: "2026-01-03" }]);
    expect(s.avg.shots).toEqual([10, 2]);
    expect(s.avg.possession).toBeNull();
  });
});

describe("scorekeeper log", () => {
  let n = 0;
  const at = () => 1_000_000 + ++n * 1000;
  const id = () => `entry-${String(n).padStart(4, "0")}`;
  const E = (x: Record<string, unknown>) => ({ id: id(), at: at(), ...x }) as KeepEntry;
  const setup = {
    slug: "2026-10-25-rivals", date: "2026-10-25", time: "10:00", opponent: "Rivals", home: true, format: 4, halfMin: 30,
    start: [{ pos: "GK", player: "Gus" }, { pos: "CB", player: "Ana" }, { pos: "CM", player: "Dee" }, { pos: "ST", player: "Cal" }],
  };
  const game = () => {
    n = 0;
    return [
      E({ k: "setup", setup }),
      E({ k: "clock", h: 1, c: "0:00", run: true }),
      E({ k: "ev", h: 1, c: "3:10", type: "Shot", t: "D", player: "Cal", on: true, x: 80, y: 50 }),
      E({ k: "ev", h: 1, c: "4:00", type: "Goal", t: "D", player: "Cal", x: 90, y: 48 }),
      E({ k: "ev", h: 1, c: "6:00", type: "Goal", t: "O", opp: "pl" }),
      E({ k: "ev", h: 1, c: "7:00", type: "Save", t: "O", opp: "gk" }),
      E({ k: "end", h: 1, c: "30:20" }),
      E({ k: "clock", h: 2, c: "0:00", run: true }),
      E({ k: "sub", h: 2, c: "0:00", off: "Cal", on: "Bea" }),
      E({ k: "move", h: 2, c: "5:00", player: "Dee", pos: "LCM" }),
      E({ k: "ev", h: 2, c: "8:00", type: "Throw-in", t: "D" }),
      E({ k: "ev", h: 2, c: "9:00", type: "Yellow", t: "D", player: "Bea" }),
    ];
  };

  it("replays the score, the lineup and the phases", () => {
    const s = replay(game());
    expect(s.score).toEqual({ us: 1, them: 1 });
    expect(s.phase).toBe("live");
    expect(s.ends[1]).toBe(1820);
    expect(s.on).toEqual([{ pos: "GK", player: "Gus" }, { pos: "CB", player: "Ana" }, { pos: "LCM", player: "Dee" }, { pos: "ST", player: "Bea" }]);
    const card = s.feed.find(e => e.k === "ev" && e.type === "Yellow");
    expect(card).toMatchObject({ pos: "ST" });
    expect(s.errors).toEqual([]);
  });

  it("undoes by voiding, and merges two phones' entries in time order", () => {
    const log = game();
    const goal = log.find(e => e.k === "ev" && e.type === "Goal" && e.t === "D")!;
    const voided = [...log, E({ k: "void", ref: goal.id })];
    expect(replay(voided).score).toEqual({ us: 0, them: 1 });
    // Shuffled, as two devices' entries arrive: same result.
    expect(replay([...voided].reverse()).score).toEqual({ us: 0, them: 1 });
    expect(ordered([{ ...log[1], id: "b-entry-x", at: 5 }, { ...log[2], id: "a-entry-x", at: 5 }]).map(e => e.id)).toEqual(["a-entry-x", "b-entry-x"]);
  });

  it("reports a sub for someone not on, and keeps going", () => {
    const s = replay([...game(), E({ k: "sub", h: 2, c: "10:00", off: "Cal", on: "Eli" })]);
    expect(s.errors).toEqual(["2H 10:00: Cal isn't on the field"]);
    expect(s.on.some(p => p.player === "Eli")).toBe(false);
  });

  it("runs the clock from its last reading", () => {
    expect(clockAt({ h: 1, base: 60, since: 10_000 }, 75_500)).toBe(125);
    expect(clockAt({ h: 1, base: 60, since: null }, 75_500)).toBe(60);
    expect(clockStr(125)).toBe("2:05");
  });

  it("exports a lineup that replays cleanly, and numbers and moments named by position", () => {
    const s = replay(game());
    const l = toLineup(s);
    expect(l.changes).toEqual([{ h: 2, c: "0:00", off: "Cal", on: "Bea" }, { h: 2, c: "5:00", player: "Dee", pos: "LCM" }]);
    expect(playLineup(l, { 1: 1820, 2: 1820 }).errors).toEqual([]);
    const raw = toRaw(s, "DFC");
    const row = (en: string) => raw.stats.find(r => r.label.en === en);
    expect(row("Shots")).toMatchObject({ us: 2, them: 1 });
    expect(row("On target")).toMatchObject({ us: 2, them: 1 });
    expect(row("Saves")).toMatchObject({ us: 0, them: 1 });
    expect(raw.halfLength).toEqual({ 1: "30:20", 2: "30:00" });
    expect(raw.events[0]).toMatchObject({ h: 1, c: "3:10", y: "Shot", on: true, pos: "ST", player: "Cal", xy: [80, 50] });
    // Descriptions name positions, never players.
    expect(raw.events.map(e => e.d.en)).toEqual([
      "**ST** shot on target.", "**ST** scores.", "Rivals scores.", "Save by the Rivals **GK**.", "Throw-in to DFC.", "Yellow card for **ST**.",
    ]);
    expect(JSON.stringify(raw.events.map(e => e.d))).not.toMatch(/Cal|Bea/);
    expect(raw.events[3].d.es).toBe("Parada del **GK** de Rivals.");
  });

  it("checks entries and builds slugs", () => {
    expect(KeepEntry.safeParse({ id: "entry-0001", at: 1, k: "ev", h: 1, c: "1:00", type: "Dive", t: "D" }).success).toBe(false);
    expect(KeepEntry.safeParse({ id: "entry-0001", at: 1, k: "ev", h: 1, c: "1:00", type: "Offside", t: "O", opp: "pl", x: 70, y: 20 }).success).toBe(true);
    expect(slugFor("2026-10-25", "BRSC Black (U13)")).toBe("2026-10-25-brsc-black-u13");
    expect(slugFor("2026-10-25", "Atlético")).toBe("2026-10-25-atletico");
    for (const [n, shapes] of Object.entries(SHAPES)) for (const f of shapes) expect(f.slots.length, `${n} ${f.id}`).toBe(Number(n));
  });

  // A log built the way the live screen builds it: each tap asks tapEvent what it means.
  const play = (taps: (["us", string] | ["opp", "gk" | "pl"] | ["ev", EvFields])[]) => {
    n = 0;
    const log: KeepEntry[] = [E({ k: "setup", setup })];
    for (const tap of taps) {
      const s = replay(log);
      if (s.phase === "pre") log.push(E({ k: "clock", h: 1, c: "0:00", run: true }));
      const f = tap[0] === "ev" ? tap[1] : tapEvent(s, tap[0] === "us" ? { t: "D", player: tap[1] } : { t: "O", opp: tap[1] });
      if (f) log.push(E({ k: "ev", h: 1, c: `${n}:00`, ...f }));
    }
    return log;
  };

  it("reads taps as the possession goes: kickoff, passes, losing and winning the ball", () => {
    const log = play([["us", "Cal"], ["us", "Dee"], ["us", "Ana"], ["us", "Ana"], ["opp", "pl"], ["opp", "pl"], ["opp", "gk"], ["us", "Dee"]]);
    const evs = replay(log).feed.filter(e => e.k === "ev").map(e => e.k === "ev" ? [e.type, e.player ?? e.opp, e.to] : []);
    expect(evs).toEqual([
      ["Kickoff", "Cal", undefined], ["Pass", "Cal", "Dee"], ["Pass", "Dee", "Ana"], // tapping the holder again does nothing
      ["Turnover", "Ana", undefined], ["Pass", "pl", undefined], ["Pass", "gk", undefined], // tapping them again: their passes
      ["Ball win", "Dee", undefined],
    ]);
    const s = replay(log);
    expect(s.ball.holder).toEqual({ t: "D", player: "Dee" });
    expect(s.ball.chain).toBe(0);
    expect(replay(log.slice(0, 5)).ball.chain).toBe(2);
    expect(stats(s).find(r => r.label.en === "Passes")).toMatchObject({ us: 2, them: 2 });
    expect(replay(log.slice(0, 8)).ball).toMatchObject({ holder: { t: "O", opp: "gk" }, chain: 2 });
    expect(stats(s).find(r => r.label.en === "Possession")?.unit).toBe("%");
  });

  it("resolves crosses, restarts and shots on the next tap", () => {
    const log = play([
      ["us", "Cal"], ["ev", { type: "Cross", t: "D", player: "Cal" }], ["us", "Dee"],                       // cross completed
      ["ev", { type: "Throw-in", t: "D", player: "Ana", x: 40, y: 0 }], ["opp", "pl"],                       // throw-in lost
      ["ev", { type: "Shot", t: "O", opp: "pl", result: "caught", on: true }], ["us", "Ana"],                // our keeper holds it: Gus has it
      ["ev", { type: "Goal", t: "D", player: "Dee", result: "goal", on: true, goal: [0.9, 0.8], assist: "Ana" }], ["opp", "pl"],
    ]);
    const s = replay(log);
    const types = s.feed.filter(e => e.k === "ev").map(e => (e.k === "ev" ? `${e.type}${e.cross ? "+cross" : ""}:${e.player ?? e.opp}` : ""));
    expect(types).toEqual([
      "Kickoff:Cal", "Cross:Cal", "Pass+cross:Cal", "Throw-in:Ana", "Turnover:Ana", "Shot:pl", "Pass:Gus", "Goal:Dee", "Kickoff:pl",
    ]);
    expect(s.score).toEqual({ us: 1, them: 0 });
    expect(stats(s).find(r => r.label.en === "Saves")).toMatchObject({ us: 1, them: 0 });
    expect(toRaw(s, "DFC").shots).toEqual([
      { h: 1, c: "7:00", t: "O", result: "caught" },
      { h: 1, c: "9:00", t: "D", pos: "CM", result: "goal", goal: [0.9, 0.8] },
    ]);
  });

  it("passes to My Team when the receiver isn't seen, and on from there", () => {
    const s = replay(play([["us", "Cal"], ["ev", { type: "Pass", t: "D", player: "Cal" }], ["us", "Dee"]]));
    const passes = s.feed.filter((e): e is Ev => e.k === "ev" && e.type === "Pass");
    expect(passes.map(e => [e.player, e.to])).toEqual([["Cal", undefined], [undefined, "Dee"]]);
    expect(toRaw(s, "DFC").events[1].d.en).toBe("**ST** passes to a teammate.");
    expect(tapEvent(replay(play([["us", "Cal"]])), { t: "D" })).toEqual({ type: "Pass", t: "D", player: "Cal" });
  });

  it("plays a crossed corner like a cross, and a short one like a pass", () => {
    const s = replay(play([
      ["us", "Cal"], ["ev", { type: "Corner", t: "D", player: "Ana", via: "cross", x: 100, y: 0 }], ["us", "Cal"],
      ["ev", { type: "Corner", t: "D", player: "Ana", via: "pass", x: 100, y: 100 }], ["us", "Dee"],
      ["ev", { type: "Goal kick", t: "O", opp: "gk", via: "long", x: 100, y: 40 }], ["us", "Gus"],
    ]));
    const evs = s.feed.filter((e): e is Ev => e.k === "ev").map(e => `${e.type}${e.cross ? "+cross" : ""}:${e.player ?? e.opp}`);
    expect(evs).toEqual(["Kickoff:Cal", "Corner:Ana", "Pass+cross:Ana", "Corner:Ana", "Pass:Ana", "Goal kick:gk", "Ball win:Gus"]);
    const row = (en: string) => stats(s).find(r => r.label.en === en);
    expect(row("Crosses")).toMatchObject({ us: 1 });
    expect(row("Crosses completed")).toMatchObject({ us: 1 });
    expect(toRaw(s, "DFC").events[1].d.en).toBe("Corner to DFC, crossed in.");
  });

  it("names restarts by the line and the taker, and goal spots by zone", () => {
    expect(restartFor("touch", "O")).toBe("Throw-in");
    expect(restartFor("theirs", "D")).toBe("Corner");
    expect(restartFor("theirs", "O")).toBe("Goal kick");
    expect(restartFor("ours", "O")).toBe("Corner");
    expect(goalZone([0.1, 0.9]).en).toBe("top left corner");
    expect(goalZone([0.5, 0.2]).en).toBe("low and central");
    expect(goalZone([1.3, 0.4]).en).toBe("wide right");
    expect(goalZone([0.5, 1.4]).en).toBe("over the bar");
  });

  it("places players on their formation's spots", () => {
    const placed = placeAll([{ pos: "CM" }, { pos: "LCM" }, { pos: "XX" }], { format: 11, formation: "4-2-3-1" });
    expect(placed.map(p => [p.x, p.y])).toEqual([[60, 50], [38, 38], [50, 50]]);
  });
});

describe("scorekeeper crypto", () => {
  const kdf = { salt: "AAAAAAAAAAAAAAAAAAAAAA==", iterations: 1000 };
  it("opens the roster the build seals, under a name only the password finds", async () => {
    const k = await deriveKeeperKeys("keeper pass", kdf);
    const other = await deriveKeeperKeys("other pass", kdf);
    const { createHmac } = await import("node:crypto");
    const raw = Buffer.from(k.rosterRaw);
    const nameKey = createHmac("sha256", raw).update("dfc-film name derivation").digest();
    const keys = { key: raw, ivKey: createHmac("sha256", raw).update("dfc-film iv derivation").digest() };
    const plain = JSON.stringify({ us: "US", players: [{ name: "Ana", number: 4, positions: ["CB"] }] });
    const sealed = new Uint8Array(nodeSeal(keys, KEEPER_ROSTER_PATH, Buffer.from(plain)));
    expect(await opaqueName(k.rosterRaw, KEEPER_ROSTER_PATH)).toBe(opaque(nameKey, KEEPER_ROSTER_PATH));
    expect(await opaqueName(other.rosterRaw, KEEPER_ROSTER_PATH)).not.toBe(opaque(nameKey, KEEPER_ROSTER_PATH));
    const opened = await open(await aesKey(k.rosterRaw), sealed);
    expect(KeeperRoster.parse(JSON.parse(new TextDecoder().decode(opened))).players[0].name).toBe("Ana");
  });
  it("seals log entries so only the same password opens them, with per-game scopes", async () => {
    const k = await deriveKeeperKeys("keeper pass", kdf), other = await deriveKeeperKeys("other pass", kdf);
    const data = await sealEntry(k.encRaw, { k: "void", ref: "x" });
    expect(await openEntry(k.encRaw, data)).toEqual({ k: "void", ref: "x" });
    await expect(openEntry(other.encRaw, data)).rejects.toThrow();
    expect(await keeperScope(k.encRaw, "a")).toMatch(/^[0-9a-f]{32}$/);
    expect(await keeperScope(k.encRaw, "a")).not.toBe(await keeperScope(k.encRaw, "b"));
    expect(k.accessKey).not.toBe(other.accessKey);
  });
});

describe("voice", () => {
  const players = [
    { name: "Gus Lee", number: 1, positions: ["GK"] }, { name: "Ana Ruiz", number: 4, positions: ["CB"] },
    { name: "Kayden Espana", number: 6, positions: ["CB"] }, { name: "Dee Park", number: 8, positions: ["CM"] },
    { name: "Cal Mason", number: 9, positions: ["ST"] }, { name: "Lucas Rodriguez", number: 10, positions: ["LM"] },
    { name: "Bea Cole", number: 12, positions: ["CM"] }, { name: "Mario Rodriguez", number: 5, positions: ["CB"] },
  ];
  const start = [
    { pos: "GK", player: "Gus Lee" }, { pos: "LCB", player: "Ana Ruiz" }, { pos: "RCB", player: "Kayden Espana" },
    { pos: "CM", player: "Dee Park" }, { pos: "LM", player: "Lucas Rodriguez" }, { pos: "ST", player: "Cal Mason" },
  ];
  const ctx = { players, on: start };
  const cmds = (text: string) => parseVoice(text, ctx);
  const taps = (text: string) => cmds(text).cmds.map(c => (c.k === "tap" ? (c.a.t === "D" ? c.a.player ?? "team" : c.a.opp) : c.k));

  it("reads numbers as digits and splits clauses", () => {
    expect(words("Number nine to twenty-one, then shot")).toEqual([["number", "9", "to", "21"], ["shot"]]);
  });

  it("names players by number, name, misheard name or position", () => {
    expect(taps("9 to 8 to Ana")).toEqual(["Cal Mason", "Dee Park", "Ana Ruiz"]);
    expect(taps("number nine, Kaiden, striker, keeper, left mid")).toEqual(["Cal Mason", "Kayden Espana", "Cal Mason", "Gus Lee", "Lucas Rodriguez"]);
    expect(taps("Rodriguez")).toEqual(["Lucas Rodriguez"]); // Mario is on the bench
    expect(taps("them, their keeper, my team")).toEqual(["pl", "gk", "team"]);
    expect(cmds("center back").error).toMatch(/could be Ana Ruiz or Kayden Espana/);
    expect(cmds("Zed").error).toMatch(/no player I know/);
  });

  it("reads shots, goals, crosses and restarts", () => {
    expect(cmds("Cal shot, keeper saves top left").cmds).toEqual([{ k: "shot", a: { t: "D", player: "Cal Mason" }, result: "saved", goal: [0.15, 0.85] }]);
    expect(cmds("they shoot wide right").cmds).toEqual([{ k: "shot", a: { t: "O", opp: "pl" }, result: "off", goal: [1.2, 0.3] }]);
    expect(cmds("shot off the post").cmds[0]).toMatchObject({ k: "shot", result: "post" });
    expect(cmds("goal 9 assist Dee").cmds).toEqual([{ k: "goal", a: { t: "D", player: "Cal Mason" }, assist: "Dee Park" }]);
    expect(cmds("own goal Ana").cmds).toEqual([{ k: "og", a: { t: "D", player: "Ana Ruiz" } }]);
    expect(cmds("corner us, crossed").cmds).toEqual([{ k: "restart", type: "Corner", side: "D", via: "cross" }]);
    expect(cmds("goal kick them long").cmds).toEqual([{ k: "restart", type: "Goal kick", side: "O", taker: { t: "O", opp: "pl" }, via: "long" }]);
    expect(cmds("throw in 4").cmds).toEqual([{ k: "restart", type: "Throw-in", side: "D", taker: { t: "D", player: "Ana Ruiz" } }]);
    expect(cmds("Lucas crosses").cmds).toEqual([{ k: "cross", a: { t: "D", player: "Lucas Rodriguez" } }]);
  });

  it("reads fouls, cards, subs and the clock", () => {
    expect(cmds("foul on 8").cmds).toEqual([{ k: "inf", what: "Foul", victim: { t: "D", player: "Dee Park" } }]);
    expect(cmds("foul by them, penalty").cmds).toEqual([{ k: "inf", what: "Foul", who: { t: "O", opp: "pl" } }, { k: "restart", type: "Penalty" }]);
    expect(cmds("yellow card Kayden").cmds).toEqual([{ k: "inf", what: "Yellow", who: { t: "D", player: "Kayden Espana" } }]);
    expect(cmds("sub Mario for Dee").cmds).toEqual([{ k: "sub", on: "Mario Rodriguez", off: "Dee Park" }]);
    expect(cmds("Dee off, Bea on").cmds).toEqual([{ k: "sub", on: "Bea Cole", off: "Dee Park" }]);
    expect(cmds("sub Mario for Dee and Bea for Cal").cmds).toEqual([{ k: "sub", on: "Mario Rodriguez", off: "Dee Park" }, { k: "sub", on: "Bea Cole", off: "Cal Mason" }]);
    expect(cmds("Bea for Cal").cmds).toEqual([{ k: "sub", on: "Bea Cole", off: "Cal Mason" }]);
    expect(cmds("Dee moves to striker").cmds).toEqual([{ k: "move", player: "Dee Park", pos: "ST" }]);
    expect(cmds("move 6 to left back").cmds).toEqual([{ k: "move", player: "Kayden Espana", pos: "LB" }]);
    expect(cmds("left mid now plays right wing").cmds).toEqual([{ k: "move", player: "Lucas Rodriguez", pos: "RW" }]);
    expect(cmds("swap Dee and Cal").cmds).toEqual([{ k: "swap", a: "Dee Park", b: "Cal Mason" }]);
    expect(taps("Dee to left mid")).toEqual(["Dee Park", "Lucas Rodriguez"]); // no move word: a pass
    expect(cmds("pause").cmds).toEqual([{ k: "clock", run: false }]);
    expect(cmds("undo").cmds).toEqual([{ k: "undo" }]);
  });

  it("runs a dictated passage against the game", () => {
    const setup = { slug: "2026-10-25-rivals", date: "2026-10-25", time: "", opponent: "Rivals", home: null, format: 6, halfMin: 30, start };
    const log: KeepEntry[] = [{ id: "voice-setup", at: 1_000_000, k: "setup", setup }];
    const say = (text: string) => {
      const p = parseVoice(text, { players, on: replay(log).on });
      expect(p.error).toBeUndefined();
      const steps = runVoice(log, p.cmds, 2_000_000 + log.length * 1000);
      log.push(...steps.flatMap(x => x.entries));
      return steps;
    };
    say("9 kicks off, 9 to 8, 8 to them");
    say("Ana");                          // we win it back
    say("Ana to Cal, shot, keeper saves");
    say("foul by them");                 // after their keeper had it: our free kick
    say("throw in");                     // whose? the side that didn't touch it last (we had the free kick)
    const s = replay(log);
    const evs = s.feed.filter((e): e is Ev => e.k === "ev").map(e => `${e.type}:${e.t}${e.player ? `:${e.player}` : e.opp ? `:${e.opp}` : ""}`);
    expect(evs).toEqual([
      "Kickoff:D:Cal Mason", "Pass:D:Cal Mason", "Turnover:D:Dee Park", "Ball win:D:Ana Ruiz", "Pass:D:Ana Ruiz",
      "Shot:D:Cal Mason", "Foul:O:pl", "Free kick:D", "Throw-in:O:pl",
    ]);
    expect(s.phase).toBe("live");
    const steps = say("undo");
    expect(steps[0].entries[0]).toMatchObject({ k: "void" });
    expect(replay(log).feed.length).toBe(8);
    expect(runVoice(log, [{ k: "sub", on: "Bea Cole", off: "Mario Rodriguez" }], 3_000_000)[0]).toMatchObject({ ok: false, note: "Mario Rodriguez isn't on the field" });
    say("swap Dee and Cal, Ana moves to left back, sub Bea for Kayden");
    expect(replay(log).on).toEqual([
      { pos: "GK", player: "Gus Lee" }, { pos: "LB", player: "Ana Ruiz" }, { pos: "RCB", player: "Bea Cole" },
      { pos: "ST", player: "Dee Park" }, { pos: "LM", player: "Lucas Rodriguez" }, { pos: "CM", player: "Cal Mason" },
    ]);
  });
});
