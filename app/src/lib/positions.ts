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

const RE = new RegExp(String.raw`\b(${Object.keys(POSITIONS).join("|")})(s?)\b`, "g");

export type Piece = string | { abbr: string; title: string };

/** Splits text so each position acronym can carry its full name. */
export function splitPositions(text: string, lang: Lang): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    out.push({ abbr: m[0], title: POSITIONS[m[1]][lang] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
