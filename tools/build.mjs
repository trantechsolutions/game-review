// Encrypts the game data and clips on this PC and lays out public/ next to the built app.
// Only public/ is committed and published.
//
//   private/data/site.json            team name (encrypted into the manifest)
//   private/data/games/<slug>.json    one file per game (app/src/schema.ts), English and Spanish
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

const manifest = { us: site.us, team: site.team, games: [], clips: {} };
let clipBytes = 0, clipCount = 0;
for (const g of games) {
  for (const c of g.highlights.clips) {
    const src = join(CLIPS, g.slug, `${c.id}.mp4`);
    // Same path the first site used, so unchanged clips keep their name and bytes (no re-upload).
    const { name, bytes } = put(`games/${g.slug}/clips/${c.id}.mp4`, readFileSync(src));
    manifest.clips[`${g.slug}/${c.id}`] = { file: name, bytes };
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
// Game-list order: newest first; the app keeps this order for same-day games.
manifest.games.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
put("manifest.json", Buffer.from(JSON.stringify(manifest), "utf8"));

// Nothing readable about the team, games or players may appear in the public app files.
const needles = new Set([site.us, ...games.flatMap(g => [g.opponent, g.slug, ...g.highlights.clips.map(c => c.id)])]);
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
