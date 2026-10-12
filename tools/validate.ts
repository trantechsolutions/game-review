// Checks every game file before a build: schema, Spanish present, event references, clip files.
//   npm run validate
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Game, Text } from "../app/src/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(process.env.DFC_DATA || join(ROOT, "private", "data"), "games");
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
  process.exit(bad ? 1 : 0);
}
