// One-off: rewrite spelled-out positions as acronyms (GK, LCB, ST…) in every game file, in both
// languages. Unit names (coaches.units.items[].name) stay as words. Group words ("the defenders",
// "two defenders") and "forward" as a direction are left alone.
//   node tools/legacy/acronyms.mjs [--dry]
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "private", "data", "games");
const dry = process.argv.includes("--dry");
const TEAM = "(?:DFC|BRSC|HFC|Krewe|Eagles|CSC Eagles)";

// [pattern, replacement]; applied in order, case-sensitive where capitalisation matters.
const EN = [
  // Two-word positions first.
  [/\b[Cc]ent(?:re|er)[- ]left (?:defender|back)\b/g, "LCB"],
  [/\b[Cc]ent(?:re|er)[- ]right (?:defender|back)\b/g, "RCB"],
  [/\b[Cc]ent(?:re|er)[- ]left mid(?:fielder)?\b/g, "LCM"],
  [/\b[Cc]ent(?:re|er)[- ]right mid(?:fielder)?\b/g, "RCM"],
  [/\b[Ll]eft striker\b/g, "LS"],
  [/\b[Rr]ight striker\b/g, "RS"],
  [/\b[Ww]ide midfielders\b/g, "WMs"],
  [/\b[Ww]ide (?:midfielder|mid)\b/g, "WM"],
  [/\b[Cc]ent(?:re|er)[- ]?backs\b/g, "CBs"],
  [/\b[Cc]ent(?:re|er)[- ]?back\b/g, "CB"],
  [/\b[Ff]ull[- ]?backs\b/g, "FBs"],
  [/\b[Ff]ull[- ]?back\b/g, "FB"],
  [/\b(?:[Cc]entral|[Cc]ent(?:re|er)) (?:midfielders|mids)\b/g, "CMs"],
  [/\b(?:[Cc]entral|[Cc]ent(?:re|er)) (?:midfielder|mid)\b/g, "CM"],
  [/\b[Hh]olding midfielder\b/g, "holding CM"],
  // Single words.
  [/\b(?:[Gg]oal ?)?[Kk]eepers\b/g, "GKs"],
  [/\b(?:[Gg]oal ?)?[Kk]eeper\b/g, "GK"],
  [/\b[Ss]trikers\b/g, "STs"],
  [/\b[Ss]triker\b/g, "ST"],
  [new RegExp(`\\b(${TEAM}) wingers?\\b`, "g"), "$1 W"],
  [/\b(an?|the) winger\b/g, "$1 W"],
  [new RegExp(`\\b(${TEAM}) forwards?\\b`, "g"), "$1 FW"],
];

const ES = [
  [/\b[Cc]entral izquierdo\b/g, "LCB"],
  [/\b[Cc]entral derecho\b/g, "RCB"],
  [/\b[Mm]edio centro-izquierda\b/g, "LCM"],
  [/\b[Mm]edio centro-derecha\b/g, "RCM"],
  [/\b[Dd]elantero izquierdo\b/g, "LS"],
  [/\b[Dd]elantero derecho\b/g, "RS"],
  [/\b[Vv]olantes\b/g, "WM"],
  [/\b[Vv]olante\b/g, "WM"],
  [/\b(los|dos|Los|Dos) centrales\b/g, "$1 CB"],
  [/\b(el|un|al|del|otro|El|Un) central\b(?! de)/g, "$1 CB"],
  [/\b[Ll]aterales\b/g, "FB"],
  [/\b(el|un|al|del|El|Un) lateral\b/g, "$1 FB"],
  [/\b[Mm]ediocentros?(?= de contención)/g, "CM"],
  [/\b[Mm]ediocentros\b/g, "CM"],
  [/\b[Mm]ediocentro\b/g, "CM"],
  [/\b[Pp]orteros\b/g, "GK"],
  [/\b[Pp]ortero\b/g, "GK"],
  [/\b[Dd]elanteros\b/g, "ST"],
  [/\b[Dd]elantero\b/g, "ST"],
  [/\b(un|el|al|del) extremo\b/g, "$1 W"],
];

// English article fix: "a ST" → "an ST" (said "ess-tee"); same for the other vowel-sound acronyms.
const AN = /\b([Aa]) (ST|LS|RS|LCB|RCB|LCM|RCM|FB|FW|STs)\b/g;

const isText = v => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === "en,es";
let changed = 0;
const samples = [];

function fix(text, rules) {
  let out = text;
  for (const [re, to] of rules) out = out.replace(re, to);
  return out;
}

function walk(v, path) {
  if (isText(v)) {
    if (/^coaches\.units\.items\.\d+\.name$/.test(path)) return; // unit headings stay as words
    const en = fix(v.en, EN).replace(AN, (_, a, x) => `${a}n ${x}`);
    const es = fix(v.es, ES);
    if (en !== v.en || es !== v.es) { changed++; if (samples.length < 40) samples.push(`${path}\n  en: ${en}\n  es: ${es}`); }
    v.en = en; v.es = es;
    return;
  }
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
}

for (const f of readdirSync(DIR).filter(f => f.endsWith(".json"))) {
  const g = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  walk(g, "");
  if (!dry) writeFileSync(join(DIR, f), JSON.stringify(g, null, 2) + "\n");
}
console.log(`${changed} strings ${dry ? "would change" : "changed"}`);
if (dry) console.log(samples.join("\n"));
