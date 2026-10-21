// Checks every game file before a build: schema, Spanish present, event references, clip files.
//   npm run validate
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { halfLengths, lineupFor, playLineup, type HalfLengths } from "../app/src/lib/lineup";
import { Game, Lineups, OllieHistory, OlliePlayers, Roster, Text } from "../app/src/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DFC_DATA || join(ROOT, "private", "data");
const DIR = join(DATA, "games");
const MAX_CLIP = 95 * 1024 * 1024;

export function check(raw: unknown, clipsDir?: string): string[] {
  const parsed = Game.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
  const g = parsed.data, errs: string[] = [];
  const ids = new Set<string>();
  for (const e of g.events) {
    if (ids.has(e.id)) errs.push(`events: duplicate id ${e.id}`);
    ids.add(e.id);
  }
  g.report.halves.forEach((h, i) => h.phases.forEach((p, j) => p.events.forEach(ref => {
    const id = typeof ref === "string" ? ref : ref.id;
    const e = g.events.find(x => x.id === id);
    if (!e) errs.push(`report.halves.${i}.phases.${j}: unknown event ${id}`);
    else if (e.h !== i + 1) errs.push(`report.halves.${i}.phases.${j}: event ${id} is in the other half`);
  })));
  // Unit-review evidence must point at logged moments ("1H 12:54").
  const moments = new Set(g.events.map(e => `${e.h}H ${e.c}`));
  g.unitReviews.units.forEach(u => [...u.positives, ...u.negatives, ...u.improvements].forEach(p => p.ev.forEach(m => {
    if (!moments.has(m)) errs.push(`unitReviews.${u.unit}: "${m}" is not a logged event`);
  })));
  const clipIds = new Set<string>();
  for (const c of g.highlights.clips) {
    if (clipIds.has(c.id)) errs.push(`highlights: duplicate clip ${c.id}`);
    clipIds.add(c.id);
    if (clipsDir) {
      const f = join(clipsDir, `${c.id}.mp4`);
      if (!existsSync(f)) errs.push(`highlights: missing clip file ${c.id}.mp4 (run python tools/make_highlights.py --game ${g.slug})`);
      else if (statSync(f).size > MAX_CLIP) errs.push(`highlights: ${c.id}.mp4 is over 95 MB`);
    }
  }
  // Positions are written as acronyms (GK, LCB, ST…; app/src/lib/positions.ts). Unit headings are exempt.
  const SPELLED: Record<"en" | "es", RegExp> = {
    en: /\b(?:goal ?keepers?|keepers?|strikers?|cent(?:re|er)[- ]?backs?|cent(?:re|er)[- ](?:left|right) (?:defender|back|mid(?:fielder)?)|full[- ]?backs?|wide mid(?:fielder)?s?|wingers?)\b/i,
    es: /\b(?:porteros?|delanteros?|central (?:izquierdo|derecho)|medio centro-(?:izquierda|derecha)|mediocentros?|volantes?|laterales?)\b/i,
  };
  const walkPos = (v: unknown, path: string) => {
    if (Text.safeParse(v).success) {
      if (/^coaches\.units\.items\.\d+\.name$/.test(path)) return;
      for (const l of ["en", "es"] as const) {
        const m = (v as Text)[l].match(SPELLED[l]);
        if (m) errs.push(`${path}.${l}: write "${m[0]}" as a position acronym`);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walkPos(x, `${path}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walkPos(x, path ? `${path}.${k}` : k);
  };
  walkPos(g, "");

  // Spanish that is just the English copied over is usually a missed translation.
  const walk = (v: unknown, path: string) => {
    if (Text.safeParse(v).success) {
      const t = v as Text;
      if (t.es === t.en && /[a-z]{4,}\s+[a-z]{3,}/i.test(t.en)) errs.push(`${path}: Spanish is identical to English`);
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(g, "");
  return errs;
}

/** The roster: schema, and no two players sharing a name or a shirt number. */
export function checkRoster(raw: unknown): string[] {
  const parsed = Roster.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
  const errs: string[] = [], names = new Set<string>(), numbers = new Set<number>();
  for (const p of parsed.data.players) {
    if (names.has(p.name)) errs.push(`players: duplicate name ${p.name}`);
    names.add(p.name);
    if (p.number != null) {
      if (numbers.has(p.number)) errs.push(`players: duplicate number ${p.number}`);
      numbers.add(p.number);
    }
  }
  return errs;
}

/** The lineups: schema, known games, roster names, and a timeline that replays cleanly. */
export function checkLineups(raw: unknown, rosterNames: Set<string>, games: Map<string, HalfLengths>): string[] {
  const parsed = Lineups.safeParse(raw);
  if (!parsed.success) return parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
  const errs: string[] = [];
  for (const s of parsed.data.default?.start ?? []) if (!rosterNames.has(s.player)) errs.push(`default: ${s.player} is not in the roster`);
  for (const slug of Object.keys(parsed.data.games)) if (!games.has(slug)) errs.push(`${slug}: no such game`);
  // Every game is replayed, including those that fall back on the default starters.
  for (const [slug, len] of games) {
    const r = lineupFor(parsed.data, slug);
    if (!r) continue;
    const l = r.lineup;
    const names = [...l.start.map(s => s.player), ...l.changes.flatMap(c => ("off" in c ? [c.off, c.on] : [c.player]))];
    for (const n of new Set(names)) if (!rosterNames.has(n)) errs.push(`${slug}: ${n} is not in the roster`);
    errs.push(...playLineup(l, len).errors.map(e => `${slug}: ${e}`));
  }
  return errs;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let bad = 0;
  const files = existsSync(DIR) ? readdirSync(DIR).filter(f => f.endsWith(".json")) : [];
  if (!files.length) { console.error(`No games in ${DIR}`); process.exit(1); }
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    const errs = check(raw, join(ROOT, "private", "clips", f.replace(/\.json$/, "")));
    if (raw.slug !== f.replace(/\.json$/, "")) errs.push(`slug "${raw.slug}" does not match the file name`);
    if (errs.length) { bad++; console.error(`✗ ${f}\n  ${errs.slice(0, 40).join("\n  ")}${errs.length > 40 ? `\n  …and ${errs.length - 40} more` : ""}`); }
    else console.log(`✓ ${f}`);
  }
  const rosterFile = join(DATA, "roster.json");
  const roster = existsSync(rosterFile) ? JSON.parse(readFileSync(rosterFile, "utf8")) : null;
  if (roster) {
    const errs = checkRoster(roster);
    if (errs.length) { bad++; console.error(`✗ roster.json\n  ${errs.join("\n  ")}`); }
    else console.log("✓ roster.json");
  }
  const lineupsFile = join(DATA, "lineups.json");
  if (existsSync(lineupsFile)) {
    const names = new Set<string>((roster?.players ?? []).map((p: { name: string }) => p.name));
    const lens = new Map(files.map(f => {
      const g = JSON.parse(readFileSync(join(DIR, f), "utf8"));
      return [g.slug as string, halfLengths(g)];
    }));
    const errs = checkLineups(JSON.parse(readFileSync(lineupsFile, "utf8")), names, lens);
    if (errs.length) { bad++; console.error(`✗ lineups.json\n  ${errs.join("\n  ")}`); }
    else console.log("✓ lineups.json");
  }
  // Ollie Sports history: schema, and each game it says the library has must exist.
  const ollieDir = join(DATA, "ollie");
  if (existsSync(join(ollieDir, "history.json"))) {
    const h = OllieHistory.safeParse(JSON.parse(readFileSync(join(ollieDir, "history.json"), "utf8")));
    const errs = h.success ? h.data.games.filter(g => g.inApp && !files.includes(`${g.inApp}.json`)).map(g => `${g.id}: matched to missing game ${g.inApp}`)
      : h.error.issues.slice(0, 20).map(i => `${i.path.join(".")}: ${i.message}`);
    const pf = join(ollieDir, "players.json");
    if (existsSync(pf)) { const pl = OlliePlayers.safeParse(JSON.parse(readFileSync(pf, "utf8"))); if (!pl.success) errs.push(...pl.error.issues.slice(0, 10).map(i => `players.${i.path.join(".")}: ${i.message}`)); }
    if (errs.length) { bad++; console.error(`✗ ollie/history.json\n  ${errs.join("\n  ")}`); }
    else console.log(`✓ ollie/history.json (${h.success ? h.data.games.length : 0} games)`);
  }
  process.exit(bad ? 1 : 0);
}
