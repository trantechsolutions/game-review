import { createContext, Fragment, useContext } from "react";
import { useI18n } from "../i18n";
import { minutes, whoPlayed, type Stint } from "../lib/lineup";
import { parseMarkup } from "../lib/markup";
import { candidates, playerLabel, splitPositions, type RosterPlayer } from "../lib/positions";
import type { Text } from "../schema";

/** The squad, inside the coaches' breakdown only: position tooltips then list who played there in this
 *  game (with a lineup) or who could have made the play (without one). */
export const RosterContext = createContext<{ players: RosterPlayer[]; stints: Stint[] | null } | null>(null);

/** Text with each position acronym (GK, LCB, ST…) wrapped so its full name shows on hover or tap. */
function Pos({ text }: { text: string }) {
  const { lang, t } = useI18n();
  const roster = useContext(RosterContext);
  const full = (key: string, title: string) => {
    if (!roster) return title;
    const played = roster.stints ? whoPlayed(roster.stints, key) : [];
    if (played.length) {
      const label = (name: string) => { const p = roster.players.find(x => x.name === name); return p ? playerLabel(p) : name; };
      return `${title} · ${t("playedThere")}\n${played.map(p => `${label(p.player)} · ${minutes(p.seconds)}'`).join("\n")}`;
    }
    const who = candidates(key, roster.players);
    return who.length ? `${title} · ${t("couldBe")}\n${who.map(playerLabel).join("\n")}` : `${title} · ${t("noOneListed")}`;
  };
  return (
    <>
      {splitPositions(text, lang).map((p, i) => {
        if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
        const f = full(p.key, p.title);
        return <abbr key={i} className="pos-abbr" data-full={f}>{p.abbr}<span className="sr-only"> ({f.replace(/\n/g, ", ")})</span></abbr>;
      })}
    </>
  );
}

/** Renders a data string with **bold**, *italic* and `mono`. Never renders HTML. */
export function Md({ s }: { s: string }) {
  return (
    <>
      {parseMarkup(s).map((r, i) =>
        r.kind === "b" ? <b key={i}><Pos text={r.text} /></b>
          : r.kind === "i" ? <i key={i}><Pos text={r.text} /></i>
            : r.kind === "mono" ? <span key={i} className="mono">{r.text}</span>
              : <Pos key={i} text={r.text} />)}
    </>
  );
}

/** A Text in the current language. */
export function T({ t }: { t: Text | undefined | null }) {
  const { tx } = useI18n();
  return t ? <Md s={tx(t)} /> : null;
}
