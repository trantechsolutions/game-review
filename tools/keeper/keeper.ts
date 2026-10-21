// Scorekeeper admin and import, run on the coach's PC. Reads the scorekeeper password from
// private/.keeper-password (one line, never committed).
//
//   npx tsx tools/keeper/keeper.ts setup-sql      writes private/keeper-setup.sql: tools/keeper/setup.sql with the
//                                                key's fingerprint filled in. Paste it into Supabase → SQL Editor.
//   npx tsx tools/keeper/keeper.ts check          writes, reads and removes a test entry, and confirms the logs
//                                                can't be reached without the scorekeeper password
//   npx tsx tools/keeper/keeper.ts games          lists every game in the stat logs
//   npx tsx tools/keeper/keeper.ts pull <slug> [--as <game-slug>] [--force]
//                                                writes private/data/raw/<game-slug>-live.json (moments, numbers,
//                                                lineup) and, once private/data/games/<game-slug>.json exists, the
//                                                game's lineup in private/data/lineups.json
//   npx tsx tools/keeper/keeper.ts forget <slug>  removes a whole game from the stat logs (a test, or a duplicate).
//                                                Phones that still hold it locally keep their copy.
//   npx tsx tools/keeper/keeper.ts rotate         changes the scorekeeper password to private/.keeper-password.new:
//                                                re-encrypts every entry under the new key, switches the database
//                                                to it, then replaces .keeper-password. Rebuild afterwards.
import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEEPER_KDF, SUPABASE_ANON_KEY, SUPABASE_URL } from "../../app/src/config";
import { replay, toRaw } from "../../app/src/lib/keeplog";
import { deriveKeeperKeys, keeperScope, openEntry, sealEntry, type KeeperKeys } from "../../app/src/lib/keeperCrypto";
import { keyHash } from "../../app/src/lib/notesCrypto";
import { halfLengths, playLineup } from "../../app/src/lib/lineup";
import { sec } from "../../app/src/lib/time";
import { KeepEntry, Lineups, type Lineup } from "../../app/src/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = process.env.DFC_DATA || join(ROOT, "private", "data");
const PW = join(ROOT, "private", ".keeper-password");
const NEW_PW = join(ROOT, "private", ".keeper-password.new");
const TEST_SCOPE = "0".repeat(32);
const fail = (msg: string): never => { console.error(msg); process.exit(1); };

const readPw = (f: string) => {
  if (!existsSync(f)) fail(`Put the scorekeeper password on one line in ${f} (never committed).`);
  const pw = readFileSync(f, "utf8").replace(/^﻿/, "").trim();
  if (!pw) fail(`${f} is empty. Save the scorekeeper password in it (one line) first.`);
  return pw;
};

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const [cmd, ...args] = process.argv.slice(2);
const keys = await deriveKeeperKeys(readPw(PW), KEEPER_KDF);

async function requireKey(k: string) {
  const { data, error } = await sb.rpc("keeper_check", { p_key: k });
  if (error) fail(`The stat-log functions aren't set up: ${error.message}. Run setup-sql and paste private/keeper-setup.sql into Supabase.`);
  if (data !== true) fail("The database doesn't accept this scorekeeper password. Run setup-sql again and paste the new file.");
}

interface Row { id: string; scope: string; data: string }

/** Every entry, grouped by game slug (from each game's setup entry). */
async function allGames(k: KeeperKeys) {
  const { data, error } = await sb.rpc("keeper_list", { p_key: k.accessKey, p_scope: null });
  if (error) fail(error.message);
  const byScope = new Map<string, { rows: Row[]; entries: KeepEntry[] }>();
  let unreadable = 0;
  for (const r of data as Row[]) {
    if (r.scope === TEST_SCOPE) continue;
    const g = byScope.get(r.scope) ?? { rows: [], entries: [] };
    try { g.entries.push(KeepEntry.parse(await openEntry(k.encRaw, r.data))); g.rows.push(r); } catch { unreadable++; }
    byScope.set(r.scope, g);
  }
  const games = new Map<string, { scope: string; rows: Row[]; entries: KeepEntry[] }>();
  for (const [scope, g] of byScope) {
    const slug = g.entries.find(e => e.k === "setup")?.setup.slug;
    if (slug) games.set(slug, { scope, ...g });
  }
  return { games, unreadable };
}

// One game's block in lineups.json, in the file's hand-kept style: one starter or change per line.
const line = (o: object) => JSON.stringify(o).replace(/^\{/, "{ ").replace(/\}$/, " }").replace(/","/g, '", "').replace(/":/g, '": ').replace(/,"/g, ', "');
function lineupBlock(slug: string, l: Lineup) {
  const list = (xs: object[]) => (xs.length ? `[\n${xs.map(x => `        ${line(x)}`).join(",\n")}\n      ]` : "[]");
  return `    ${JSON.stringify(slug)}: {\n      "start": ${list(l.start)},\n      "changes": ${list(l.changes)}\n    }`;
}

/** Puts a game's lineup into lineups.json text, replacing that game's block if it has one. */
function spliceLineup(text: string, slug: string, l: Lineup): string {
  const games = text.indexOf('"games"');
  if (games < 0) fail("lineups.json has no \"games\" object");
  const key = text.indexOf(`\n    ${JSON.stringify(slug)}: {`, games);
  if (key >= 0) {
    let depth = 0, i = text.indexOf("{", key);
    for (; i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}" && --depth === 0) break; }
    return text.slice(0, key + 1) + lineupBlock(slug, l) + text.slice(i + 1);
  }
  const close = text.lastIndexOf("\n  }");
  const before = text.slice(0, close).trimEnd();
  const empty = before.endsWith("{");
  return `${before}${empty ? "" : ","}\n${lineupBlock(slug, l)}${text.slice(close)}`;
}

if (cmd === "setup-sql") {
  const sql = readFileSync(join(ROOT, "tools", "keeper", "setup.sql"), "utf8").replace("__KEY_HASH__", await keyHash(keys.accessKey));
  const out = join(ROOT, "private", "keeper-setup.sql");
  writeFileSync(out, sql);
  console.log(`wrote ${out}\nPaste it into Supabase → SQL Editor → Run, then run: npx tsx tools/keeper/keeper.ts check`);
} else if (cmd === "check") {
  await requireKey(keys.accessKey);
  const id = crypto.randomUUID();
  const data = await sealEntry(keys.encRaw, { check: true });
  const sent = await sb.rpc("keeper_append", { p_key: keys.accessKey, p_rows: [{ id, scope: TEST_SCOPE, data }] });
  if (sent.error) fail(`append failed: ${sent.error.message}`);
  const again = await sb.rpc("keeper_append", { p_key: keys.accessKey, p_rows: [{ id, scope: TEST_SCOPE, data }] });
  const listed = await sb.rpc("keeper_list", { p_key: keys.accessKey, p_scope: TEST_SCOPE });
  if (listed.error) fail(`list failed: ${listed.error.message}`);
  const row = (listed.data as Row[]).find(r => r.id === id);
  if (!row) fail("the test entry didn't come back");
  const body = await openEntry(keys.encRaw, row!.data) as { check?: boolean };
  const direct = await sb.from("keeper_log").select("id").limit(1);
  const guessed = await sb.rpc("keeper_list", { p_key: "not-the-key", p_scope: null });
  const del = await sb.rpc("keeper_delete_test", { p_key: keys.accessKey, p_id: id });
  if (del.error) fail(`removing the test entry failed: ${del.error.message}`);
  if (again.error || again.data !== 0) fail("✗ sending the same entry twice stored it twice. Re-run the setup SQL.");
  if (!direct.error && direct.data.length) fail("✗ the stat-log table is readable without the scorekeeper password. Re-run the setup SQL.");
  if (!guessed.error) fail("✗ the stat-log functions answered a wrong key. Re-run the setup SQL.");
  console.log(`✓ stat logs work: sent, re-sent (ignored), read (${body.check ? "decrypted" : "?"}) and removed a test entry; a wrong key and direct table access are refused`);
} else if (cmd === "games") {
  await requireKey(keys.accessKey);
  const { games, unreadable } = await allGames(keys);
  if (!games.size) console.log("No games in the stat logs yet.");
  for (const [slug, g] of [...games].sort()) {
    const s = replay(g.entries);
    console.log(`${slug}  ${s.setup!.format}v${s.setup!.format}  ${s.score.us}–${s.score.them} ${s.setup!.opponent}  ${s.phase}  ${g.entries.length} entries`);
  }
  if (unreadable) console.warn(`(${unreadable} entries under another scorekeeper password were skipped)`);
} else if (cmd === "pull") {
  const slug = args[0] ?? fail("usage: keeper.ts pull <slug> [--as <game-slug>] [--force]");
  const asIdx = args.indexOf("--as");
  const target = asIdx >= 0 ? args[asIdx + 1] ?? fail("--as needs the game's slug") : slug;
  const force = args.includes("--force");
  await requireKey(keys.accessKey);
  const { games } = await allGames(keys);
  const g = games.get(slug) ?? fail(`No game ${slug} in the stat logs. Run: npx tsx tools/keeper/keeper.ts games`);
  const s = replay(g.entries);
  const site = JSON.parse(readFileSync(join(DATA, "site.json"), "utf8"));
  const raw = { ...toRaw(s, site.us), slug: target, keeperSlug: slug };
  const rawDir = join(DATA, "raw");
  mkdirSync(rawDir, { recursive: true });
  const rawFile = join(rawDir, `${target}-live.json`);
  writeFileSync(rawFile, JSON.stringify(raw, null, 1) + "\n");
  console.log(`wrote ${rawFile}: ${raw.score.us}–${raw.score.them}, ${raw.events.length} moments, ${raw.lineup.changes.length} lineup changes${s.phase === "done" ? "" : ` (the game isn't at full time yet: ${s.phase})`}`);
  for (const e of s.errors) console.warn(`  ! ${e}`);

  const gameFile = join(DATA, "games", `${target}.json`);
  if (!existsSync(gameFile)) {
    console.log(`No ${target}.json game file yet, so lineups.json is unchanged. Run pull again once the game file exists.`);
  } else if (!raw.lineup.start.length) {
    console.log("The log has no starters, so lineups.json is unchanged.");
  } else {
    const game = JSON.parse(readFileSync(gameFile, "utf8"));
    // The validator replays the lineup against the tape's half lengths; a change past them would fail it.
    const len = halfLengths(game);
    for (const c of raw.lineup.changes) if (sec(c.c) > len[c.h]) console.warn(`  ! ${c.h}H ${c.c}: after the half ends on the tape (${game.video.halfLength[c.h]}); adjust it in lineups.json`);
    for (const e of playLineup(raw.lineup, len).errors) console.warn(`  ! ${e}`);
    const LINEUPS = join(DATA, "lineups.json");
    const text = existsSync(LINEUPS) ? readFileSync(LINEUPS, "utf8") : '{\n  "games": {\n  }\n}\n';
    const current = Lineups.parse(JSON.parse(text));
    const had = current.games[target];
    if (had?.start.length && !had.estimated && !force) fail(`lineups.json already has a confirmed lineup for ${target}. Add --force to replace it.`);
    const next = spliceLineup(text, target, raw.lineup);
    Lineups.parse(JSON.parse(next));
    writeFileSync(LINEUPS, next);
    console.log(`${had ? "replaced" : "added"} ${target} in ${LINEUPS} (${raw.lineup.start.length} starters, ${raw.lineup.changes.length} changes). Run npm run validate.`);
  }
} else if (cmd === "forget") {
  const slug = args[0] ?? fail("usage: keeper.ts forget <slug>");
  await requireKey(keys.accessKey);
  const { games } = await allGames(keys);
  const g = games.get(slug) ?? fail(`No game ${slug} in the stat logs. Run: npx tsx tools/keeper/keeper.ts games`);
  const { data, error } = await sb.rpc("keeper_forget", { p_key: keys.accessKey, p_scope: g.scope });
  if (error) fail(`${error.message}. If the function is missing, run setup-sql and paste private/keeper-setup.sql into Supabase again.`);
  console.log(`removed ${slug}: ${data} entries`);
} else if (cmd === "rotate") {
  const next = await deriveKeeperKeys(readPw(NEW_PW), KEEPER_KDF);
  await requireKey(keys.accessKey);
  const { data, error } = await sb.rpc("keeper_list", { p_key: keys.accessKey, p_scope: null });
  if (error) fail(error.message);
  // Entries can't be edited in place, so each one is re-sent under the new key with a new id; the old
  // rows stay but nothing can read them once the key changes.
  const rows: { id: string; scope: string; data: string }[] = [];
  const slugOf = new Map<string, string>();
  const opened: { scope: string; e: KeepEntry }[] = [];
  for (const r of data as Row[]) {
    if (r.scope === TEST_SCOPE) continue;
    const e = await openEntry(keys.encRaw, r.data).then(x => KeepEntry.parse(x), () => null);
    if (!e) continue;
    opened.push({ scope: r.scope, e });
    if (e.k === "setup") slugOf.set(r.scope, e.setup.slug);
  }
  for (const { scope, e } of opened) {
    const slug = slugOf.get(scope);
    if (!slug) continue;
    rows.push({ id: crypto.randomUUID(), scope: await keeperScope(next.encRaw, slug), data: await sealEntry(next.encRaw, e) });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const r = await sb.rpc("keeper_append", { p_key: keys.accessKey, p_rows: rows.slice(i, i + 500) });
    if (r.error) fail(`stopped after ${i} entries: ${r.error.message}. Nothing has switched yet; run rotate again.`);
  }
  const set = await sb.rpc("keeper_set_key", { p_key: keys.accessKey, p_new_hash: await keyHash(next.accessKey) });
  if (set.error) fail(`entries re-sent but switching the key failed: ${set.error.message}. Run rotate again.`);
  renameSync(NEW_PW, PW);
  console.log(`✓ re-encrypted ${rows.length} entries; the new scorekeeper password is live. Run npm run build, commit and push,
so the squad list opens with it, then tell the scorekeeper. Phones still signed in with the old one are signed out.`);
} else {
  fail("usage: npx tsx tools/keeper/keeper.ts setup-sql | check | games | pull <slug> [--as <game-slug>] [--force] | forget <slug> | rotate");
}
