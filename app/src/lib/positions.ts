// Position acronyms used in the write-ups, with their full names for tooltips.
import type { Lang } from "../i18n";

export const POSITIONS: Record<string, { en: string; es: string }> = {
  GK: { en: "Goalkeeper", es: "Portero" },
  LB: { en: "Left back", es: "Lateral izquierdo" },
  RB: { en: "Right back", es: "Lateral derecho" },
  FB: { en: "Fullback", es: "Lateral" },
  CB: { en: "Centre-back", es: "Central" },
  LCB: { en: "Left centre-back", es: "Central izquierdo" },
  RCB: { en: "Right centre-back", es: "Central derecho" },
  CM: { en: "Central midfielder", es: "Mediocentro" },
  LCM: { en: "Left central midfielder", es: "Mediocentro izquierdo" },
  RCM: { en: "Right central midfielder", es: "Mediocentro derecho" },
  LM: { en: "Left midfielder", es: "Volante izquierdo" },
  RM: { en: "Right midfielder", es: "Volante derecho" },
  WM: { en: "Wide midfielder", es: "Volante" },
  LW: { en: "Left winger", es: "Extremo izquierdo" },
  RW: { en: "Right winger", es: "Extremo derecho" },
  ST: { en: "Striker", es: "Delantero" },
  LS: { en: "Left striker", es: "Delantero izquierdo" },
  RS: { en: "Right striker", es: "Delantero derecho" },
  FW: { en: "Forward", es: "Delantero" },
};

// Where each position sits on a pitch drawn with DFC attacking to the right: x from our goal line
// (0) to theirs (100), y from the top touchline (0, our left) to the bottom (100, our right).
export const SPOT: Record<string, [x: number, y: number]> = {
  GK: [6, 50],
  LB: [24, 14], LCB: [21, 36], CB: [21, 50], RCB: [21, 64], RB: [24, 86], FB: [24, 86],
  LCM: [46, 38], CM: [46, 50], RCM: [46, 62],
  LM: [52, 12], RM: [52, 88], WM: [52, 88], LW: [70, 14], RW: [70, 86],
  LS: [74, 38], ST: [76, 50], FW: [76, 50], RS: [74, 62],
};

const RE = new RegExp(String.raw`\b(${Object.keys(POSITIONS).join("|")})(s?)\b`, "g");

export type Piece = string | { abbr: string; key: string; title: string };

/** Splits text so each position acronym can carry its full name. */
export function splitPositions(text: string, lang: Lang): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ abbr: m[0], key: m[1], title: POSITIONS[m[1]][lang] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// A general acronym (CB) can mean any of its sided spots (LCB, RCB), and a player listed at the
// general one can be playing either side. Wide spots on the same side (LM, LW) are interchangeable.
const FAMILIES: { general: string[]; sided: string[] }[] = [
  { general: ["CB"], sided: ["LCB", "RCB"] },
  { general: ["FB"], sided: ["LB", "RB"] },
  { general: ["CM"], sided: ["LCM", "RCM"] },
  { general: ["WM"], sided: ["LM", "RM", "LW", "RW"] },
  { general: ["ST", "FW"], sided: ["LS", "RS"] },
];
const ALIKE = [["LM", "LW"], ["RM", "RW"]];

/** Whether a player listed at `played` could be the one the write-up calls `named`. */
export function couldPlay(named: string, played: string): boolean {
  if (named === played) return true;
  if (ALIKE.some(a => a.includes(named) && a.includes(played))) return true;
  return FAMILIES.some(f =>
    (f.general.includes(named) && (f.general.includes(played) || f.sided.includes(played)))
    || (f.sided.includes(named) && f.general.includes(played)));
}

export interface RosterPlayer { name: string; number?: number | null; positions: string[] }

/** Players who could be the named position: those listed there first-choice ahead of the rest. */
export function candidates(named: string, players: RosterPlayer[]): RosterPlayer[] {
  const rank = (p: RosterPlayer) => p.positions.findIndex(x => couldPlay(named, x));
  return players.map(p => [p, rank(p)] as const).filter(([, r]) => r >= 0)
    .sort((a, b) => a[1] - b[1] || (a[0].number ?? 999) - (b[0].number ?? 999))
    .map(([p]) => p);
}

/** "#7 Alex Smith", or just the name without a number. */
export const playerLabel = (p: RosterPlayer) => (p.number != null ? `#${p.number} ${p.name}` : p.name);
