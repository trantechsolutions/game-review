// Pulls the team's game history from Ollie Sports into private/data/ollie/ (never committed).
//
//   npx tsx tools/ollie/pull.ts [--team "<part of the team name>"]
//   npx tsx tools/ollie/pull.ts --from-raw      rebuilds the files below from the last pull, no sign-in
//
// It serves the saved Ollie web app (docs/reference/ollie-web) on this PC and opens it in a browser window.
// Sign in to Ollie there as usual. The tool then uses that signed-in session to read, straight from Ollie's
// database, every team the account belongs to (or just the one named), each team's games, each game's
// calendar entry (date, opponent) and its stat snapshots (whole game and each half), and the players.
// Nothing about the sign-in is saved by this tool; the browser profile in private/.ollie-profile keeps you
// signed in for the next pull.
//
// Writes:
//   private/data/ollie/history.json   every game with team stats, and the library game it matches (if any)
//   private/data/ollie/players.json   player stats per game (names: sealed with the coach password)
//   private/data/ollie/raw.json       what Ollie returned, for checking fields
// Then run npm run build, which encrypts history.json (team password) and players.json (coach password).
import { chromium, type Page } from "playwright";
import http from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { matchInApp } from "../../app/src/lib/ollie";
import { OllieHistory, OlliePlayers, type OllieGame } from "../../app/src/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "docs", "reference", "ollie-web");
const OUT = join(ROOT, "private", "data", "ollie");
const PROFILE = join(ROOT, "private", ".ollie-profile");
const PROJECT = "ollie-app-95ed8";
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const PORT = 4600;
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const args = process.argv.slice(2);
const teamFilter = args.includes("--team") ? args[args.indexOf("--team") + 1]?.toLowerCase() : undefined;
if (!existsSync(join(WEB, "index.html"))) fail(`No saved Ollie web app at ${WEB}.`);

// ---------- Serve the saved app (root paths, app routes fall back to index.html) ----------
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif", ".ico": "image/x-icon" };
const server = http.createServer((req, res) => {
  let file = join(WEB, normalize(decodeURIComponent((req.url ?? "/").split("?")[0])));
  if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB, "index.html");
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1");

// ---------- The signed-in session ----------
interface AuthUser { uid: string; stsTokenManager: { accessToken: string; expirationTime: number } }

/** The Firebase user the app keeps in IndexedDB, once signed in (without creating the database if it isn't there). */
const readUser = (page: Page) => page.evaluate(async () => {
  const dbs = await indexedDB.databases?.();
  if (!dbs?.some(d => d.name === "firebaseLocalStorageDb")) return null;
  return new Promise<unknown>(resolve => {
    const r = indexedDB.open("firebaseLocalStorageDb");
    r.onerror = () => resolve(null);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("firebaseLocalStorage")) { db.close(); resolve(null); return; }
      const all = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
      all.onsuccess = () => { db.close(); resolve((all.result as { fbase_key: string; value: unknown }[]).find(x => String(x.fbase_key).startsWith("firebase:authUser:"))?.value ?? null); };
      all.onerror = () => { db.close(); resolve(null); };
    };
  });
}) as Promise<AuthUser | null>;

// ---------- Firestore REST ----------
type FsValue = Record<string, unknown>;
/** Firestore's typed values to plain JSON. */
function plain(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("referenceValue" in v) return v.referenceValue;
  if ("arrayValue" in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(plain);
  if ("mapValue" in v) return fields((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {});
  return null;
}
const fields = (f: Record<string, FsValue>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, plain(v)]));
type Doc = Record<string, unknown> & { id: string };
const docOf = (d: { name: string; fields?: Record<string, FsValue> }): Doc => ({ ...fields(d.fields ?? {}), id: d.name.split("/").pop()! });

let token = "";
async function call(url: string, body?: unknown) {
  const res = await fetch(url, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
const eq = (fieldPath: string, value: FsValue) => ({ fieldFilter: { field: { fieldPath }, op: "EQUAL", value } });
async function query(collectionId: string, ...filters: object[]): Promise<Doc[]> {
  const where = filters.length === 1 ? filters[0] : { compositeFilter: { op: "AND", filters } };
  const rows = await call(`${DOCS}:runQuery`, { structuredQuery: { from: [{ collectionId }], where } }) as { document?: { name: string; fields?: Record<string, FsValue> } }[];
  return rows.filter(r => r.document).map(r => docOf(r.document!));
}
async function getMany(collection: string, ids: string[]): Promise<Map<string, Doc>> {
  const out = new Map<string, Doc>();
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await call(`${DOCS}:batchGet`, { documents: ids.slice(i, i + 50).map(id => `projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`) }) as { found?: { name: string; fields?: Record<string, FsValue> } }[];
    for (const r of rows) if (r.found) { const d = docOf(r.found); out.set(d.id, d); }
  }
  return out;
}

// ---------- Reading what came back ----------
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const stats = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).filter(([, x]) => typeof x === "number") as [string, number][]);

/** The date and time an entry starts, in its own time zone. */
function when(entry: Doc | undefined, game: Doc): { date: string; time: string } {
  const raw = entry?.startDateTime ?? entry?.startDate ?? game.officialStartOfGameMS ?? game.createdAtMS;
  const ms = typeof raw === "number" ? raw : Date.parse(str(raw));
  if (!Number.isFinite(ms)) return { date: "1970-01-01", time: "" };
  const tz = str(entry?.timezone) || "America/Chicago";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(ms));
  const p = (t: string) => parts.find(x => x.type === t)?.value ?? "";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour").replace("24", "00")}:${p("minute")}` };
}

function homeOf(entry: Doc | undefined): boolean | null {
  if (!entry) return null;
  const h = str(entry.gameVenue ?? entry.homeAway).toLowerCase();
  return h === "home" ? true : h === "away" ? false : null;
}

const playerName = (p: Doc) => {
  const va = (p.virtualAthleteAccount ?? p.virtualAccount ?? {}) as Record<string, unknown>;
  const first = str(va.firstName ?? p.firstName), last = str(va.lastName ?? p.lastName);
  return `${first} ${last}`.trim() || p.id;
};

// Ollie stores stats under short codes ("tsh" for tShots, "go" for pGoals). The saved web app defines the
// table (SoccerStatKeysObj: e.tShots="tsh"…), so read it from there and store the long names, which the
// app's labels use.
function statKeyNames(): Map<string, string> {
  const dir = join(WEB, "static", "js");
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter(f => f.endsWith(".js"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/\be\.([tpg][A-Z][A-Za-z0-9]*)="([a-z]+)"/g)) out.set(m[2], m[1]);
  }
  if (out.size < 50) fail(`Couldn't read Ollie's stat names from ${dir} (found ${out.size}).`);
  return out;
}

interface RawTeam { team: Doc; games: Doc[]; entries: Record<string, Doc>; snapshots: Doc[]; players: Doc[] }

/** history.json and players.json from what Ollie returned. */
function build(raw: RawTeam[]) {
  const names = statKeyNames();
  const longStats = (v: unknown) => Object.fromEntries(Object.entries(stats(v)).map(([k, x]) => [names.get(k) ?? k, x]));
  const games: OllieGame[] = [];
  const players: OlliePlayers["games"] = {};
  for (const { team, games: soccer, entries, snapshots: snaps, players: people } of raw) {
    const tname = str(team.name) || team.id;
    const nameOf = new Map(people.map(p => [p.id, { name: playerName(p), number: str(p.jerseyNumber) || null }]));
    for (const g of soccer) {
      const entry = entries[str(g.calendarEntryId)];
      // The newest snapshot of each kind for this game (Ollie keeps one per stat-logic version).
      const mine = snaps.filter(sn => str(sn.soccerGameId) === g.id)
        .sort((a, b) => num(b.soccerLogicVersion) - num(a.soccerLogicVersion) || num(b.dateSnapGeneratedMS) - num(a.dateSnapGeneratedMS));
      const pickSnap = (type: string) => mine.find(sn => str(sn.snapshotType) === type);
      const sides = (sn?: Doc) => {
        if (!sn) return null;
        const ts = (sn.teamStats ?? {}) as Record<string, unknown>;
        return { own: longStats(ts.ownTeam), opp: longStats(ts.opponentTeam) };
      };
      const all = pickSnap("all");
      const whole = sides(all);
      const { date, time } = when(entry, g);
      // The final score: the one Ollie showed when the game ended, else the snapshot's goals.
      const score = ((g.officiallyEndedGameSummaryStats ?? {}) as { score?: { ownTeam?: number; opponentTeam?: number } }).score;
      games.push({
        id: g.id, team: tname, date, time,
        opponent: str(entry?.opponentName ?? g.opponentName) || "Opponent",
        home: homeOf(entry),
        us: score?.ownTeam ?? whole?.own.tGoals ?? 0,
        them: score?.opponentTeam ?? whole?.opp.tGoals ?? 0,
        statMode: str(g.statMode) || null,
        inApp: null,
        stats: whole,
        halves: { first: sides(pickSnap("first-half")), second: sides(pickSnap("second-half-plus")) },
      });
      const ps = (all?.playerStats ?? {}) as Record<string, unknown>;
      const rows = Object.entries(ps).map(([pid, st]) => ({ name: nameOf.get(pid)?.name ?? "Unknown player", number: nameOf.get(pid)?.number ?? null, stats: longStats(st) }))
        .filter(r => Object.values(r.stats).some(v => v));
      if (rows.length) players[g.id] = rows;
    }
  }

  // Mark the games the library already has.
  const appDir = join(ROOT, "private", "data", "games");
  const app = existsSync(appDir) ? readdirSync(appDir).filter(f => f.endsWith(".json")).map(f => {
    const j = JSON.parse(readFileSync(join(appDir, f), "utf8"));
    return { slug: j.slug, date: j.date, opponent: j.opponent, us: j.score.us, them: j.score.them };
  }) : [];
  const matched = matchInApp(games, app);
  for (const g of games) g.inApp = matched.get(g.id) ?? null;
  games.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  return { games, players };
}

function write(raw: RawTeam[], pulledAt: string) {
  const { games, players } = build(raw);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "history.json"), JSON.stringify(OllieHistory.parse({ pulledAt, games }), null, 1) + "\n");
  writeFileSync(join(OUT, "players.json"), JSON.stringify(OlliePlayers.parse({ games: players }), null, 1) + "\n");
  const fresh = games.filter(g => !g.inApp);
  console.log(`✓ ${games.length} games (${games.length - fresh.length} already in the library, ${fresh.length} new to it), ${Object.keys(players).length} with player stats → ${join(OUT, "history.json")}`);
  const noStats = games.filter(g => !g.stats).length;
  if (noStats) console.warn(`  ${noStats} games have no stat snapshot (score only).`);
  console.log("Now run npm run build, then commit and push public/.");
}

// ---------- Run ----------
// --from-raw: rebuild history.json and players.json from the last pull, without signing in.
if (args.includes("--from-raw")) {
  const file = join(OUT, "raw.json");
  if (!existsSync(file)) fail(`No ${file} yet: run a pull first.`);
  write(JSON.parse(readFileSync(file, "utf8")), new Date(statSync(file).mtimeMs).toISOString());
  server.close();
  process.exit(0);
}

console.log(`Opening Ollie (saved copy at http://localhost:${PORT}/). Sign in there; this waits up to 10 minutes.`);
mkdirSync(PROFILE, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: null });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`http://localhost:${PORT}/`);
let user: AuthUser | null = null;
for (let i = 0; i < 600 && !user; i++) { user = await readUser(page).catch(() => null); if (!user) await page.waitForTimeout(1000); }
if (!user) { await ctx.close(); server.close(); fail("Not signed in after 10 minutes; nothing was pulled."); }
// Tokens last an hour; the app renews them while it's open, so read the current one before each team.
const refresh = async () => { const u = await readUser(page); if (u) token = u.stsTokenManager.accessToken; };
await refresh();
console.log("Signed in. Reading teams…");

try {
  const teams = (await query("team", eq(`accounts.\`${user!.uid}\`.exists`, { booleanValue: true })))
    .filter(t => !teamFilter || str(t.name).toLowerCase().includes(teamFilter));
  if (!teams.length) fail(teamFilter ? `No team on this account matches "${teamFilter}".` : "This account isn't on any team.");
  console.log(`Teams: ${teams.map(t => str(t.name)).join(" · ")}`);

  const raw: RawTeam[] = [];
  for (const team of teams) {
    await refresh();
    const tname = str(team.name) || team.id;
    const soccer = (await query("soccerGame", eq("teamId", { stringValue: team.id }))).filter(g => str(g.gameStage) === "ended" || num(g.officialEndOfGameMS) > 0);
    const entries = await getMany("calendarEntry", [...new Set(soccer.map(g => str(g.calendarEntryId)).filter(Boolean))]);
    const snaps = await query("soccerStatSnapshot", eq("teamId", { stringValue: team.id })).catch(e => { console.warn(`  snapshots for ${tname}: ${e.message}`); return [] as Doc[]; });
    const people = await query("player", eq("teamId", { stringValue: team.id })).catch(e => { console.warn(`  players for ${tname}: ${e.message}`); return [] as Doc[]; });
    console.log(`  ${tname}: ${soccer.length} finished games, ${snaps.length} stat snapshots, ${people.length} players`);
    raw.push({ team, games: soccer, entries: Object.fromEntries(entries), snapshots: snaps, players: people });
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "raw.json"), JSON.stringify(raw, null, 1) + "\n");
  write(raw, new Date().toISOString());
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await ctx.close();
  server.close();
}
