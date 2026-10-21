// Spoken stat keeping: a dictated line ("9 to 17, shot saved top left", "foul by them", "sub Adam for Jayden")
// becomes the same log entries the taps make. Dictation (Wispr Flow, or the phone's own speech recognition)
// types the words; this reads them. Pure, so the live screen and the tests share it.
//
//   parseVoice(text, ctx)  → commands, each with the words it came from, or a reason it was not understood
//   runVoice(entries, ...) → the entries those commands log, worked out one after another against the game
import type { KeepEntry, KeepType } from "../schema";
import { clockAt, clockStr, newId, replay, tapEvent, type Actor, type EvFields, type KeepState, type Side } from "./keeplog";
import { couldPlay, type RosterPlayer } from "./positions";

// ---------- Commands ----------

type Result = "goal" | "saved" | "caught" | "blocked" | "off" | "post";
export type Cmd =
  | { k: "tap"; a: Actor }
  | { k: "shot"; a?: Actor; result?: Result; goal?: [number, number] }
  | { k: "goal"; a?: Actor; assist?: string; goal?: [number, number] }
  | { k: "og"; a: Actor }
  | { k: "cross" | "clear"; a?: Actor }
  | { k: "restart"; type: KeepType; side?: Side; taker?: Actor; via?: "pass" | "cross" | "long" }
  | { k: "inf"; what: "Foul" | "Handball" | "Offside" | "Yellow" | "Red"; who?: Actor; victim?: Actor; restart?: "Free kick" | "Penalty" | "none" }
  | { k: "illegal" }
  | { k: "sub"; on: string; off: string }
  | { k: "move"; player: string; pos: string }
  | { k: "swap"; a: string; b: string }
  | { k: "clock"; run: boolean }
  | { k: "end" }
  | { k: "undo" };

export interface Parsed { text: string; cmds: Cmd[]; error?: string }

export interface VoiceCtx {
  players: RosterPlayer[];
  on: { player: string; pos: string }[];
}

// ---------- Words ----------

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Words, with number words as digits ("twenty one" → "21") and punctuation as clause breaks. */
export function words(text: string): string[][] {
  const clauses = fold(text).replace(/[“”"']/g, "").split(/[,.;!?]+|\bthen\b|\band then\b/);
  return clauses.map(c => {
    const raw = c.replace(/#/g, " ").replace(/-/g, " ").split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) {
      const w = raw[i];
      if (w in TENS) {
        const u = UNITS.indexOf(raw[i + 1] ?? "");
        if (u > 0 && u < 10) { out.push(String(TENS[w] + u)); i++; } else out.push(String(TENS[w]));
      } else if (UNITS.includes(w)) out.push(String(UNITS.indexOf(w)));
      else out.push(w);
    }
    return out;
  }).filter(c => c.length);
}

// Positions as spoken, longest first so "left center back" wins over "center back".
const POSITION_WORDS: [string, string][] = ([
  ["left center back", "LCB"], ["right center back", "RCB"], ["left centre back", "LCB"], ["right centre back", "RCB"],
  ["left center mid", "LCM"], ["right center mid", "RCM"], ["left central mid", "LCM"], ["right central mid", "RCM"],
  ["center back", "CB"], ["centre back", "CB"], ["center half", "CB"], ["full back", "FB"], ["fullback", "FB"],
  ["left back", "LB"], ["right back", "RB"], ["left mid", "LM"], ["right mid", "RM"], ["left midfielder", "LM"], ["right midfielder", "RM"],
  ["center mid", "CM"], ["centre mid", "CM"], ["central mid", "CM"], ["center midfielder", "CM"], ["midfielder", "CM"],
  ["left wing", "LW"], ["right wing", "RW"], ["left winger", "LW"], ["right winger", "RW"], ["winger", "WM"],
  ["left striker", "LS"], ["right striker", "RS"], ["center forward", "ST"], ["striker", "ST"], ["forward", "FW"],
  ["goalkeeper", "GK"], ["goalie", "GK"], ["keeper", "GK"],
  ["lcb", "LCB"], ["rcb", "RCB"], ["lcm", "LCM"], ["rcm", "RCM"], ["lb", "LB"], ["rb", "RB"], ["cb", "CB"], ["cm", "CM"],
  ["lm", "LM"], ["rm", "RM"], ["lw", "LW"], ["rw", "RW"], ["st", "ST"], ["ls", "LS"], ["rs", "RS"], ["gk", "GK"],
] as [string, string][]).sort((a, b) => b[0].split(" ").length - a[0].split(" ").length);

const THEIR = new Set(["their", "theyre", "opp", "opponent", "opponents", "opposition", "other"]);
const THEM = new Set(["them", "they", "opp", "opponent", "opponents", "opposition", "turnover", "theirs"]);
const US = new Set(["us", "we", "our", "ours", "teammate", "someone", "somebody"]);

// A rough sound-alike key, so a misheard spelling still finds the player ("Kaiden" → Kayden).
const sound = (w: string) => {
  const s = fold(w).replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/[ckq]/g, "k").replace(/[sz]/g, "s").replace(/[vb]/g, "b")
    .replace(/[yi]/g, "i").replace(/(.)\1+/g, "$1");
  return s[0] + s.slice(1).replace(/[aeiouh]/g, "");
};
const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
};

type Ref = { a: Actor; len: number } | { err: string; len: number };

/** The position named at i, as an acronym ("left back" → LB), without looking up who plays there. */
function readPos(t: string[], i: number): { pos: string; len: number } | null {
  for (const [phrase, pos] of POSITION_WORDS) {
    const parts = phrase.split(" ");
    if (parts.every((p, j) => t[i + j] === p)) return { pos, len: parts.length };
  }
  return null;
}

/** Who the words at i name: theirs, ours as a team, or one of ours by number, name or position. */
function readRef(t: string[], i: number, ctx: VoiceCtx, pool: "on" | "bench" | "all" = "on"): Ref | null {
  const w = t[i], w2 = t[i + 1];
  if (!w) return null;
  if ((THEIR.has(w) || w === "the") && ["keeper", "goalkeeper", "goalie", "gk"].includes(w2 ?? "")) return { a: { t: "O", opp: "gk" }, len: 2 };
  if (THEIR.has(w) && ["player", "team", "guy", "girl", "kid"].includes(w2 ?? "")) return { a: { t: "O", opp: "pl" }, len: 2 };
  if (THEM.has(w)) return { a: { t: "O", opp: "pl" }, len: 1 };
  if (w === "my" && w2 === "team") return { a: { t: "D" }, len: 2 };
  if (US.has(w)) return { a: { t: "D" }, len: 1 };

  const onNames = new Set(ctx.on.map(o => o.player));
  const candidates = ctx.players.filter(p => pool === "all" || (pool === "on" ? onNames.has(p.name) : !onNames.has(p.name)));
  const one = (ps: RosterPlayer[], len: number, what: string): Ref =>
    ps.length === 1 ? { a: { t: "D", player: ps[0].name }, len } : { err: ps.length ? `"${what}" could be ${ps.map(p => p.name).join(" or ")}` : `no ${what} on the field`, len };

  // A number: "9", "number 9", "no 9".
  const n = /^\d+$/.test(w) ? w : (w === "number" || w === "no") && /^\d+$/.test(w2 ?? "") ? w2 : null;
  if (n) return one(candidates.filter(p => String(p.number) === n), w === n ? 1 : 2, `#${n}`);

  // A position, held by whoever is there now.
  for (const [phrase, pos] of POSITION_WORDS) {
    const parts = phrase.split(" ");
    if (parts.every((p, j) => t[i + j] === p)) {
      const held = ctx.on.filter(o => couldPlay(pos, o.pos)).map(o => ctx.players.find(p => p.name === o.player)!).filter(Boolean);
      return one(held, parts.length, phrase);
    }
  }

  // A name: full name, then a first or last name, then the nearest spelling or sound.
  const full = candidates.filter(p => fold(p.name) === `${w} ${w2 ?? ""}`.trim());
  if (full.length === 1) return { a: { t: "D", player: full[0].name }, len: 2 };
  if (w.length < 3 || STOP.has(w)) return null;
  const parts = (p: RosterPlayer) => fold(p.name).split(/\s+/);
  const exact = candidates.filter(p => parts(p).includes(w));
  if (exact.length) {
    // "Lucas Rodriguez": a first name that's shared is settled by the surname after it.
    if (exact.length > 1 && w2) { const both = exact.filter(p => parts(p).includes(w2)); if (both.length === 1) return { a: { t: "D", player: both[0].name }, len: 2 }; }
    return one(exact, 1, w);
  }
  const near = candidates.filter(p => parts(p).some(x => (x.length >= 4 && lev(x, w) <= (x.length >= 7 ? 2 : 1)) || (x.length >= 4 && sound(x) === sound(w))));
  return near.length ? one(near, 1, w) : null;
}

// Words that are never a name.
const STOP = new Set([
  "to", "too", "the", "and", "a", "an", "for", "on", "off", "in", "out", "by", "of", "is", "it", "was", "with", "from", "at", "back", "ball",
  "shot", "shoots", "shoot", "saved", "save", "caught", "blocked", "block", "wide", "over", "high", "post", "bar", "crossbar", "goal", "scores",
  "assist", "pass", "passes", "cross", "crosses", "clear", "clears", "clearance", "throw", "corner", "kick", "free", "penalty", "foul",
  "fouled", "handball", "hand", "offside", "yellow", "red", "card", "sub", "substitution", "left", "right", "top", "bottom", "low", "middle",
  "center", "centre", "short", "long", "illegal", "undo", "pause", "stop", "resume", "start", "clock", "half", "time", "full", "end", "play",
  "advantage", "gets", "has", "got", "wins", "won", "loses", "lost", "takes", "took", "kickoff", "kicks", "own", "target", "miss", "missed",
  "head", "header", "strike", "into", "box", "keeps", "now", "again", "possession", "his", "her", "their", "player",
  "move", "moves", "moved", "moving", "plays", "playing", "position", "swap", "swaps", "switch", "switches", "places", "goes", "go",
  "subs", "coming", "comes", "spot", "place",
]);

/** Every player named in a clause, in order. */
function refs(t: string[], ctx: VoiceCtx, pool: "on" | "bench" | "all" = "on"): { list: { a: Actor; at: number }[]; err?: string } {
  const list: { a: Actor; at: number }[] = [];
  for (let i = 0; i < t.length;) {
    const r = readRef(t, i, ctx, pool);
    if (!r) { i++; continue; }
    if ("err" in r) return { list, err: r.err };
    list.push({ a: r.a, at: i });
    i += r.len;
  }
  return { list };
}

const has = (t: string[], ...ws: string[]) => ws.some(w => w.includes(" ") ? t.join(" ").includes(w) : t.includes(w));

/** Where on the goal, if it was said: 0–1 post to post (from the shooter's side), 0–1 ground to bar. */
function goalSpot(t: string[]): { spot?: [number, number]; offTarget?: boolean } {
  const s = t.join(" ");
  const col = /\bleft\b/.test(s) ? 0.15 : /\bright\b/.test(s) ? 0.85 : /\b(middle|center|centre|central)\b/.test(s) ? 0.5 : null;
  if (/\b(wide)\b/.test(s)) return { spot: [col === 0.85 ? 1.2 : col === 0.15 ? -0.2 : 1.2, 0.3], offTarget: true };
  if (/\b(over|high|over the bar)\b/.test(s)) return { spot: [col ?? 0.5, 1.3], offTarget: true };
  const row = /\b(top|upper|high)\b/.test(s) ? 0.85 : /\b(bottom|low|lower|ground|grounded)\b/.test(s) ? 0.15 : null;
  if (col == null && row == null) return {};
  return { spot: [col ?? 0.5, row ?? 0.4] };
}

const RESULT_ONLY = /^((their|the|opp|opponent) )?(keeper|goalie|gk|goalkeeper)? ?(saves?|saved|caught|catches|holds|held|blocked|wide|over|high|post|bar|crossbar|misses|missed|parried|tipped|off target|on target)\b/;

const VIA_ONLY = /^(played |taken |kicked )?(short|crossed|crossed in|cross|long|in the box|into the box)$/;
const SUB_HALF = /^(\S+ ){1,3}(on|off|in|out)$|^(on|off|in|out)( \S+){1,3}$/;

/** Reads one dictated line. Clauses (split by commas, full stops, "then") are read in turn. */
export function parseVoice(text: string, ctx: VoiceCtx): Parsed {
  const cmds: Cmd[] = [];
  // "17 shot, keeper saves": a clause that is only how a shot ended belongs to the shot before it.
  const clauses: string[][] = [];
  for (const t of words(text)) {
    const prev = clauses[clauses.length - 1], line = t.join(" ");
    // Likewise "corner us, crossed" (how it was taken) and "Dee off, Bea on" (the two halves of a sub).
    if (prev && (RESULT_ONLY.test(line) || VIA_ONLY.test(line) || (SUB_HALF.test(line) && SUB_HALF.test(prev.join(" "))))) prev.push(...t);
    else clauses.push(t);
  }
  for (const t of clauses) {
    const r = clause(t, ctx);
    if ("error" in r) return { text, cmds, error: r.error };
    cmds.push(...r.cmds);
  }
  return cmds.length ? { text, cmds } : { text, cmds, error: "nothing I recognise" };
}

function clause(t: string[], ctx: VoiceCtx): { cmds: Cmd[] } | { error: string } {
  const s = t.join(" ");
  const pick = (pool: "on" | "bench" | "all" = "on") => refs(t, ctx, pool);

  if (/^(undo|scratch that|cancel that|delete that|undo that)$/.test(s)) return { cmds: [{ k: "undo" }] };
  if (/\b(pause|stop the clock|stop clock|clock stop)\b/.test(s)) return { cmds: [{ k: "clock", run: false }] };
  if (/\b(resume|restart the clock|start the clock|start clock|clock on|clock start)\b/.test(s)) return { cmds: [{ k: "clock", run: true }] };
  if (/\b(half ?time|end of (the )?half|end (the )?half|full ?time|end of (the )?game|final whistle)\b/.test(s)) return { cmds: [{ k: "end" }] };
  if (/\billegal throw/.test(s)) return { cmds: [{ k: "illegal" }] };

  // Swaps: "swap Dee and Cal", "Dee and Cal switch".
  if (/\b(swap|swaps|swapped|switch|switches|switched|trade places|change places|swap places)\b/.test(s)) {
    const r = pick();
    if (r.err) return { error: r.err };
    const ours = r.list.filter(x => x.a.t === "D" && x.a.player).map(x => (x.a as { player: string }).player);
    if (ours.length !== 2 || ours[0] === ours[1]) return { error: "a swap needs two players on the field" };
    return { cmds: [{ k: "swap", a: ours[0], b: ours[1] }] };
  }

  // Position changes: "Dee moves to striker", "move Dee to left back", "Dee now left back", "Dee plays LB".
  // Plain "Dee to left back" stays a pass to whoever plays left back.
  if (/\b(move|moves|moved|moving|goes to|go to|now at|now plays|now playing|now|plays|playing|to position|position)\b/.test(s)) {
    let at = -1, target: { pos: string; len: number } | null = null;
    for (let i = t.length - 1; i >= 0 && !target; i--) { const p = readPos(t, i); if (p && i + p.len <= t.length) { at = i; target = p; } }
    if (target) {
      const r = refs(t.slice(0, at), ctx);
      if (r.err) return { error: r.err };
      const p = r.list.find(x => x.a.t === "D" && x.a.player)?.a as { player: string } | undefined;
      if (!p) return { error: "who is moving?" };
      return { cmds: [{ k: "move", player: p.player, pos: target.pos }] };
    }
  }

  // Substitutions: "sub Adam for Jayden", "Adam on for Jayden", "Adam in Jayden out", "Jayden off Adam on",
  // "Adam for Jayden", and several at once: "sub Adam for Jayden and Mario for Dee".
  const subWords = /\b(sub|subs|substitution|subbing|on for|in for|coming on|comes on|coming off|goes off)\b/.test(s) || (has(t, "on") && has(t, "off")) || (has(t, "in") && has(t, "out"));
  if (subWords || has(t, "for")) {
    const parts: string[][] = [[]];
    for (const w of t) { if (w === "and") parts.push([]); else parts[parts.length - 1].push(w); }
    const onField = new Set(ctx.on.map(o => o.player));
    const subs: Cmd[] = [];
    for (const part of parts) {
      const all = refs(part, ctx, "all");
      if (all.err) { if (subWords) return { error: all.err }; subs.length = 0; break; }
      const ours = all.list.filter(x => x.a.t === "D" && x.a.player).map(o => (o.a as { player: string }).player);
      // Whoever is on the field is the one coming off, whatever order they were said in.
      const off = ours.length === 2 ? (onField.has(ours[0]) && !onField.has(ours[1]) ? ours[0] : onField.has(ours[1]) && !onField.has(ours[0]) ? ours[1] : null) : null;
      if (!off) { if (subWords) return { error: ours.length === 2 ? "a sub needs one player on the field and one on the bench" : "a sub needs two players" }; subs.length = 0; break; }
      subs.push({ k: "sub", off, on: off === ours[0] ? ours[1] : ours[0] });
    }
    if (subs.length) return { cmds: subs };
  }

  // Own goal, goal.
  if (/\bown goal\b/.test(s)) {
    const r = pick();
    if (r.err) return { error: r.err };
    const a = r.list[0]?.a;
    return a ? { cmds: [{ k: "og", a }] } : { error: "whose own goal?" };
  }
  if (/\b(goal|scores|scored|score)\b/.test(s) && !/\bgoal ?kick\b/.test(s)) {
    const i = t.findIndex(w => /^assist/.test(w));
    const before = i >= 0 ? t.slice(0, i) : t, assistWords = i >= 0 ? t.slice(i + 1) : [];
    const r = refs(before, ctx), ra = refs(assistWords, ctx);
    if (r.err) return { error: r.err };
    if (ra.err) return { error: ra.err };
    const assist = ra.list[0]?.a;
    return { cmds: [{ k: "goal", a: r.list[0]?.a, ...(assist?.t === "D" && assist.player ? { assist: assist.player } : {}), ...(goalSpot(before).spot ? { goal: goalSpot(before).spot } : {}) }] };
  }

  // Shots: "17 shot saved", "shot from Byron, blocked", "they shoot wide", "header off the post".
  if (/\b(shot|shoots|shoot|shooting|header|heads|strike|volley|shot on target|on target|off target)\b/.test(s)) {
    // The keeper in a shot is the one saving it, not the shooter.
    const KEEPER = ["keeper", "goalie", "goalkeeper", "gk"];
    const r = refs(t.filter((w, i) => !KEEPER.includes(w) && !(THEIR.has(w) && KEEPER.includes(t[i + 1] ?? ""))), ctx);
    if (r.err) return { error: r.err };
    const result: Result | undefined = /\b(post|bar|crossbar|woodwork|upright)\b/.test(s) ? "post"
      : /\bblock/.test(s) ? "blocked"
      : /\b(caught|catches|holds|held|claims|claimed)\b/.test(s) ? "caught"
      : /\b(saved|save|saves|parried|parries|tipped|keeper)\b/.test(s) ? "saved"
      : /\b(wide|over|high|off target|miss|missed|misses)\b/.test(s) ? "off" : undefined;
    const g = goalSpot(t);
    return { cmds: [{ k: "shot", a: r.list[0]?.a, ...(result ? { result } : g.offTarget ? { result: "off" } : {}), ...(g.spot ? { goal: g.spot } : {}) }] };
  }

  // Restarts: "throw in us 3", "their corner", "corner us crossed", "goal kick them long", "free kick", "penalty to us".
  const restart: KeepType | null = /\bthrow ?in\b|\bthrow\b/.test(s) ? "Throw-in" : /\bcorner\b/.test(s) ? "Corner"
    : /\bgoal ?kick\b/.test(s) ? "Goal kick" : /\bfree ?kick\b/.test(s) && !/\bfoul|handball|offside\b/.test(s) ? "Free kick"
    : /\b(penalty|pk|spot kick)\b/.test(s) && !/\bfoul|handball\b/.test(s) ? "Penalty" : null;
  if (restart) {
    const r = pick();
    if (r.err) return { error: r.err };
    const taker = r.list.find(x => x.a.t === "D" ? !!x.a.player : true)?.a;
    const side: Side | undefined = r.list.some(x => x.a.t === "O") ? "O" : r.list.some(x => x.a.t === "D") ? "D" : undefined;
    const via = /\b(short|pass|passed)\b/.test(s) ? "pass" as const : /\b(cross|crossed|whipped|in the box|into the box)\b/.test(s) ? "cross" as const : /\b(long|booted|punted)\b/.test(s) ? "long" as const : undefined;
    return { cmds: [{ k: "restart", type: restart, ...(side ? { side } : {}), ...(taker && (taker.t === "O" || taker.player) ? { taker } : {}), ...(via && (restart === "Corner" || restart === "Goal kick") ? { via } : {}) }] };
  }

  // Infractions: "foul by them", "foul on 6" (6 was fouled), "handball 4", "yellow Liam", "offside striker".
  const what = /\b(foul|fouled|fouls)\b/.test(s) ? "Foul" : /\bhand ?ball\b/.test(s) ? "Handball" : /\boffside\b/.test(s) ? "Offside"
    : /\b(yellow|booked|caution)\b/.test(s) ? "Yellow" : /\b(red|sent off|ejected)\b/.test(s) ? "Red" : null;
  if (what) {
    const onIdx = t.indexOf("on");
    const byWords = onIdx >= 0 ? t.slice(0, onIdx) : t, onWords = onIdx >= 0 ? t.slice(onIdx + 1) : [];
    const rb = refs(byWords, ctx), ro = refs(onWords, ctx);
    if (rb.err) return { error: rb.err };
    if (ro.err) return { error: ro.err };
    const restartSaid = /\b(penalty|pk|spot kick)\b/.test(s) ? "Penalty" as const : /\b(advantage|play on|played on)\b/.test(s) ? "none" as const : undefined;
    return { cmds: [{ k: "inf", what, ...(rb.list[0] ? { who: rb.list[0].a } : {}), ...(ro.list[0] ? { victim: ro.list[0].a } : {}), ...(restartSaid ? { restart: restartSaid } : {}) }] };
  }

  if (/\b(cross|crosses|crossed|crossing)\b/.test(s)) {
    const r = pick();
    return r.err ? { error: r.err } : { cmds: [{ k: "cross", a: r.list[0]?.a }] };
  }
  if (/\b(clear|clears|cleared|clearance|boots it|hoofs it)\b/.test(s)) {
    const r = pick();
    return r.err ? { error: r.err } : { cmds: [{ k: "clear", a: r.list[0]?.a }] };
  }

  // Anything else is the ball moving: each player named is the next one on it (a pass, a ball won or lost),
  // just as if they were tapped in that order. "Kickoff 9" and "9 kicks off" work the same way.
  const r = pick();
  if (r.err) return { error: r.err };
  if (!r.list.length) return { error: `"${t.join(" ")}": no player I know` };
  return { cmds: r.list.map(x => ({ k: "tap" as const, a: x.a })) };
}

// ---------- Running the commands against the game ----------

export interface VoiceStep { cmd: Cmd; ok: boolean; note: string; entries: KeepEntry[] }

const who = (a: Actor): Pick<EvFields, "t" | "player" | "opp"> => (a.t === "D" ? { t: "D", ...(a.player ? { player: a.player } : {}) } : { t: "O", opp: a.opp });
const other = (s: Side): Side => (s === "D" ? "O" : "D");

/** Works out the entries a line's commands log, one command at a time against the game as it stands
 *  after the ones before (so "9 to 17, shot" knows 17 has the ball). `undoable` is the id of the entry
 *  an "undo" cancels. Nothing is written: the caller appends the entries, or just shows them (test mode). */
export function runVoice(entries: KeepEntry[], cmds: Cmd[], now: number): VoiceStep[] {
  const added: KeepEntry[] = [];
  const steps: VoiceStep[] = [];
  let at = now;
  const state = () => replay([...entries, ...added]);
  for (const cmd of cmds) {
    const s = state();
    const mine: KeepEntry[] = [];
    const moment = () => ({ h: s.clock.h, c: clockStr(clockAt(s.clock, now)) });
    const push = (e: Omit<KeepEntry, "id" | "at">) => { const full = { ...e, id: newId(), at: at++ } as KeepEntry; mine.push(full); added.push(full); };
    const ev = (f: EvFields) => push({ k: "ev", ...moment(), ...f } as Omit<KeepEntry, "id" | "at">);
    const stopIfNeeded = () => { if (s.setup?.stopClock && s.clock.since != null) push({ k: "clock", h: s.clock.h, c: moment().c, run: false } as Omit<KeepEntry, "id" | "at">); };
    const fail = (note: string) => steps.push({ cmd, ok: false, note, entries: [] });
    const holderOr = (a?: Actor): Actor | undefined => a ?? s.ball.holder ?? (s.ball.loose ? (s.ball.loose.t === "D" ? { t: "D", player: s.ball.loose.player } : { t: "O", opp: "pl" }) : undefined);
    const lastSide = (): Side | undefined => s.ball.holder?.t ?? s.ball.loose?.t;
    if (s.phase === "done" && cmd.k !== "undo") { fail("the game is over"); continue; }

    switch (cmd.k) {
      case "undo": {
        const last = [...s.feed].reverse()[0];
        if (!last) { fail("nothing to undo"); break; }
        push({ k: "void", ref: last.id } as Omit<KeepEntry, "id" | "at">);
        break;
      }
      case "tap": {
        const f = tapEvent(s, cmd.a);
        if (!f) { fail("already has the ball"); break; }
        if (f.type === "Kickoff" && (s.phase === "pre" || s.phase === "break")) {
          const h = s.phase === "break" ? 2 : 1;
          push({ k: "clock", h, c: "0:00", run: true } as Omit<KeepEntry, "id" | "at">);
          push({ k: "ev", h, c: "0:00", ...f } as Omit<KeepEntry, "id" | "at">);
        } else ev(f);
        break;
      }
      case "shot": case "goal": {
        const a = holderOr(cmd.a);
        if (!a) { fail("who took the shot?"); break; }
        if (cmd.k === "goal") {
          ev({ type: "Goal", ...who(a), result: "goal", on: true, ...(cmd.goal ? { goal: cmd.goal } : {}), ...(cmd.assist && cmd.assist !== (a.t === "D" ? a.player : "") ? { assist: cmd.assist } : {}) });
          stopIfNeeded();
        } else {
          const result = cmd.result;
          ev({ type: "Shot", ...who(a), ...(result ? { result } : {}), on: result === "saved" || result === "caught", ...(cmd.goal && result !== "blocked" ? { goal: cmd.goal } : {}) });
        }
        break;
      }
      case "og": {
        ev(cmd.a.t === "D" ? { type: "Goal", t: "O", og: true, ...(cmd.a.player ? { player: cmd.a.player } : {}) } : { type: "Goal", t: "D", og: true, opp: cmd.a.opp });
        stopIfNeeded();
        break;
      }
      case "cross": case "clear": {
        const a = holderOr(cmd.a);
        if (!a) { fail(`who ${cmd.k === "cross" ? "crossed" : "cleared"} it?`); break; }
        ev({ type: cmd.k === "cross" ? "Cross" : "Clearance", ...who(a) });
        break;
      }
      case "restart": {
        // Whose restart: said, or the side that didn't last touch it.
        const side = cmd.taker?.t ?? cmd.side ?? (lastSide() ? other(lastSide()!) : undefined);
        if (!side) { fail(`whose ${cmd.type.toLowerCase()}?`); break; }
        const taker = cmd.taker && cmd.taker.t === side ? who(cmd.taker) : side === "D" ? { t: "D" as const } : { t: "O" as const, opp: (cmd.type === "Goal kick" ? "gk" : "pl") as "gk" | "pl" };
        ev({ type: cmd.type, ...taker, ...(cmd.via ? { via: cmd.via } : {}) });
        break;
      }
      case "inf": {
        // The offender: said ("by them", "handball 4"); or the other side from whoever was fouled; or whoever
        // didn't have the ball.
        const offender = cmd.who ?? (cmd.victim ? (cmd.victim.t === "D" ? { t: "O" as const, opp: "pl" as const } : { t: "D" as const }) : lastSide() ? (lastSide() === "D" ? { t: "O" as const, opp: "pl" as const } : { t: "D" as const }) : undefined);
        if (!offender) { fail("who was it?"); break; }
        ev({ type: cmd.what, ...who(offender) });
        if (cmd.what === "Yellow" || cmd.what === "Red") { stopIfNeeded(); break; }
        const kick = cmd.what === "Offside" ? "Free kick" : cmd.restart ?? "Free kick";
        if (kick !== "none") { const to = other(offender.t); ev({ type: kick, t: to, ...(to === "O" ? { opp: "pl" as const } : {}) }); }
        break;
      }
      case "illegal": {
        const last = [...s.feed].reverse().find(e => e.k === "ev");
        if (last?.k !== "ev" || last.type !== "Throw-in") { fail("the last thing logged wasn't a throw-in"); break; }
        ev({ type: "Illegal throw-in", t: last.t, ...(last.player ? { player: last.player } : {}), ...(last.opp ? { opp: last.opp } : {}) });
        const to = other(last.t);
        ev({ type: "Throw-in", t: to, ...(to === "O" ? { opp: "pl" as const } : {}) });
        break;
      }
      case "move": {
        const p = s.on.find(o => o.player === cmd.player);
        if (!p) { fail(`${cmd.player} isn't on the field`); break; }
        if (p.pos === cmd.pos) { fail(`${cmd.player} is already ${cmd.pos}`); break; }
        push({ k: "move", ...moment(), player: cmd.player, pos: cmd.pos } as Omit<KeepEntry, "id" | "at">);
        break;
      }
      case "swap": {
        const a = s.on.find(o => o.player === cmd.a), b = s.on.find(o => o.player === cmd.b);
        if (!a || !b) { fail(`${!a ? cmd.a : cmd.b} isn't on the field`); break; }
        push({ k: "move", ...moment(), player: a.player, pos: b.pos } as Omit<KeepEntry, "id" | "at">);
        push({ k: "move", ...moment(), player: b.player, pos: a.pos } as Omit<KeepEntry, "id" | "at">);
        break;
      }
      case "sub": {
        if (!s.on.some(o => o.player === cmd.off)) { fail(`${cmd.off} isn't on the field`); break; }
        if (s.on.some(o => o.player === cmd.on)) { fail(`${cmd.on} is already on the field`); break; }
        push({ k: "sub", ...moment(), off: cmd.off, on: cmd.on } as Omit<KeepEntry, "id" | "at">);
        stopIfNeeded();
        break;
      }
      case "clock": {
        if (s.phase !== "live") { fail("the clock starts with the kickoff"); break; }
        if ((s.clock.since != null) === cmd.run) { fail(cmd.run ? "the clock is already running" : "the clock is already stopped"); break; }
        push({ k: "clock", h: s.clock.h, c: moment().c, run: cmd.run } as Omit<KeepEntry, "id" | "at">);
        break;
      }
      case "end": {
        if (s.phase !== "live") { fail("no half in play"); break; }
        push({ k: "end", h: s.clock.h, c: moment().c } as Omit<KeepEntry, "id" | "at">);
        break;
      }
    }
    if (mine.length || !steps.some(x => x.cmd === cmd)) steps.push({ cmd, ok: !!mine.length, note: mine.length ? "" : "nothing to log", entries: mine });
  }
  return steps;
}

export type { KeepState };
