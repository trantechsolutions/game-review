import { describe, expect, it } from "vitest";
import { check } from "../../../tools/validate";
// @ts-expect-error plain JS module shared with the build
import { keysFrom, opaque, seal as nodeSeal } from "../../../tools/lib/seal.mjs";
import { Game } from "../schema";
import { aesKey, open, opaqueName } from "./crypto";
import { fixtureGame } from "./fixture";
import { parseMarkup, stripMarkup } from "./markup";
import { deriveNotesKeys, keyHash, openNote, scopeFor, sealNote } from "./notesCrypto";
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
