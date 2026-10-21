// This site and NOLA DFC Manager, run on the coach's PC. Both use the manager's Supabase project.
// Reads private/.manager.json (never committed; lines starting with // are comments):
//   {
//     "url": "https://<project>.supabase.co",       the manager's Supabase project
//     "serviceRoleKey": "…",                        Supabase → Project settings → API → service_role (keep secret)
//     "teamId": "<uuid>",                           the team in the manager (find it with: teams)
//     "siteUrl": "https://trantechsolutions.github.io/game-review/",
//     "timeZone": "America/Chicago"                 optional: where the team plays (schedule dates and kickoffs)
//   }
//
//   npx tsx tools/manager/manager.ts teams        lists the manager's teams and their ids
//   npx tsx tools/manager/manager.ts setup-sql    writes private/film-setup.sql: the coach-notes and scorekeeper
//                                                 tables and functions, with this site's key fingerprints, for
//                                                 the manager's project (paste into its SQL editor)
//   npx tsx tools/manager/manager.ts migrate      copies the coach notes and stat logs from the project in
//                                                 app/src/config.ts (the film's own, until it's switched) into
//                                                 the manager's; safe to run again
//   npx tsx tools/manager/manager.ts link         stores the keys the manager hands out (film_sites); run again
//                                                 after changing any of the three passwords
//   npx tsx tools/manager/manager.ts roster [--dry-run]
//                                                 updates private/data/roster.json from the team's players in the
//                                                 manager (names and numbers; positions stay as they are) and
//                                                 renames players in lineups.json to match
//   npx tsx tools/manager/manager.ts schedule     writes private/data/schedule.json from the team's schedule in the
//                                                 manager; the next build seals it for the scorekeeper's game setup
//   npx tsx tools/manager/manager.ts games [--dry-run]
//                                                 matches each game file to its game in the manager's schedule and
//                                                 lists it there (film_games), so the schedule links to its match
//                                                 report and highlights; run after npm run build
//   npx tsx tools/manager/manager.ts stats [--dry-run]
//                                                 each player's season numbers (minutes, starts, positions, goals,
//                                                 assists, shots, cards) from the lineups, the scorekeeper's logs
//                                                 and Ollie, into the manager (player_season_stats)
//   npx tsx tools/manager/manager.ts check        the project, the team, the film's functions and its link
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pbkdf2Sync } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KEEPER_KDF, NOTES_KDF, SUPABASE_ANON_KEY, SUPABASE_URL } from "../../app/src/config";
import { toB64 } from "../../app/src/lib/crypto";
import { deriveKeeperKeys, openEntry } from "../../app/src/lib/keeperCrypto";
import { fromKeeper, fromLibrary, fromOllie, seasonStats, type SourceGame } from "../../app/src/lib/playerStats";
import { deriveNotesKeys, keyHash, openNote, scopeFor } from "../../app/src/lib/notesCrypto";
import { formatRoster, mergeRoster, renameInJson, type ManagerPlayer } from "../../app/src/lib/rosterMerge";
import { matchGame, toSchedule, type ManagerEvent } from "../../app/src/lib/schedule";
import { KeepEntry, Lineups, OllieHistory, OlliePlayers, Roster, ScheduledGame, type PublicGame } from "../../app/src/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRIVATE = join(ROOT, "private");
const DATA = process.env.DFC_DATA || join(PRIVATE, "data");
const fail = (msg: string): never => { console.error(msg); process.exit(1); };
const [cmd, ...args] = process.argv.slice(2);

const readSecret = (name: string, required = true) => {
  const f = join(PRIVATE, name);
  const v = existsSync(f) ? readFileSync(f, "utf8").replace(/^﻿/, "").trim() : "";
  if (!v && required) fail(`Put the password on one line in private/${name} (never committed).`);
  return v;
};

interface Settings { url: string; serviceRoleKey: string; teamId?: string; siteUrl: string; timeZone: string }
function settings(): Settings {
  const f = join(PRIVATE, ".manager.json");
  if (!existsSync(f)) fail(`No private/.manager.json. Create it with the manager project's url and service_role key (see the top of ${fileURLToPath(import.meta.url)}).`);
  const s = JSON.parse(readFileSync(f, "utf8").split(/\r?\n/).filter(l => !l.trim().startsWith("//")).join("\n"));
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(s.url ?? "")) fail("private/.manager.json: url must be the manager's https://<project>.supabase.co");
  if (!s.serviceRoleKey) fail("private/.manager.json: serviceRoleKey is missing.");
  return { url: s.url.replace(/\/$/, ""), serviceRoleKey: s.serviceRoleKey, teamId: s.teamId, siteUrl: s.siteUrl || "https://trantechsolutions.github.io/game-review/", timeZone: s.timeZone || "America/Chicago" };
}
const admin = (s: Settings) => createClient(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const needTeam = (s: Settings) => s.teamId ?? fail("private/.manager.json: set teamId (run: npx tsx tools/manager/manager.ts teams).");

async function team(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("teams").select("id, name, age_group, status").eq("id", id).maybeSingle();
  if (error) fail(`Couldn't read the team: ${error.message}`);
  return data ?? fail(`No team ${id} in the manager. Run: npx tsx tools/manager/manager.ts teams`);
}

// The team's games in the manager's schedule, as the film reads them (lib/schedule.ts).
async function scheduleOf(db: SupabaseClient, s: Settings, teamId: string, teamName: string) {
  const { data, error } = await db.from("team_events")
    .select("id, title, location, event_date, event_type, is_cancelled").eq("team_id", teamId).order("event_date");
  if (error) fail(`Couldn't read the schedule: ${error.message}`);
  const site = JSON.parse(readFileSync(join(DATA, "site.json"), "utf8")) as { us: string };
  return toSchedule((data ?? []) as ManagerEvent[], { timeZone: s.timeZone, teamNames: [site.us, teamName] });
}

if (cmd === "teams") {
  const s = settings();
  const { data, error } = await admin(s).from("teams").select("id, name, age_group, gender, status").order("name");
  if (error) fail(error.message);
  for (const t of data ?? []) console.log(`${t.id}  ${t.name}${t.age_group ? ` · ${t.age_group}` : ""}${t.gender ? ` · ${t.gender}` : ""}${t.status && t.status !== "active" ? ` (${t.status})` : ""}`);
} else if (cmd === "setup-sql") {
  const coach = await deriveNotesKeys(readSecret(".coach-password"), NOTES_KDF);
  const keeperPw = readSecret(".keeper-password", false);
  const notes = readFileSync(join(ROOT, "tools", "notes", "setup.sql"), "utf8").replace("__KEY_HASH__", await keyHash(coach.accessKey));
  let sql = `-- Game film: coach notes and scorekeeper stat logs, for the NOLA DFC Manager project.\n-- Generated by tools/manager/manager.ts setup-sql. Paste into Supabase → SQL Editor → Run.\n\n${notes}`;
  if (keeperPw) {
    const keeper = await deriveKeeperKeys(keeperPw, KEEPER_KDF);
    sql += `\n\n${readFileSync(join(ROOT, "tools", "keeper", "setup.sql"), "utf8").replace("__KEY_HASH__", await keyHash(keeper.accessKey))}`;
  }
  const out = join(PRIVATE, "film-setup.sql");
  writeFileSync(out, sql);
  console.log(`wrote ${out}\nPaste it into the manager project's SQL editor and run it, along with nola-dfc-manager/sql/game_film_migration.sql.`);
} else if (cmd === "migrate") {
  const s = settings();
  if (SUPABASE_URL.replace(/\/$/, "") === s.url) fail("app/src/config.ts already points at the manager's project, so there's nothing to copy from. (Run migrate before switching it.)");
  const from = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const to = admin(s);
  const coach = await deriveNotesKeys(readSecret(".coach-password"), NOTES_KDF);
  // Coach notes: the old project hands them over only for the coach key; the scope is recomputed from each note.
  const notes = await from.rpc("notes_list", { p_key: coach.accessKey, p_scope: null });
  if (notes.error) fail(`Reading notes from ${SUPABASE_URL}: ${notes.error.message}`);
  const noteRows = [];
  for (const r of (notes.data ?? []) as { id: string; data: string; updated_at: string }[]) {
    const body = await openNote(coach.encRaw, r.data).catch(() => null);
    if (!body) { console.warn(`  note ${r.id} doesn't open with this coach password; skipped`); continue; }
    noteRows.push({ id: r.id, scope: await scopeFor(coach.encRaw, body.slug), data: r.data, updated_at: r.updated_at });
  }
  if (noteRows.length) {
    const { error } = await to.from("coach_notes").upsert(noteRows, { onConflict: "id", ignoreDuplicates: true });
    if (error) fail(`Writing notes: ${error.message}. Paste private/film-setup.sql (setup-sql) into the manager project first.`);
  }
  console.log(`coach notes: ${noteRows.length} copied`);
  const keeperPw = readSecret(".keeper-password", false);
  if (keeperPw) {
    const keeper = await deriveKeeperKeys(keeperPw, KEEPER_KDF);
    const logs = await from.rpc("keeper_list", { p_key: keeper.accessKey, p_scope: null });
    if (logs.error) console.warn(`  stat logs: ${logs.error.message} (none copied)`);
    else {
      const rows = (logs.data ?? []) as { id: string; scope: string; data: string }[];
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await to.from("keeper_log").upsert(rows.slice(i, i + 500), { onConflict: "id", ignoreDuplicates: true });
        if (error) fail(`Writing stat logs: ${error.message}. Paste private/film-setup.sql (setup-sql) into the manager project first.`);
      }
      console.log(`stat logs: ${rows.length} entries copied`);
    }
  }
  console.log("Done. Next: switch app/src/config.ts to the manager's project, then run link, check, npm run build.");
} else if (cmd === "link") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  const t = await team(db, teamId);
  const kdf = JSON.parse(readFileSync(join(ROOT, "tools", "kdf.json"), "utf8"));
  const teamKey = pbkdf2Sync(readSecret(".site-password"), Buffer.from(kdf.salt, "base64"), kdf.iterations, 32, "sha256").toString("base64");
  const c = await deriveNotesKeys(readSecret(".coach-password"), NOTES_KDF);
  const keeperPw = readSecret(".keeper-password", false);
  const k = keeperPw ? await deriveKeeperKeys(keeperPw, KEEPER_KDF) : null;
  const row = {
    team_id: teamId, site_url: s.siteUrl, team_key: teamKey,
    coach_keys: { a: c.accessKey, e: toB64(c.encRaw), c: toB64(c.contentRaw) },
    keeper_keys: k ? { a: k.accessKey, e: toB64(k.encRaw), r: toB64(k.rosterRaw) } : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("film_sites").upsert(row, { onConflict: "team_id" });
  if (error) fail(`${error.message}. Run nola-dfc-manager/sql/game_film_migration.sql in the manager project first.`);
  console.log(`✓ ${t.name} now opens ${s.siteUrl} from the manager: games for the team, the coach area for coaches${k ? ", the scorekeeper screen for scorekeepers" : ""}.`);
} else if (cmd === "roster") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  const t = await team(db, teamId);
  const { data, error } = await db.from("players").select("id, first_name, last_name, jersey_number, status").eq("team_id", teamId);
  if (error) fail(error.message);
  const file = join(DATA, "roster.json");
  const current = existsSync(file) ? Roster.parse(JSON.parse(readFileSync(file, "utf8"))) : { players: [] };
  const m = mergeRoster(current, (data ?? []) as ManagerPlayer[]);
  console.log(`${t.name}: ${(data ?? []).filter(p => p.status === "active").length} active players in the manager`);
  for (const n of m.added) console.log(`  + ${n} (add their positions in roster.json)`);
  for (const [a, b] of m.renamed) console.log(`  ~ ${a} → ${b}`);
  for (const [n, a, b] of m.renumbered) console.log(`  # ${n}: ${a ?? "—"} → ${b ?? "—"}`);
  for (const n of m.notListed) console.log(`  ? ${n} isn't an active player in the manager (kept: old games name them)`);
  if (args.includes("--dry-run")) { console.log("(dry run: nothing written)"); process.exit(0); }
  writeFileSync(file, formatRoster(m.roster));
  const lineups = join(DATA, "lineups.json");
  if (m.renamed.length && existsSync(lineups)) writeFileSync(lineups, renameInJson(readFileSync(lineups, "utf8"), m.renamed));
  console.log(`✓ wrote ${file}${m.renamed.length ? " and renamed players in lineups.json" : ""}. Run npm run validate, then npm run build.`);
} else if (cmd === "schedule") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  const t = await team(db, teamId);
  const games = (await scheduleOf(db, s, teamId, t.name)).map(g => ScheduledGame.parse(g));
  const file = join(DATA, "schedule.json");
  writeFileSync(file, `${JSON.stringify(games, null, 2)}
`);
  const unread = games.filter(g => !g.tournament && !g.opponent).length;
  console.log(`✓ wrote ${file}: ${games.length} games for ${t.name}${unread ? ` (${unread} with no opponent in the title; the scorekeeper types those)` : ""}. Run npm run build.`);
} else if (cmd === "games") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  const t = await team(db, teamId);
  const schedule = await scheduleOf(db, s, teamId, t.name);
  const files = readdirSync(join(DATA, "games")).filter(f => f.endsWith(".json")).sort()
    .map(f => JSON.parse(readFileSync(join(DATA, "games", f), "utf8")) as { slug: string; date: string; time: string; opponent: string; highlights: { clips: unknown[] } });
  const rows = files.map(g => {
    const m = matchGame(g, schedule);
    console.log(m ? `  ✓ ${g.date} ${g.opponent} → ${m.title || "(untitled)"}` : `  ? ${g.date} ${g.opponent}: no game in the manager's schedule that day (listed, but not linked)`);
    return { team_id: teamId, slug: g.slug, event_id: m?.eventId ?? null, game_date: g.date, has_highlights: g.highlights.clips.length > 0, updated_at: new Date().toISOString() };
  });
  if (args.includes("--dry-run")) { console.log("(dry run: nothing written)"); process.exit(0); }
  if (rows.length) {
    const { error } = await db.from("film_games").upsert(rows, { onConflict: "team_id,slug" });
    if (error) fail(`${error.message}. Run nola-dfc-manager/sql/game_film_games_migration.sql in the manager project first.`);
  }
  // Games no longer on the site come off the manager's schedule too.
  const { data: listed } = await db.from("film_games").select("slug").eq("team_id", teamId);
  const gone = (listed ?? []).map(r => r.slug as string).filter(slug => !rows.some(r => r.slug === slug));
  if (gone.length) await db.from("film_games").delete().eq("team_id", teamId).in("slug", gone);
  console.log(`✓ ${t.name}: ${rows.filter(r => r.event_id).length} of ${rows.length} games linked in the manager's schedule${gone.length ? `, ${gone.length} removed` : ""}.`);
} else if (cmd === "stats") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  const t = await team(db, teamId);
  const json = (f: string) => (existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), "utf8")) : null);
  const roster = Roster.parse(json("roster.json") ?? { players: [] });
  const games = readdirSync(join(DATA, "games")).filter(f => f.endsWith(".json")).sort()
    .map(f => JSON.parse(readFileSync(join(DATA, "games", f), "utf8")) as PublicGame);
  const lineups = json("lineups.json") ? Lineups.parse(json("lineups.json")) : null;
  const sources: SourceGame[] = fromLibrary(games, lineups);
  console.log(`lineups: ${sources.length} games`);
  // The scorekeeper's logs: read with the service key, opened with the scorekeeper password's key.
  const keeperPw = readSecret(".keeper-password", false);
  if (keeperPw) {
    const k = await deriveKeeperKeys(keeperPw, KEEPER_KDF);
    let { data, error } = await db.from("keeper_log").select("scope, data").or(`team_id.eq.${teamId},team_id.is.null`);
    // Before sql/keeper_accounts_migration.sql there is no team column: every log is this site's.
    if (error && /team_id/.test(error.message)) ({ data, error } = await db.from("keeper_log").select("scope, data"));
    if (error) console.warn(`  scorekeeper: ${error.message} (left out)`);
    else {
      const byScope = new Map<string, KeepEntry[]>();
      for (const r of data ?? []) {
        const e = await openEntry(k.encRaw, r.data).then(x => KeepEntry.parse(x), () => null);
        if (e) byScope.set(r.scope, [...(byScope.get(r.scope) ?? []), e]);
      }
      const kept = fromKeeper([...byScope.values()]);
      sources.push(...kept);
      console.log(`scorekeeper: ${kept.length} games`);
    }
  }
  const history = json("ollie/history.json"), olliePlayers = json("ollie/players.json");
  if (history && olliePlayers) {
    const o = fromOllie(OllieHistory.parse(history).games, OlliePlayers.parse(olliePlayers), roster);
    sources.push(...o.games);
    console.log(`Ollie: ${o.games.length} games with player stats${o.unknown.length ? ` (not on the roster: ${o.unknown.join(", ")})` : ""}`);
  }
  const bySeason = seasonStats(sources, roster.players.map(p => p.name));
  const { data: seasonRows } = await db.from("seasons").select("id");
  const known = new Set((seasonRows ?? []).map(r => r.id as string));
  const rows = [];
  for (const [season, players] of [...bySeason].sort()) {
    if (!known.has(season)) { console.log(`  ${season}: not a season in the manager; skipped`); continue; }
    console.log(`  ${season}`);
    for (const p of roster.players) {
      const st = players.get(p.name);
      if (!st) continue;
      if (!p.managerId) { console.log(`    ${p.name}: no manager record (run roster); skipped`); continue; }
      console.log(`    ${p.name}: ${st.games} games, ${st.minutes}/${st.available} min, ${st.starts} starts, ${st.goals} G ${st.assists} A ${st.shots} shots${st.positions.length ? ` · ${st.positions.slice(0, 3).map(x => x.pos).join("/")}` : ""}`);
      rows.push({ player_id: p.managerId, season_id: season, team_id: teamId, stats: st, updated_at: new Date().toISOString() });
    }
  }
  if (args.includes("--dry-run")) { console.log("(dry run: nothing written)"); process.exit(0); }
  if (rows.length) {
    const { error } = await db.from("player_season_stats").upsert(rows, { onConflict: "player_id,season_id,team_id" });
    if (error) fail(`${error.message}. Run nola-dfc-manager/sql/player_season_stats_migration.sql in the manager project first.`);
  }
  console.log(`✓ ${t.name}: ${rows.length} player seasons written to the manager.`);
} else if (cmd === "check") {
  const s = settings();
  const db = admin(s);
  const teamId = needTeam(s);
  const t = await team(db, teamId);
  console.log(`✓ manager project reachable; team ${t.name}`);
  const site = await db.from("film_sites").select("site_url, updated_at, keeper_keys").eq("team_id", teamId).maybeSingle();
  if (site.error) console.log(`✗ film_sites: ${site.error.message} (run nola-dfc-manager/sql/game_film_migration.sql)`);
  else if (!site.data) console.log("✗ not linked yet (run: link)");
  else console.log(`✓ linked to ${site.data.site_url} (updated ${site.data.updated_at}${site.data.keeper_keys ? ", with the scorekeeper" : ""})`);
  const coach = await deriveNotesKeys(readSecret(".coach-password"), NOTES_KDF);
  const notes = await db.rpc("notes_check", { p_key: coach.accessKey });
  console.log(notes.error ? `✗ coach notes: ${notes.error.message} (paste private/film-setup.sql)` : notes.data === true ? "✓ coach notes answer to the coach password" : "✗ coach notes don't accept this coach password (run setup-sql again and paste it)");
  console.log(SUPABASE_URL.replace(/\/$/, "") === s.url ? "✓ app/src/config.ts points at the manager's project" : `• app/src/config.ts still points at ${SUPABASE_URL} (switch it after migrate)`);
} else {
  fail("usage: npx tsx tools/manager/manager.ts teams | setup-sql | migrate | link | roster [--dry-run] | schedule | games [--dry-run] | stats [--dry-run] | check");
}
