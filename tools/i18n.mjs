// Translation round-trip for game files.
//   node tools/i18n.mjs export <slug>   writes private/data/i18n/<slug>.todo.json: { "1": "English", ... }
//                                       for every Text whose Spanish is empty (and .paths.json beside it)
//   node tools/i18n.mjs import <slug>   reads private/data/i18n/<slug>.es.json: { "1": "Español", ... }
//                                       and writes the Spanish into the game file
// Markup (**bold**, *italic*, `mono`) and numbers must be kept as they are.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, slug] = process.argv.slice(2);
if (!["export", "import"].includes(cmd) || !slug) { console.error("usage: node tools/i18n.mjs export|import <slug>"); process.exit(1); }
const GAME = join(ROOT, "private", "data", "games", `${slug}.json`);
const DIR = join(ROOT, "private", "data", "i18n");
mkdirSync(DIR, { recursive: true });
const game = JSON.parse(readFileSync(GAME, "utf8"));

const isText = v => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "en,es";
function* texts(v, path = []) {
  if (isText(v)) { yield [path, v]; return; }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) yield* texts(v[i], [...path, i]); return; }
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* texts(x, [...path, k]);
}
const at = path => path.reduce((o, k) => o[k], game);
const marks = s => (s.match(/\*\*|`|\d+/g) || []).join(" ");

if (cmd === "export") {
  const todo = {}, paths = {};
  let n = 0;
  for (const [path, t] of texts(game)) if (!t.es) { n++; todo[n] = t.en; paths[n] = path; }
  writeFileSync(join(DIR, `${slug}.todo.json`), JSON.stringify(todo, null, 1) + "\n");
  writeFileSync(join(DIR, `${slug}.paths.json`), JSON.stringify(paths) + "\n");
  console.log(`${n} strings to translate → private/data/i18n/${slug}.todo.json`);
} else {
  const paths = JSON.parse(readFileSync(join(DIR, `${slug}.paths.json`), "utf8"));
  const esFile = join(DIR, `${slug}.es.json`);
  if (!existsSync(esFile)) { console.error(`missing ${esFile}`); process.exit(1); }
  const es = JSON.parse(readFileSync(esFile, "utf8"));
  const missing = Object.keys(paths).filter(k => !es[k]);
  if (missing.length) { console.error(`missing translations: ${missing.join(", ")}`); process.exit(1); }
  const warn = [];
  for (const [k, path] of Object.entries(paths)) {
    const t = at(path);
    if (marks(t.en) !== marks(es[k])) warn.push(`#${k} markup or numbers differ:\n    en: ${t.en}\n    es: ${es[k]}`);
    t.es = es[k];
  }
  writeFileSync(GAME, JSON.stringify(game, null, 2) + "\n");
  console.log(`imported ${Object.keys(paths).length} translations into ${slug}.json`);
  if (warn.length) console.warn(warn.join("\n"));
}
