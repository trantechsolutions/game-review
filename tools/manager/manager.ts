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
//   npx tsx tools/manager/manager.ts publish [--dry-run]
//                                                 the film inside the manager: every game, breakdown, lineup,
//                                                 position and Ollie game into its tables, and the clips as plain
//                                                 MP4s into the private R2 bucket (private/.r2.json clipsBucket);
//                                                 also links each game to the schedule, like games. Needs
//                                                 nola-dfc-manager/sql/film_native_migration.sql run once
//   npx tsx tools/manager/manager.ts move-notes [--dry-run]
//                                                 opens the encrypted coach notes with the coach password and
//                                                 copies them into the manager's film_notes; safe to run again
//   npx tsx tools/manager/manager.ts check    the project, the team, the film's functions and its link
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
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
import { KeepEntry, Lineups, OllieHistory, OlliePlayers, Roster, ScheduledGame, type Game, type Lineup, type PublicGame } from "../../app/src/schema";
import { clipsClient, loadClipsR2 } from "../lib/r2.mjs";

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
} else if (cmd === "publish") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  const t = await team(db, teamId);
  const dry = args.includes("--dry-run");
  const v = spawnSync(process.execPath, [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "tools", "validate.ts")], { stdio: "inherit" });
  if (v.status !== 0) fail("Validation failed; nothing was published.");
  const json = (f: string) => (existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), "utf8")) : null);
  const site = json("site.json") as { us: string };
  const roster = Roster.parse(json("roster.json") ?? { players: [] });
  const lineups = json("lineups.json") ? Lineups.parse(json("lineups.json")) : null;
  const games = readdirSync(join(DATA, "games")).filter(f => f.endsWith(".json")).sort()
    .map(f => JSON.parse(readFileSync(join(DATA, "games", f), "utf8")) as Game);
  const schedule = await scheduleOf(db, s, teamId, t.name);
  const now = new Date().toISOString();

  // Lineups name players by roster name; the manager keeps them by player id where there is one.
  const idOf = new Map(roster.players.filter(p => p.managerId).map(p => [p.name, p.managerId!]));
  const unlinked = new Set<string>();
  const byId = (name: string) => idOf.get(name) ?? (unlinked.add(name), name);
  const toIds = (l: { start: { pos: string; player: string }[]; changes?: Lineup["changes"]; estimated?: boolean }) => ({
    ...l,
    start: l.start.map(x => ({ ...x, player: byId(x.player) })),
    ...(l.changes ? {
      changes: l.changes.map(c => ("off" in c ? { ...c, off: byId(c.off), on: byId(c.on) } : { ...c, player: byId(c.player) })),
    } : {}),
  });

  const gameRows = games.map(g => {
    const m = matchGame(g, schedule);
    console.log(m ? `  ✓ ${g.date} ${g.opponent} → ${m.title || "(untitled)"}` : `  ? ${g.date} ${g.opponent}: no game in the manager's schedule that day (published, but not linked)`);
    const { coaches: _coaches, ...pub } = g;
    return {
      team_id: teamId, slug: g.slug, event_id: m?.eventId ?? null, game_date: g.date, game_time: g.time,
      opponent: g.opponent, home: g.home, score_us: g.score.us, score_them: g.score.them,
      has_highlights: g.highlights.clips.length > 0,
      // The full-game video's path is on this PC only.
      content: { ...pub, highlights: { ...pub.highlights, source: "" } },
      updated_at: now,
    };
  });
  const breakdownRows = games.map(g => ({ team_id: teamId, slug: g.slug, content: g.coaches, updated_at: now }));
  const positionRows = roster.players.filter(p => p.managerId)
    .map(p => ({ team_id: teamId, player_id: p.managerId, positions: p.positions, updated_at: now }));
  const lineupRows = [
    ...(lineups?.default ? [{ team_id: teamId, slug: "*", lineup: toIds({ ...lineups.default, changes: [] }), updated_at: now }] : []),
    ...Object.entries(lineups?.games ?? {}).map(([slug, l]) => ({ team_id: teamId, slug, lineup: toIds(l), updated_at: now })),
  ];
  const history = json("ollie/history.json") ? OllieHistory.parse(json("ollie/history.json")) : null;
  const olliePlayers = json("ollie/players.json") ? OlliePlayers.parse(json("ollie/players.json")) : null;
  const ollieRows = (history?.games ?? []).map(o => ({ team_id: teamId, ollie_id: o.id, game_date: o.date, content: o, updated_at: now }));
  const olliePlayerRows = Object.entries(olliePlayers?.games ?? {})
    .filter(([id]) => ollieRows.some(r => r.ollie_id === id))
    .map(([id, players]) => ({ team_id: teamId, ollie_id: id, players, updated_at: now }));

  for (const n of unlinked) console.log(`  ? ${n} is in lineups.json but has no manager record (run roster); kept by name`);
  console.log(`${t.name}: ${gameRows.length} games, ${positionRows.length} players' positions, ${lineupRows.length} lineups, ${ollieRows.length} Ollie games`);

  // Clips: plain MP4s in the private bucket, under the team's id.
  let r2c: ReturnType<typeof loadClipsR2> = null;
  try { r2c = loadClipsR2(join(PRIVATE, ".r2.json")); } catch (e) { fail((e as Error).message); }
  const clipKeys = new Map<string, string>();
  for (const g of games) for (const c of g.highlights.clips) clipKeys.set(`${teamId}/${g.slug}/${c.id}.mp4`, join(PRIVATE, "clips", g.slug, `${c.id}.mp4`));
  if (!r2c && clipKeys.size) console.log(`  • no clipsBucket in private/.r2.json: ${clipKeys.size} clips not uploaded`);
  if (dry) { console.log("(dry run: nothing written)"); process.exit(0); }

  const up = async (table: string, rows: object[], onConflict: string) => {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from(table).upsert(rows.slice(i, i + 200), { onConflict });
      if (error) fail(`${table}: ${error.message}. Run nola-dfc-manager/sql/film_native_migration.sql in the manager project first.`);
    }
  };
  // Whatever isn't in this publish any more comes off the manager too.
  const prune = async (table: string, col: string, keep: string[]) => {
    const { data, error } = await db.from(table).select(col).eq("team_id", teamId);
    if (error) fail(`${table}: ${error.message}`);
    const gone = (data ?? []).map(r => (r as unknown as Record<string, string>)[col]).filter(x => !keep.includes(x));
    if (gone.length) await db.from(table).delete().eq("team_id", teamId).in(col, gone);
    return gone.length;
  };

  await up("film_teams", [{ team_id: teamId, short_name: site.us, updated_at: now }], "team_id");
  await up("film_games", gameRows, "team_id,slug");
  await up("film_breakdowns", breakdownRows, "team_id,slug");
  await up("film_positions", positionRows, "team_id,player_id");
  await up("film_lineups", lineupRows, "team_id,slug");
  await up("film_ollie_games", ollieRows, "team_id,ollie_id");
  await up("film_ollie_players", olliePlayerRows, "team_id,ollie_id");
  const removed = await prune("film_games", "slug", gameRows.map(r => r.slug));
  await prune("film_lineups", "slug", lineupRows.map(r => r.slug));
  await prune("film_ollie_games", "ollie_id", ollieRows.map(r => r.ollie_id));

  let uploaded = 0, clipsGone = 0;
  if (r2c) {
    const r2 = clipsClient(r2c);
    const inBucket = await r2.list(`${teamId}/`).catch((e: Error) => fail(`Couldn't reach the clips bucket (${e.name}). Check private/.r2.json.`));
    for (const [key, src] of clipKeys) {
      if (!existsSync(src)) fail(`Missing clip ${src}. Run tools/make_highlights.py for that game.`);
      if (await r2.put(key, readFileSync(src), inBucket)) uploaded++;
    }
    clipsGone = await r2.remove([...inBucket.keys()].filter(k => !clipKeys.has(k)));
  }
  console.log(`✓ ${t.name}: published ${gameRows.length} games to the manager${removed ? `, ${removed} removed` : ""}; clips: ${uploaded} uploaded, ${clipKeys.size - uploaded} unchanged${clipsGone ? `, ${clipsGone} removed` : ""}.`);
} else if (cmd === "move-notes") {
  const s = settings();
  const teamId = needTeam(s);
  const db = admin(s);
  // The encrypted coach notes (coach_notes), opened with the coach password and kept in plain text in
  // film_notes. Same ids, so running it again adds nothing twice.
  const coach = await deriveNotesKeys(readSecret(".coach-password"), NOTES_KDF);
  const { data, error } = await db.from("coach_notes").select("id, data, updated_at");
  if (error) fail(`coach_notes: ${error.message}`);
  const rows = [];
  for (const r of (data ?? []) as { id: string; data: string; updated_at: string }[]) {
    const n = await openNote(coach.encRaw, r.data).catch(() => null);
    if (!n) { console.warn(`  note ${r.id} doesn't open with this coach password; skipped`); continue; }
    rows.push({ id: r.id, team_id: teamId, slug: n.slug, anchor: n.anchor, body: n.text, author_id: null, author_name: n.author ?? "", created_at: r.updated_at, updated_at: r.updated_at });
  }
  if (args.includes("--dry-run")) { console.log(`${rows.length} notes would move (dry run: nothing written)`); process.exit(0); }
  if (rows.length) {
    const { error: e } = await db.from("film_notes").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (e) fail(`film_notes: ${e.message}. Run nola-dfc-manager/sql/film_native_migration.sql first.`);
  }
  console.log(`✓ ${rows.length} coach notes moved into the manager.`);
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
  fail("usage: npx tsx tools/manager/manager.ts teams | setup-sql | migrate | link | roster [--dry-run] | schedule | games [--dry-run] | stats [--dry-run] | publish [--dry-run] | move-notes [--dry-run] | check");
}
