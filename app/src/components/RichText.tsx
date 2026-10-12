import { Fragment } from "react";
import { useI18n } from "../i18n";
import { parseMarkup } from "../lib/markup";
import type { Text } from "../schema";

/** Renders a data string with **bold**, *italic* and `mono`. Never renders HTML. */
export function Md({ s }: { s: string }) {
  return (
    <>
      {parseMarkup(s).map((r, i) =>
        r.kind === "b" ? <b key={i}>{r.text}</b>
          : r.kind === "i" ? <i key={i}>{r.text}</i>
            : r.kind === "mono" ? <span key={i} className="mono">{r.text}</span>
              : <Fragment key={i}>{r.text}</Fragment>)}
    </>
  );
}

/** A Text in the current language. */
export function T({ t }: { t: Text | undefined | null }) {
  const { tx } = useI18n();
  return t ? <Md s={tx(t)} /> : null;
}
