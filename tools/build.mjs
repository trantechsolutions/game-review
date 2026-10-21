// Encrypts the game data and clips on this PC and lays out public/ next to the built app.
// Only public/ is committed and published.
//
//   private/data/site.json            team name (encrypted into the manifest)
//   private/data/games/<slug>.json    one file per game (app/src/schema.ts), English and Spanish
//   private/data/roster.json          optional squad list with positions (coach-password key)
//   private/data/lineups.json         optional starters and changes per game (coach-password key)
//   private/.keeper-password          optional: seals the scorekeeper's squad list (scorekeeper-password key)
//   private/data/schedule.json        optional team schedule from the manager (tools/manager/manager.ts schedule),
//                                     sealed with the squad list so a new game is set up in one tap
//   private/data/ollie/history.json   optional Ollie Sports game history (tools/ollie/pull.ts); players.json coach key
//   private/clips/<slug>/<id>.mp4     highlight clips (tools/make_highlights.py)
//   dist/app/                         the React app shell from `vite build`; holds no game content
//
// Every data file and clip is AES-256-GCM encrypted under a key derived from the team password and
// gets an opaque name (an HMAC of its path). The browser derives the same key, computes the manifest's
// name, and finds everything else through the manifest.
//
//   npm run build       (vite build, then this; password from private/.site-password or SITE_PASSWORD)
import { spawnSync } from "node:child_process";
import { createHmac, pbkdf2Sync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadR2, r2Client } from "./lib/r2.mjs";
import { keysFrom, opaque, seal } from "./lib/seal.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DFC_DATA || join(ROOT, "private", "data");
const CLIPS = join(ROOT, "private", "clips");
const APP = join(ROOT, "dist", "app");
const OUT = join(ROOT, "public");
const PW_FILE = join(ROOT, "private", ".site-password");
const KDF = JSON.parse(readFileSync(join(ROOT, "tools", "kdf.json"), "utf8"));
const fail = msg => { console.error(msg); process.exit(1); };

const password = process.env.SITE_PASSWORD
  || (existsSync(PW_FILE) ? readFileSync(PW_FILE, "utf8").replace(/^﻿/, "").replace(/\r?\n$/, "") : "");
if (!password) fail(`No password. Put it on one line in ${relative(ROOT, PW_FILE)} (never committed).`);
if (password.length < 12) console.warn("warning: the password is shorter than 12 characters; anyone can download the encrypted files and guess offline.");
if (!existsSync(join(APP, "index.html"))) fail("dist/app is missing. Run `npm run build` (it builds the app first).");

// Schema, cross-references, Spanish and clip files, before anything is written.
const v = spawnSync(process.execPath, [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "tools", "validate.ts")], { stdio: "inherit" });
if (v.status !== 0) fail("Validation failed; nothing was built.");

const keys = keysFrom(password, KDF);

// The coaches' breakdown is sealed with a key from the coach password, so the team password can't open it.
// Same derivation as app/src/lib/notesCrypto.ts: PBKDF2 → master → HMAC("dfc-coach content").
const COACH_PW_FILE = join(ROOT, "private", ".coach-password");
const coachPassword = (process.env.COACH_PASSWORD
  || (existsSync(COACH_PW_FILE) ? readFileSync(COACH_PW_FILE, "utf8") : "")).replace(/^﻿/, "").trim();
if (!coachPassword) fail(`No coach password. Put it on one line in ${relative(ROOT, COACH_PW_FILE)} (never committed).`);
if (coachPassword === password) fail("The coach password must differ from the team password, or anyone on the team could open the coaches' breakdown.");
const NOTES_KDF = JSON.parse(readFileSync(join(ROOT, "tools", "notes-kdf.json"), "utf8"));
const coachMaster = pbkdf2Sync(coachPassword, Buffer.from(NOTES_KDF.salt, "base64"), NOTES_KDF.iterations, 32, "sha256");
const coachKey = createHmac("sha256", coachMaster).update("dfc-coach content").digest();
const coachKeys = { key: coachKey, ivKey: createHmac("sha256", coachKey).update("dfc-film iv derivation").digest() };

const site = JSON.parse(readFileSync(join(DATA, "site.json"), "utf8"));
const games = readdirSync(join(DATA, "games")).filter(f => f.endsWith(".json")).sort()
  .map(f => JSON.parse(readFileSync(join(DATA, "games", f), "utf8")));

// Clips go to Cloudflare R2 when private/.r2.json exists; otherwise they're published in public/.
let r2Config;
try { r2Config = loadR2(join(ROOT, "private", ".r2.json")); } catch (e) { fail(e.message); }
const r2 = r2Config ? r2Client(r2Config) : null;
let inBucket = new Map();
if (r2) {
  try { inBucket = await r2.list(); } catch (e) { fail(`Couldn't reach the R2 bucket (${e.name}). Check the keys in private/.r2.json.`); }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(APP, OUT, { recursive: true });
writeFileSync(join(OUT, "robots.txt"), "User-agent: *\nDisallow: /\n");
writeFileSync(join(OUT, ".nojekyll"), "");

const put = (path, buf) => {
  const name = opaque(keys.nameKey, path);
  const sealed = seal(keys, path, buf);
  writeFileSync(join(OUT, name), sealed);
  return { name, bytes: sealed.length };
};

const uploadedNames = new Set();
let uploaded = 0;

const manifest = { us: site.us, team: site.team, games: [], clips: {} };
let clipBytes = 0, clipCount = 0;
for (const g of games) {
  for (const c of g.highlights.clips) {
    const src = join(CLIPS, g.slug, `${c.id}.mp4`);
    // Same path the first site used, so unchanged clips keep their name and bytes (no re-upload).
    const clipPath = `games/${g.slug}/clips/${c.id}.mp4`;
    let file, bytes;
    if (r2) {
      const name = opaque(keys.nameKey, clipPath);
      const sealed = seal(keys, clipPath, readFileSync(src));
      if (await r2.put(name, sealed, inBucket)) uploaded++;
      uploadedNames.add(name);
      file = r2.url(name); bytes = sealed.length;
    } else {
      ({ name: file, bytes } = put(clipPath, readFileSync(src)));
    }
    manifest.clips[`${g.slug}/${c.id}`] = { file, bytes };
    clipBytes += bytes; clipCount++;
  }
  // The full-game video path stays on this PC; the coaches' breakdown goes in its own coach-key file.
  const { coaches, ...rest } = g;
  const published = { ...rest, highlights: { ...g.highlights, source: "" } };
  const { name } = put(`data/${g.slug}.json`, Buffer.from(JSON.stringify(published), "utf8"));
  const coachPath = `coaches/${g.slug}.json`;
  const coachFile = opaque(keys.nameKey, coachPath);
  writeFileSync(join(OUT, coachFile), seal(coachKeys, coachPath, Buffer.from(JSON.stringify({ coaches }), "utf8")));
  manifest.games.push({ slug: g.slug, date: g.date, time: g.time, opponent: g.opponent, us: g.score.us, them: g.score.them, context: g.listContext, file: name, coachFile });
}
// The roster names players, so like the breakdown it opens only with the coach password.
const ROSTER = join(DATA, "roster.json");
const roster = existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, "utf8")) : null;
if (roster) {
  const rosterPath = "coaches/roster.json";
  manifest.rosterFile = opaque(keys.nameKey, rosterPath);
  writeFileSync(join(OUT, manifest.rosterFile), seal(coachKeys, rosterPath, Buffer.from(JSON.stringify(roster), "utf8")));
}
// Lineups name players too: coach password only.
const LINEUPS = join(DATA, "lineups.json");
if (existsSync(LINEUPS)) {
  const lineupsPath = "coaches/lineups.json";
  manifest.lineupsFile = opaque(keys.nameKey, lineupsPath);
  writeFileSync(join(OUT, manifest.lineupsFile), seal(coachKeys, lineupsPath, Buffer.from(readFileSync(LINEUPS))));
}
// Ollie Sports game history (tools/ollie/pull.ts): team stats with the team key; player stats name players,
// so like the roster they open only with the coach password.
const OLLIE = join(DATA, "ollie");
if (existsSync(join(OLLIE, "history.json"))) {
  const historyPath = "ollie/history.json";
  manifest.ollieFile = opaque(keys.nameKey, historyPath);
  writeFileSync(join(OUT, manifest.ollieFile), seal(keys, historyPath, readFileSync(join(OLLIE, "history.json"))));
  if (existsSync(join(OLLIE, "players.json"))) {
    const playersPath = "coaches/ollie-players.json";
    manifest.olliePlayersFile = opaque(keys.nameKey, playersPath);
    writeFileSync(join(OUT, manifest.olliePlayersFile), seal(coachKeys, playersPath, readFileSync(join(OLLIE, "players.json"))));
  }
}

// The manager's schedule (opponents, venues) rides along with the squad list, under the same key.
const SCHEDULE = join(DATA, "schedule.json");
const schedule = existsSync(SCHEDULE) ? JSON.parse(readFileSync(SCHEDULE, "utf8")) : null;

// The scorekeeper's squad list opens with the scorekeeper password only. Same derivation as
// app/src/lib/keeperCrypto.ts; its file name comes from that key, so scorekeeper mode needs neither the
// team password nor the manifest to find it.
const KEEPER_PW_FILE = join(ROOT, "private", ".keeper-password");
const keeperPassword = (process.env.KEEPER_PASSWORD
  || (existsSync(KEEPER_PW_FILE) ? readFileSync(KEEPER_PW_FILE, "utf8") : "")).replace(/^﻿/, "").trim();
if (keeperPassword && roster) {
  if (keeperPassword === password || keeperPassword === coachPassword) fail("The scorekeeper password must differ from the team and coach passwords.");
  if (keeperPassword.length < 12) console.warn("warning: the scorekeeper password is shorter than 12 characters.");
  const KEEPER_KDF = JSON.parse(readFileSync(join(ROOT, "tools", "keeper-kdf.json"), "utf8"));
  const keeperMaster = pbkdf2Sync(keeperPassword, Buffer.from(KEEPER_KDF.salt, "base64"), KEEPER_KDF.iterations, 32, "sha256");
  const rosterKey = createHmac("sha256", keeperMaster).update("dfc-keeper roster").digest();
  const keeperKeys = { key: rosterKey, ivKey: createHmac("sha256", rosterKey).update("dfc-film iv derivation").digest() };
  const keeperPath = "keeper/roster.json";
  const keeperFile = opaque(createHmac("sha256", rosterKey).update("dfc-film name derivation").digest(), keeperPath);
  writeFileSync(join(OUT, keeperFile), seal(keeperKeys, keeperPath, Buffer.from(JSON.stringify({ us: site.us, players: roster.players, ...(schedule ? { schedule } : {}) }), "utf8")));
} else if (!keeperPassword) console.log(`No ${relative(ROOT, KEEPER_PW_FILE)}: scorekeeper mode stays locked.`);

// Game-list order: newest first; the app keeps this order for same-day games.
manifest.games.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
put("manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));
if (r2) {
  const removed = await r2.prune(uploadedNames, inBucket);
  console.log(`R2: ${uploaded} clip(s) uploaded, ${uploadedNames.size - uploaded} already there, ${removed} old one(s) removed`);
}

// Nothing readable about the team, games or players may appear in the public app files.
const needles = new Set([site.us, ...games.flatMap(g => [g.opponent, g.slug, ...g.highlights.clips.map(c => c.id)]),
  ...(roster?.players ?? []).map(p => p.name), ...(schedule ?? []).map(g => g.opponent).filter(o => o.length >= 3)]);
const leaks = [];
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]);
for (const file of walk(OUT).filter(f => !f.endsWith(".bin"))) {
  const text = readFileSync(file, "utf8");
  for (const n of needles) if (new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`).test(text)) leaks.push(`${relative(ROOT, file)}: "${n}"`);
}
if (leaks.length) { rmSync(OUT, { recursive: true, force: true }); fail(`Readable names in the public app files; public/ was removed:\n  ${leaks.join("\n  ")}`); }

const total = walk(OUT).reduce((s, f) => s + statSync(f).size, 0);
console.log(`encrypted ${games.length} games and ${clipCount} clips (${(clipBytes / 1e6).toFixed(0)} MB); public/ is ${(total / 1e6).toFixed(0)} MB`);
if (total > 950e6) console.warn("warning: public/ is close to GitHub Pages' 1 GB site limit.");
