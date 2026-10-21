// Swaps a position for the player who held it, in the description of one logged moment.
// Only for confirmed lineups, and only where the position clearly means one DFC player at that moment.
import { whoAt, type Stint } from "./lineup";
import { POSITIONS } from "./positions";

const POS = Object.keys(POSITIONS).join("|");
// An optional article or "our" in front ("the ST", "el GK", "al LB"), optional bold/italic markup, the
// acronym, and a plural "s" (plurals are left alone: "the CBs" is a group, not a person).
const RE = new RegExp(String.raw`(\b(?:[Tt]he|[Aa]n?|[Oo]ur|[Ee]l|[Ll]a|[Nn]uestro|[Nn]uestra|al|del)\s+)?(\*{0,2})\b(${POS})(s?)\b`, "g");
// What an article becomes in front of a name: "al GK" → "a Braxx", "del GK" → "de Braxx".
const KEEP: Record<string, string> = { al: "a ", del: "de " };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` with each position that meant exactly one DFC player at play-second `t` replaced by `nameOf(player)`.
 *  Opposition positions are written with the team in front ("the HFC CB") or after ("el GK de HFC") and stay. */
export function nameMoment(text: string, stints: Stint[], t: number, opponent: string, nameOf: (player: string) => string): string {
  const team = opponent.split(/\s+/).map(esc).join("|");
  const theirsBefore = new RegExp(String.raw`(?:\b(?:${team})|\b(?:their|su|sus))\s*\**\s*$`, "i");
  const theirsAfter = new RegExp(String.raw`^\**\s+(?:de|del|of)\s+(?:${team})\b`, "i");
  return text.replace(RE, (all, article: string | undefined, mark: string, key: string, plural: string, at: number, whole: string) => {
    if (plural) return all;
    const before = whole.slice(0, at) + (article ?? "");
    const after = whole.slice(at + all.length);
    if (theirsBefore.test(before) || theirsAfter.test(after)) return all;
    const who = whoAt(stints, key, t);
    if (who.length !== 1) return all;
    const lead = article ? KEEP[article.trim()] ?? "" : "";
    return `${lead}${mark}${nameOf(who[0].player)}`;
  });
}
