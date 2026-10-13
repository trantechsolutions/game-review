import { Fragment } from "react";
import { useI18n } from "../i18n";
import { parseMarkup } from "../lib/markup";
import { splitPositions } from "../lib/positions";
import type { Text } from "../schema";

/** Text with each position acronym (GK, LCB, ST…) wrapped so its full name shows on hover or tap. */
function Pos({ text }: { text: string }) {
  const { lang } = useI18n();
  return (
    <>
      {splitPositions(text, lang).map((p, i) =>
        typeof p === "string" ? <Fragment key={i}>{p}</Fragment>
          : <abbr key={i} className="pos-abbr" data-full={p.title}>{p.abbr}<span className="sr-only"> ({p.title})</span></abbr>)}
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
